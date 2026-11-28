import { randomUUID } from "node:crypto";

import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  REPOSITORY_SET_ERROR_CODES,
  computeRepositorySetDigest,
  deriveRepositoryKey,
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
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ArtifactLifecycleState,
  AssessmentAuditMode,
  Prisma,
  RepositoryScanJobStatus,
  RepositoryScanTriggerSource,
  RepositorySnapshotStatus,
} from "@prisma/client";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { AssessmentLifecycleCoordinator } from "./assessment-lifecycle-coordinator.service.js";
import { currentRepositoryLimit } from "./repository-set-limit.js";
import { acquireLegalSourceLifecycleLock } from "../../../legal-source/application/services/legal-source.service.js";

export const PREPARATION_RESULTS = {
  ACTIVATED: "ACTIVATED",
  ALREADY_ACTIVE: "ALREADY_ACTIVE",
  WAITING_FOR_COMPLIANCE_RULE_SET: "WAITING_FOR_COMPLIANCE_RULE_SET",
} as const;
export type PreparationResult =
  (typeof PREPARATION_RESULTS)[keyof typeof PREPARATION_RESULTS];

export const PIN_RESULTS = {
  PINNED: "PINNED",
  WAITING_FOR_COMPLIANCE_RULE_SET:
    PREPARATION_RESULTS.WAITING_FOR_COMPLIANCE_RULE_SET,
} as const;
export type PinResult = (typeof PIN_RESULTS)[keyof typeof PIN_RESULTS];

const ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

/**
 * PREPARING -> ACTIVE for one assessment. It pins the compliance rule set and repository snapshot,
 * creates a decision-coverage row for EVERY AssessmentRule of the pinned rule set, then asks
 * the lifecycle coordinator for the transition with the guards this boundary has verified from
 * authoritative state, and enqueues the single Root run. Deterministic: no legal meaning is
 * evaluated here.
 */
@Injectable()
export class AssessmentRuntimePreparation {
  constructor(
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Business purpose: Create a case pinned to the current legal catalog without starting an audit.
   * Business rules:
   * - New customers must explicitly choose their execution scope; old rows retain LEGACY_FULL.
   * Execution flow:
   * 1. Read the active Rule Set and create the case with CUSTOMER_SELECTED mode.
   * Failure cases:
   * - An unavailable Rule Set leaves the pin empty until setup can resolve it.
   * Side effects:
   * - Creates one assessment case inside the caller's transaction.
   */
  async createCaseInTx(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<{ ruleSetVersionId: string | null }> {
    await acquireLegalSourceLifecycleLock(tx);
    const ruleSet = await tx.complianceRuleSetVersion.findFirst({
      where: {
        lifecycleState: ArtifactLifecycleState.ACTIVE,
      },
      select: { id: true },
    });
    await tx.assessmentCase.create({
      data: {
        assessmentId,
        ruleSetVersionId: ruleSet?.id ?? null,
        auditMode: AssessmentAuditMode.CUSTOMER_SELECTED,
      },
    });
    return { ruleSetVersionId: ruleSet?.id ?? null };
  }

  /**
   * Business purpose: Pin the Rule Set and ready snapshot before a customer chooses audit rules.
   * Business rules:
   * - Customer-selected cases gain no decision coverage before an explicit request;
   * legacy full-scope cases retain their existing whole-catalog coverage.
   * Execution flow:
   * 1. Resolve immutable legal and repository pins and the hydration ticket.
   * 2. Record the chosen repositories as the immutable repository set (primary pin mirrored in the scalar columns) with its set digest.
   * 3. Confirm a nonempty catalog and create legacy coverage when applicable.
   * Failure cases:
   * - Missing Rule Set returns WAITING; invalid snapshot rejects the transaction.
   * - A bad selection (empty, duplicated, over the limit) or an unusable snapshot rejects; a different set already pinned to the case rejects with REPOSITORY_SET_IMMUTABLE.
   * Side effects:
   * - Writes pins, repository-set pin, hydration ticket and legacy coverage within the caller's transaction.
   */
  async pinRuntimeInputsInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      snapshotIds: string[];
      correlationId: string;
    },
  ): Promise<{ result: PinResult }> {
    await acquireLegalSourceLifecycleLock(tx);
    let assessmentCase = await tx.assessmentCase.findUnique({
      where: { assessmentId: input.assessmentId },
    });
    if (!assessmentCase) {
      await this.createCaseInTx(tx, input.assessmentId);
      assessmentCase = await tx.assessmentCase.findUniqueOrThrow({
        where: { assessmentId: input.assessmentId },
      });
    }
    let ruleSetId = assessmentCase.ruleSetVersionId;
    if (!ruleSetId) {
      // The assessment has not started reasoning, so a late pin of the then-ACTIVE
      // rule set is the same decision creation would have made.
      const active = await tx.complianceRuleSetVersion.findFirst({
        where: {
          lifecycleState: ArtifactLifecycleState.ACTIVE,
        },
        select: { id: true },
      });
      if (!active)
        return { result: PIN_RESULTS.WAITING_FOR_COMPLIANCE_RULE_SET };
      ruleSetId = active.id;
      await tx.assessmentCase.update({
        where: { assessmentId: input.assessmentId },
        data: { ruleSetVersionId: ruleSetId },
      });
    }

    const pinnedSnapshots = await this.resolveSnapshotsInTx(tx, input);
    // The scan-job row is the deterministic snapshot-archive ticket for sandbox hydration.
    // It is created without publishing any scan command: nothing scans or reasons here.
    const pins: Array<{
      snapshot: (typeof pinnedSnapshots)[number];
      ticketId: string;
    }> = [];
    for (const snapshot of pinnedSnapshots) {
      const ticket = await tx.repositoryScanJob.upsert({
        where: {
          idempotencyKey: `runtime-hydration:${input.assessmentId}:${snapshot.id}`,
        },
        update: {},
        create: {
          id: randomUUID(),
          assessmentId: input.assessmentId,
          snapshotId: snapshot.id,
          idempotencyKey: `runtime-hydration:${input.assessmentId}:${snapshot.id}`,
          triggerSource: RepositoryScanTriggerSource.TRUSTED,
          status: RepositoryScanJobStatus.QUEUED,
          correlationId: input.correlationId,
        },
        select: { id: true },
      });
      pins.push({ snapshot, ticketId: ticket.id });
    }
    // Refuse a different set before touching any pin column: the database would otherwise reject the
    // scalar update with an opaque error instead of REPOSITORY_SET_IMMUTABLE.
    const alreadyPinned = await this.assertRepositorySetUnchangedInTx(tx, {
      assessmentId: input.assessmentId,
      correlationId: input.correlationId,
      snapshotIds: pins.map((entry) => entry.snapshot.id),
    });
    if (!alreadyPinned) {
      const primary = pins[0]!;
      await tx.assessmentCase.update({
        where: { assessmentId: input.assessmentId },
        data: {
          repositorySnapshotId: primary.snapshot.id,
          repositoryScanJobId: primary.ticketId,
          repositoryCommit: primary.snapshot.commitSha.toLowerCase(),
        },
      });
      await this.pinRepositorySetInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        pins,
      });
    }

    const rules = await tx.assessmentRule.findMany({
      where: { ruleSetVersionId: ruleSetId },
      select: { assessmentRuleId: true, assessmentRuleVersion: true },
    });
    if (rules.length === 0) {
      return { result: PIN_RESULTS.WAITING_FOR_COMPLIANCE_RULE_SET };
    }
    if (assessmentCase.auditMode === AssessmentAuditMode.LEGACY_FULL) {
      await tx.assessmentDecisionCoverage.createMany({
        data: rules.map((rule) => ({
          assessmentId: input.assessmentId,
          assessmentRuleId: rule.assessmentRuleId,
          ruleSetVersionId: ruleSetId,
          assessmentRuleVersion: rule.assessmentRuleVersion,
        })),
        skipDuplicates: true,
      });
    }
    return { result: PIN_RESULTS.PINNED };
  }

  /**
   * Business purpose: Load the exact repository snapshots the customer chose for this assessment and refuse
   * a set that is empty, duplicated, over the product limit or built from snapshots that are not ready.
   * Business rules:
   * - Every chosen snapshot must belong to this assessment, be READY and carry a full commit.
   * - The same snapshot cannot be chosen twice, and the same repository cannot be chosen twice with the same
   *   source scope; the same repository with different source scopes is allowed (monorepo scopes).
   * - The set size is capped by the configured repository limit, never above the contract maximum.
   * Execution flow:
   * 1. Reject an empty, duplicated or oversized selection.
   * 2. Read the chosen snapshots and reject any that are missing or not ready.
   * 3. Return the snapshots in the order the customer chose them (that order becomes the pin order).
   * Failure cases:
   * - REPOSITORY_SET_LIMIT_EXCEEDED or REPOSITORY_SET_DUPLICATE (422) for a bad selection; PINS_NOT_READY (409)
   *   for a missing or unusable snapshot.
   * Side effects:
   * - Read-only: it reads snapshots and writes nothing.
   */
  private async resolveSnapshotsInTx(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; snapshotIds: string[]; correlationId: string },
  ) {
    if (input.snapshotIds.length === 0) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    if (input.snapshotIds.length > currentRepositoryLimit()) {
      throw problemException(
        REPOSITORY_SET_ERROR_CODES.limitExceeded,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    if (new Set(input.snapshotIds).size !== input.snapshotIds.length) {
      throw problemException(
        REPOSITORY_SET_ERROR_CODES.duplicate,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const rows = await tx.repositorySnapshot.findMany({
      where: {
        id: { in: input.snapshotIds },
        assessmentId: input.assessmentId,
        status: RepositorySnapshotStatus.READY,
      },
      select: {
        id: true,
        commitSha: true,
        connectionId: true,
        repositoryId: true,
        repositoryFullName: true,
        sourcePathPrefix: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = input.snapshotIds.map((id) => byId.get(id));
    const usable = ordered.flatMap((row) =>
      row && /^[0-9a-fA-F]{40,64}$/u.test(row.commitSha) ? [row] : [],
    );
    if (usable.length !== input.snapshotIds.length) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const scopes = new Set(
      usable.map((row) => `${row.repositoryId}|${row.sourcePathPrefix ?? ""}`),
    );
    if (scopes.size !== usable.length) {
      throw problemException(
        REPOSITORY_SET_ERROR_CODES.duplicate,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return usable;
  }

  /**
   * Business purpose: Guarantee a case's repository set never changes once recorded, so decisions, evidence and
   * reports that cite the set digest can never silently refer to different code.
   * Business rules:
   * - A case that already has pins accepts only the identical ordered selection (an idempotent retry).
   * - Any other selection (different, larger, smaller or reordered) is rejected as immutable.
   * Execution flow:
   * 1. Read the recorded pins in ordinal order.
   * 2. Report "not pinned yet", accept the identical selection, or reject anything else.
   * Failure cases:
   * - REPOSITORY_SET_IMMUTABLE (409) for a different selection.
   * Side effects:
   * - Read-only: it reads the recorded pins and writes nothing.
   */
  private async assertRepositorySetUnchangedInTx(
    tx: Prisma.TransactionClient,
    input: { assessmentId: string; correlationId: string; snapshotIds: string[] },
  ): Promise<boolean> {
    const existing = await tx.assessmentCaseRepository.findMany({
      where: { assessmentId: input.assessmentId },
      orderBy: { ordinal: "asc" },
      select: { repositorySnapshotId: true },
    });
    if (existing.length === 0) return false;
    const same =
      existing.length === input.snapshotIds.length &&
      existing.every(
        (row, index) => row.repositorySnapshotId === input.snapshotIds[index],
      );
    if (same) return true;
    throw problemException(
      REPOSITORY_SET_ERROR_CODES.immutable,
      input.correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }

  /**
   * Business purpose: Record the repositories chosen for the case as its immutable repository set so every
   * reader works from the same pins and one digest proves the whole set is unchanged.
   * Business rules:
   * - Pins are ordered as chosen; the first is the primary pin mirrored in the case's scalar columns.
   * - Each repository gets a short key derived from its name, unique within the assessment.
   * - The set digest covers key, snapshot, commit and source scope of every pin and is stored on the case.
   * - Callers first prove the case has no recorded set (see assertRepositorySetUnchangedInTx).
   * Execution flow:
   * 1. Derive a unique key per repository in pin order.
   * 2. Insert one pin per repository and stamp the case with the digest and repository count.
   * Failure cases:
   * - A database rejection (for example inconsistent pins) rolls the whole transaction back.
   * Side effects:
   * - Inserts AssessmentCaseRepository rows and updates repositorySetDigest/repositoryCount on the case
   *   inside the caller's transaction.
   */
  private async pinRepositorySetInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      correlationId: string;
      pins: Array<{
        ticketId: string;
        snapshot: {
          id: string;
          commitSha: string;
          connectionId: string;
          repositoryId: string;
          repositoryFullName: string;
          sourcePathPrefix: string | null;
        };
      }>;
    },
  ): Promise<void> {
    const keys: string[] = [];
    const recorded = input.pins.map((entry, ordinal) => {
      const repositoryKey = deriveRepositoryKey(
        entry.snapshot.repositoryFullName,
        keys,
      );
      keys.push(repositoryKey);
      return {
        repositoryKey,
        ordinal,
        repositorySnapshotId: entry.snapshot.id,
        repositoryCommit: entry.snapshot.commitSha.toLowerCase(),
        sourcePathPrefix: entry.snapshot.sourcePathPrefix,
      };
    });
    await tx.assessmentCaseRepository.createMany({
      data: recorded.map((pin, index) => {
        const entry = input.pins[index]!;
        return {
          assessmentId: input.assessmentId,
          ...pin,
          connectionId: entry.snapshot.connectionId,
          repositoryId: entry.snapshot.repositoryId,
          repositoryFullName: entry.snapshot.repositoryFullName,
          repositoryScanJobId: entry.ticketId,
        };
      }),
    });
    await tx.assessmentCase.update({
      where: { assessmentId: input.assessmentId },
      data: {
        repositorySetDigest: computeRepositorySetDigest(recorded),
        repositoryCount: recorded.length,
      },
    });
  }

  /**
   * Business purpose: Make pinned assessment inputs ready while preserving customer choice as the start authority.
   * Business rules:
   * - Only legacy assessments dispatch Root during setup; new cases await a durable selected request.
   * Execution flow:
   * 1. Pin legal and repository inputs and transition PREPARING to ACTIVE.
   * 2. Enqueue the legacy full-scope Root only when the case's audit mode permits it.
   * Failure cases:
   * - Incomplete pins defer activation; invalid lifecycle rejects transactionally.
   * Side effects:
   * - Lifecycle and, for legacy cases, Root outbox command in the caller transaction.
   */
  async prepareInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      snapshotIds: string[];
      correlationId: string;
      responseLanguage?: string | null;
    },
  ): Promise<{ result: PreparationResult }> {
    const assessment = await tx.assessment.findUnique({
      where: { id: input.assessmentId },
      select: { lifecycleState: true, lifecycleRevision: true },
    });
    if (
      !assessment ||
      assessment.lifecycleState === null ||
      assessment.lifecycleRevision === null
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE) {
      return { result: PREPARATION_RESULTS.ALREADY_ACTIVE };
    }
    if (assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.PREPARING) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const pinned = await this.pinRuntimeInputsInTx(tx, input);
    if (pinned.result !== PIN_RESULTS.PINNED) {
      return { result: PREPARATION_RESULTS.WAITING_FOR_COMPLIANCE_RULE_SET };
    }

    await this.coordinator.transitionVerifiedInTx(
      {
        assessmentId: input.assessmentId,
        expectedRevision: assessment.lifecycleRevision,
        toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        correlationId: input.correlationId,
        actorId: ORCHESTRATOR.id,
      },
      tx,
      [
        AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
        AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
        AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
      ],
      ORCHESTRATOR,
    );
    const auditCase = await tx.assessmentCase.findUniqueOrThrow({
      where: { assessmentId: input.assessmentId },
      select: { auditMode: true },
    });
    if (auditCase.auditMode === AssessmentAuditMode.LEGACY_FULL)
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
          aggregateId: input.assessmentId,
          assessmentId: input.assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          correlationId: input.correlationId,
          causationId: input.correlationId,
          actor: ORCHESTRATOR,
          result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${input.assessmentId}:${ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED}:start`,
          // Identifiers and runtime settings: the Root loads everything else from server state with its lease.
          payload: {
            assessmentId: input.assessmentId,
            ...(input.responseLanguage
              ? {
                  responseLanguage: resolveResponseLanguage(
                    input.responseLanguage,
                  ),
                }
              : {}),
          },
        }),
        tx,
      );
    return { result: PREPARATION_RESULTS.ACTIVATED };
  }
}
