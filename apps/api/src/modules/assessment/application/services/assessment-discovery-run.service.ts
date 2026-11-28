import { randomUUID } from "node:crypto";

import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DISCOVERY_COMMAND_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentDiscoveryBatchViewSchema,
  assessmentDiscoveryRunClaimSchema,
  assessmentDiscoveryLatestRunSchema,
  assessmentDiscoveryRunViewSchema,
  type AssessmentDiscoveryBatchView,
  type AssessmentDiscoveryRunClaim,
  type AssessmentDiscoveryLatestRun,
  type AssessmentDiscoveryRunView,
  type SubmitRepositoryDiscovery,
  type RepositoryDiscoveryDetailPage,
  type RepositoryDiscoveryDetailPageQuery,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Injectable } from "@nestjs/common";
import { AssessmentDiscoveryRunStatus, Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { canonicalJson, sha256Hex } from "../../domain/domain-ids.js";
import { pinsForRepository } from "../../domain/repository-set-pin.js";
import {
  AssessmentCaseSupport,
  type PinnedCase,
} from "../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRepositoryDiscoveryService } from "./assessment-repository-discovery.service.js";

const DISCOVERY_LEASE_MS = 30 * 60 * 1000;
const SCAN_ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

type Tx = Prisma.TransactionClient;

/** A discovery run row and the pinned repository coordinates it must still equal. */
type RunCoordinates = {
  repositorySnapshotId: string;
  repositoryId: string;
  repositoryCommit: string;
  sourcePathPrefix: string | null;
};

/** Owns deterministic, customer-initiated discovery without creating any audit request or RuleDecision. */
@Injectable()
export class AssessmentDiscoveryRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly support: AssessmentCaseSupport,
    private readonly discoveries: AssessmentRepositoryDiscoveryService,
  ) {}

  /**
   * Business purpose: Enqueue the customer-authorized repository discovery of every repository pinned to the
   * assessment, before rule selection.
   * Business rules:
   * - Only the assessment owner with a pinned, active CUSTOMER_SELECTED case may request discovery.
   * - One run is created per pinned repository and all share one batch; each run scans only its own repository.
   * - The same idempotency key returns the original batch; concurrent active runs cannot race.
   * - A queued command is durable and cannot create a rule decision or authorize an audit.
   * Execution flow:
   * 1. Lock the case, authorize ownership and verify current repository pins.
   * 2. Reuse a matching idempotency receipt, or require an active unselected case to create new runs.
   * 3. Create one run and enqueue one worker command per pinned repository in the same transaction.
   * Failure cases:
   * - Missing ownership, incomplete pins, active audit, or a competing run fail closed.
   * - A key reused with different repositories or scope is an IDEMPOTENCY_CONFLICT.
   * Side effects:
   * - Inserts one discovery run and one transactional outbox command for each pinned repository.
   */
  async start(input: {
    assessmentId: string;
    ownerId: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<AssessmentDiscoveryBatchView> {
    const runIds = await this.prisma.$transaction(async (tx) => {
      await this.support.lockCase(tx, input.assessmentId);
      const assessment = await this.requireOwnerInTx(tx, input);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const plan = pins.repositories.map((repository) =>
        this.runPlan(input, pins, repository),
      );
      const olds = await tx.assessmentDiscoveryRun.findMany({
        where: {
          assessmentId: input.assessmentId,
          idempotencyKey: { in: plan.map((item) => item.idempotencyKey) },
        },
      });
      if (olds.length > 0) {
        const byKey = new Map(olds.map((old) => [old.idempotencyKey, old]));
        const replay = plan.map((item) => byKey.get(item.idempotencyKey));
        if (
          replay.some(
            (old, index) =>
              !old || old.requestDigest !== plan[index]?.requestDigest,
          )
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        return replay.map((old) => old!.runId);
      }
      if (
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
        assessment.domainCase?.auditMode !==
          ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const runtime = await tx.assessmentRuntime.findUnique({
        where: { assessmentId: input.assessmentId },
        select: { currentAuditRequestId: true },
      });
      if (runtime?.currentAuditRequestId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const active = await tx.assessmentDiscoveryRun.findFirst({
        where: {
          assessmentId: input.assessmentId,
          status: {
            in: [
              AssessmentDiscoveryRunStatus.QUEUED,
              AssessmentDiscoveryRunStatus.RUNNING,
            ],
          },
        },
        select: { runId: true },
      });
      if (active) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_HELD,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const batchId = randomUUID();
      const created: string[] = [];
      for (const item of plan) {
        const id = randomUUID();
        created.push(id);
        await tx.assessmentDiscoveryRun.create({
          data: {
            runId: id,
            assessmentId: input.assessmentId,
            requestedBy: input.ownerId,
            idempotencyKey: item.idempotencyKey,
            requestDigest: item.requestDigest,
            repositorySnapshotId: item.repository.repositorySnapshotId,
            repositoryId: item.repository.repositoryId,
            repositoryKey: item.repository.repositoryKey,
            discoveryBatchId: batchId,
            repositoryCommit: item.repository.repositoryCommit.toLowerCase(),
            sourcePathPrefix: item.repository.sourcePathPrefix,
            repositoryScanJobId: item.repository.repositoryScanJobId,
            threadId: `discovery:${input.assessmentId}:${id}`,
          },
        });
        await this.outbox.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: input.assessmentId,
            assessmentId: input.assessmentId,
            eventType: ASSESSMENT_DISCOVERY_COMMAND_TYPES.DISCOVERY_REQUESTED,
            correlationId: input.correlationId,
            causationId: input.correlationId,
            actor: SCAN_ORCHESTRATOR,
            result: ASSESSMENT_DISCOVERY_COMMAND_TYPES.DISCOVERY_REQUESTED,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            idempotencyKey: `assessment-discovery:${id}:start`,
            payload: { assessmentId: input.assessmentId, runId: id },
          }),
          tx,
        );
      }
      return created;
    });
    return this.batchOf(input, runIds);
  }

  /**
   * Business purpose: Derive the idempotent identity of one repository's run inside a discovery batch.
   * Business rules:
   * - A single-repository assessment keeps the caller's key and the original request digest, so runs and
   *   retries recorded before repository sets existed stay valid.
   * - With several repositories each run gets its own key and its digest covers the repository and the set.
   * Execution flow:
   * 1. Choose the run's idempotency key.
   * 2. Hash the request identity with the repository coordinates.
   * Failure cases:
   * - Pure calculation that cannot fail for validated pins.
   * Side effects:
   * - Pure calculation without persistence.
   */
  private runPlan(
    input: { assessmentId: string; ownerId: string; idempotencyKey: string },
    pins: PinnedCase,
    repository: PinnedCase["repositories"][number],
  ) {
    const multi = pins.repositories.length > 1;
    return {
      repository,
      idempotencyKey: multi
        ? `${input.idempotencyKey}#${repository.repositoryKey}`
        : input.idempotencyKey,
      requestDigest: sha256Hex(
        canonicalJson({
          assessmentId: input.assessmentId,
          ownerId: input.ownerId,
          idempotencyKey: input.idempotencyKey,
          repositorySnapshotId: repository.repositorySnapshotId,
          repositoryCommit: repository.repositoryCommit.toLowerCase(),
          sourcePathPrefix: repository.sourcePathPrefix,
          ...(multi
            ? {
                repositoryKey: repository.repositoryKey,
                repositorySetDigest: pins.repositorySetDigest,
              }
            : {}),
        }),
      ),
    };
  }

  /**
   * Business purpose: Present the runs of one discovery batch as the customer's progress per repository.
   * Business rules:
   * - Runs are listed in the order of the pinned repositories; the primary repository's run represents the batch.
   * Execution flow:
   * 1. Read each run through the owner-authorized projection.
   * 2. Return them with the batch identity.
   * Failure cases:
   * - Any run that fails its pin or integrity check fails the whole projection.
   * Side effects:
   * - Read-only owner projection.
   */
  private async batchOf(
    input: { assessmentId: string; ownerId: string; correlationId: string },
    runIds: string[],
  ): Promise<AssessmentDiscoveryBatchView> {
    const runs: AssessmentDiscoveryRunView[] = [];
    for (const runId of runIds) runs.push(await this.get({ ...input, runId }));
    return assessmentDiscoveryBatchViewSchema.parse({
      batchId: runs[0]?.discoveryBatchId ?? null,
      run: runs[0],
      runs,
    });
  }

  /**
   * Business purpose: Return the exact owner's immutable discovery run and bounded result.
   * Business rules:
   * - Ownership and pinned repository coordinates are verified even for completed runs.
   * - Only a COMPLETED run can expose its exact linked artifact; no scan means UNKNOWN, not no AI.
   * Execution flow:
   * 1. Verify ownership and load the run under the current case pins.
   * 2. Return run metadata plus the exact content-digest-verified discovery preview if completed.
   * Failure cases:
   * - Foreign/missing/stale runs fail closed with NOT_FOUND or PINS_NOT_READY.
   * Side effects:
   * - Read-only owner lookup and bounded projection.
   */
  async get(input: {
    assessmentId: string;
    ownerId: string;
    correlationId: string;
    runId: string;
  }): Promise<AssessmentDiscoveryRunView> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnerInTx(tx, input);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const found = await tx.assessmentDiscoveryRun.findUnique({
        where: { runId: input.runId },
      });
      const scoped = found ? this.pinOfRun(pins, found) : null;
      if (!found || found.assessmentId !== input.assessmentId || !scoped) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      return { ...found, repositoryKey: scoped.repositoryKey };
    });
    const discovery =
      row.status === AssessmentDiscoveryRunStatus.COMPLETED &&
      row.discoveryRecordId
        ? await this.discoveries.getOwnerSummary({
            ...input,
            recordId: row.discoveryRecordId,
          })
        : { available: false as const, discovery: null };
    if (
      row.status === AssessmentDiscoveryRunStatus.COMPLETED &&
      !discovery.available
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return assessmentDiscoveryRunViewSchema.parse({
      runId: row.runId,
      assessmentId: row.assessmentId,
      status: row.status,
      attempt: row.attempt,
      repositoryKey: row.repositoryKey,
      discoveryBatchId: row.discoveryBatchId,
      repositorySnapshotId: row.repositorySnapshotId,
      repositoryCommit: row.repositoryCommit,
      sourcePathPrefix: row.sourcePathPrefix,
      requestedAt: row.requestedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      errorCode: row.errorCode,
      discovery,
    });
  }

  /**
   * Business purpose: Restore the newest discovery batch for the customer after reload.
   * Business rules:
   * - Owner and immutable snapshot pins are checked even if an older run exists.
   * - Only runs of the currently pinned repositories count; a new audit selection does not create a synthetic
   *   discovery status or hide prior results.
   * - A batch is reported whole: one run per pinned repository, primary first.
   * Execution flow:
   * 1. Authorize the assessment and find its newest run that still matches a pinned repository.
   * 2. Collect the other runs of the same batch (a legacy run is a batch of one).
   * 3. Return explicit absence or the fully validated owner view of every run.
   * Failure cases:
   * - Foreign assessments and source pin corruption reject without information leakage.
   * Side effects:
   * - Read-only DB lookup and content-digest verification.
   */
  async latest(input: {
    assessmentId: string;
    ownerId: string;
    correlationId: string;
  }): Promise<AssessmentDiscoveryLatestRun> {
    const runIds = await this.prisma.$transaction(async (tx) => {
      await this.requireOwnerInTx(tx, input);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const candidates = await tx.assessmentDiscoveryRun.findMany({
        where: {
          assessmentId: input.assessmentId,
          OR: pins.repositories.map((repository) => ({
            repositorySnapshotId: repository.repositorySnapshotId,
            repositoryId: repository.repositoryId,
            repositoryCommit: repository.repositoryCommit.toLowerCase(),
            sourcePathPrefix: repository.sourcePathPrefix,
          })),
        },
        orderBy: [{ requestedAt: "desc" }, { runId: "desc" }],
        take: 50,
      });
      const newest = candidates[0];
      if (!newest) return [];
      const members = newest.discoveryBatchId
        ? candidates.filter(
            (candidate) =>
              candidate.discoveryBatchId === newest.discoveryBatchId,
          )
        : [newest];
      const ordinals = new Map(
        pins.repositories.map((repository, index) => [
          repository.repositorySnapshotId,
          index,
        ]),
      );
      return members
        .sort(
          (left, right) =>
            (ordinals.get(left.repositorySnapshotId) ?? 0) -
            (ordinals.get(right.repositorySnapshotId) ?? 0),
        )
        .map((run) => run.runId);
    });
    if (runIds.length === 0) {
      return assessmentDiscoveryLatestRunSchema.parse({
        available: false,
        run: null,
        runs: [],
      });
    }
    const batch = await this.batchOf(input, runIds);
    return assessmentDiscoveryLatestRunSchema.parse({
      available: true,
      run: batch.run,
      runs: batch.runs,
    });
  }

  /**
   * Business purpose: Provide every discovery candidate in bounded pages for owner review.
   * Business rules:
   * - The run must be completed and its exact immutable discovery record must pass current owner/pin/digest checks.
   * - Requested pages remain investigative metadata, not accepted evidence or authorized audit rules.
   * Execution flow:
   * 1. Resolve the completed owner's run and its exact discovery record identity.
   * 2. Ask the existing discovery service to verify and page only that record.
   * Failure cases:
   * - Incomplete, missing or foreign runs fail before accessing any discovery content.
   * Side effects:
   * - Read-only owner projection.
   */
  async details(input: {
    assessmentId: string;
    ownerId: string;
    correlationId: string;
    runId: string;
    collection: RepositoryDiscoveryDetailPageQuery["collection"];
    offset: number;
    limit: number;
  }): Promise<RepositoryDiscoveryDetailPage> {
    const view = await this.get(input);
    if (!view.discovery.available) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return this.discoveries.getOwnerDetailPage({
      ...input,
      recordId: view.discovery.discovery.recordId,
    });
  }

  /**
   * Business purpose: Grant one bounded scan lease to an authenticated worker, independent of Assessment Root.
   * Business rules:
   * - A queued run or expired worker lease is claimable; active concurrent leases and terminal runs cannot restart.
   * - Every claim revalidates current pins and never authorizes audit rule selection.
   * Execution flow:
   * 1. Lock the assessment and select the exact run with current pins.
   * 2. CAS a new worker lease and return only the server-pinned hydration coordinates.
   * Failure cases:
   * - Conflicting lease, terminal status, or changed source pins reject atomically.
   * Side effects:
   * - Updates run status, attempt, lease and timestamps; does not write evidence.
   */
  async claim(input: {
    assessmentId: string;
    runId: string;
    correlationId: string;
  }): Promise<AssessmentDiscoveryRunClaim> {
    return this.prisma.$transaction(async (tx) => {
      await this.support.lockCase(tx, input.assessmentId);
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const found = await tx.assessmentDiscoveryRun.findUnique({
        where: { runId: input.runId },
      });
      const scoped = found ? this.pinOfRun(pins, found) : null;
      if (!found || found.assessmentId !== input.assessmentId || !scoped) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const row = { ...found, repositoryKey: scoped.repositoryKey };
      const now = new Date();
      if (row.status === AssessmentDiscoveryRunStatus.COMPLETED) {
        return assessmentDiscoveryRunClaimSchema.parse({
          ...this.claimCoordinates(row),
          leaseToken: row.leaseToken ?? randomUUID(),
          alreadyCompleted: true,
        });
      }
      if (
        row.status === AssessmentDiscoveryRunStatus.FAILED ||
        (row.status === AssessmentDiscoveryRunStatus.RUNNING &&
          row.leaseExpiresAt &&
          row.leaseExpiresAt > now)
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_HELD,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const leaseToken = randomUUID();
      await tx.assessmentDiscoveryRun.update({
        where: { runId: row.runId },
        data: {
          status: AssessmentDiscoveryRunStatus.RUNNING,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + DISCOVERY_LEASE_MS),
          attempt:
            row.status === AssessmentDiscoveryRunStatus.RUNNING
              ? { increment: 1 }
              : row.attempt,
          startedAt: now,
          errorCode: null,
        },
      });
      return assessmentDiscoveryRunClaimSchema.parse({
        ...this.claimCoordinates(row),
        attempt:
          row.attempt +
          (row.status === AssessmentDiscoveryRunStatus.RUNNING ? 1 : 0),
        leaseToken,
        alreadyCompleted: false,
      });
    });
  }

  /**
   * Business purpose: Persist the scan result and settle its exact independent worker lease.
   * Business rules:
   * - The worker credential is checked at transport; the live run lease, snapshot pins and artifact digest are checked here.
   * - The existing API-owned rule matcher enriches candidates; a worker cannot choose audit scope.
   * - Duplicate completions are accepted only for the original lease; a stale lease cannot mutate history.
   * Execution flow:
   * 1. Lock the case and validate the current live run lease and exact immutable snapshot coordinates.
   * 2. Persist the strict discovery via the existing authority-safe helper in the same transaction.
   * 3. Mark the scan completed and link its immutable artifact.
   * Failure cases:
   * - Expired, foreign or competing claims fail before persistence and roll back atomically.
   * Side effects:
   * - Creates at most one discovery artifact and settles a durable run.
   */
  async complete(input: {
    assessmentId: string;
    runId: string;
    correlationId: string;
    leaseToken: string;
    discovery: SubmitRepositoryDiscovery;
  }): Promise<{ recordId: string; replayed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      await this.support.lockCase(tx, input.assessmentId);
      const run = await tx.assessmentDiscoveryRun.findUnique({
        where: { runId: input.runId },
      });
      if (
        !run ||
        run.assessmentId !== input.assessmentId ||
        run.leaseToken !== input.leaseToken
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const scoped = this.pinOfRun(pins, run);
      if (!scoped) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      if (run.status === AssessmentDiscoveryRunStatus.COMPLETED) {
        if (
          !run.discoveryRecordId ||
          !run.workerContentDigest ||
          run.workerContentDigest !== input.discovery.contentDigest
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        return { recordId: run.discoveryRecordId, replayed: true };
      }
      if (
        run.status !== AssessmentDiscoveryRunStatus.RUNNING ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt <= new Date()
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      // The run's own repository decides which pin the artifact must match.
      const receipt = await this.discoveries.saveAuthorizedInTx(tx, {
        ...input,
        repositoryKey: scoped.repositoryKey,
      });
      await tx.assessmentDiscoveryRun.update({
        where: { runId: run.runId },
        data: {
          status: AssessmentDiscoveryRunStatus.COMPLETED,
          discoveryRecordId: receipt.recordId,
          workerContentDigest: input.discovery.contentDigest,
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      return { recordId: receipt.recordId, replayed: receipt.replayed };
    });
  }

  /**
   * Business purpose: Mark a failed deterministic scan without fabricating an empty discovery result.
   * Business rules:
   * - Only the owning active lease may fail the run; previously completed results cannot be discarded.
   * Execution flow:
   * 1. Lock the case and compare the exact live lease.
   * 2. Record a bounded error code and terminal failure timestamp.
   * Failure cases:
   * - Invalid or expired leases reject without changing history.
   * Side effects:
   * - Updates only run failure metadata; no rule, fact or evidence authority.
   */
  async fail(input: {
    assessmentId: string;
    runId: string;
    correlationId: string;
    leaseToken: string;
    errorCode: string;
  }): Promise<{ failed: true }> {
    return this.prisma.$transaction(async (tx) => {
      await this.support.lockCase(tx, input.assessmentId);
      const run = await tx.assessmentDiscoveryRun.findUnique({
        where: { runId: input.runId },
      });
      if (
        !run ||
        run.assessmentId !== input.assessmentId ||
        run.status !== AssessmentDiscoveryRunStatus.RUNNING ||
        run.leaseToken !== input.leaseToken ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt <= new Date()
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      await tx.assessmentDiscoveryRun.update({
        where: { runId: run.runId },
        data: {
          status: AssessmentDiscoveryRunStatus.FAILED,
          errorCode: input.errorCode,
          failedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      return { failed: true };
    });
  }

  /**
   * Business purpose: Authenticate the current customer for new discovery requests and historical reads.
   * Business rules:
   * - Only the assessment owner can access pre-scope discovery; new-run lifecycle eligibility is checked separately.
   * Execution flow:
   * 1. Read the assessment's owner and reject missing or foreign ownership.
   * 2. Return the canonical lifecycle and case metadata to the authorized caller.
   * Failure cases:
   * - A missing or foreign assessment raises RUNTIME_NOT_FOUND without revealing source content.
   * Side effects:
   * - Read-only owner lookup; this does not create a run, fact or legal decision.
   */
  private async requireOwnerInTx(
    tx: Tx,
    input: { assessmentId: string; ownerId: string; correlationId: string },
  ) {
    const assessment = await tx.assessment.findUnique({
      where: { id: input.assessmentId },
      include: { domainCase: true },
    });
    if (!assessment || assessment.ownerId !== input.ownerId) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    return assessment;
  }

  /**
   * Business purpose: Return only immutable scan hydration coordinates from server-owned rows.
   * Business rules:
   * - Repository, snapshot, prefix and job IDs come from the pinned run, not the worker.
   * Execution flow:
   * 1. Project the run's stored identity and scan coordinates into a claim receipt.
   * Failure cases:
   * - Contract validation rejects an invalid stored coordinate.
   * Side effects:
   * - Pure, read-only projection.
   */
  private claimCoordinates(row: {
    runId: string;
    assessmentId: string;
    repositoryKey: string;
    threadId: string;
    repositorySnapshotId: string;
    repositoryId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
    repositoryScanJobId: string;
    attempt: number;
  }) {
    return {
      runId: row.runId,
      assessmentId: row.assessmentId,
      threadId: row.threadId,
      repositoryKey: row.repositoryKey,
      repositorySnapshotId: row.repositorySnapshotId,
      repositoryId: row.repositoryId,
      repositoryCommit: row.repositoryCommit,
      sourcePathPrefix: row.sourcePathPrefix,
      repositoryScanJobId: row.repositoryScanJobId,
      attempt: row.attempt,
    };
  }

  /**
   * Business purpose: Prove a stored run still describes one repository of the pinned set and return that pin.
   * Business rules:
   * - The run's snapshot selects the repository; its repository, commit and source scope must equal that pin.
   * - A run stamped with a repository key must name the repository its snapshot belongs to.
   * Execution flow:
   * 1. Find the pinned repository of the run's snapshot.
   * 2. Compare every stored coordinate with it.
   * Failure cases:
   * - Returns null for a run of a repository that is not pinned or whose coordinates drifted.
   * Side effects:
   * - Pure comparison without persistence.
   */
  private pinOfRun(
    pins: PinnedCase,
    run: RunCoordinates & { repositoryKey: string | null },
  ) {
    const scoped = pinsForRepository(pins, {
      snapshotId: run.repositorySnapshotId,
    });
    return scoped &&
      run.repositoryId === scoped.repositoryId &&
      run.repositoryCommit.toLowerCase() ===
        scoped.repositoryCommit.toLowerCase() &&
      run.sourcePathPrefix === scoped.sourcePathPrefix &&
      (run.repositoryKey === null || run.repositoryKey === scoped.repositoryKey)
      ? scoped
      : null;
  }
}
