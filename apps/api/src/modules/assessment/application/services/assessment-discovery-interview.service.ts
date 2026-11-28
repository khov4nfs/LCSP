import { randomUUID } from "node:crypto";

import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  DISCOVERY_INTERVIEW_REVIEW_ACTIONS,
  FACT_NEED_ENVIRONMENTS,
  FACT_NEED_SUBJECT_KINDS,
  FACT_NEED_TIMEFRAME_KINDS,
  FACT_NEED_VALUE_KINDS,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  discoveryInterviewPageSchema,
  discoveryInterviewProposalSchema,
  type DiscoveryInterviewProposal,
  type DiscoveryInterviewPage,
  type ReviewDiscoveryInterviewAnswer,
  type SubmitDiscoveryInterviewAnswer,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AssessmentDiscoveryInterviewProposalStatus,
  AssessmentDiscoveryRunStatus,
  AssessmentFactNeedStatus,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { inspectHumanFactAnswer } from "../commands/answer-human-request/human-fact-integrity.js";
import { normalizeFactNeedAnswer } from "../commands/answer-human-request/normalize-fact-need-answer.js";
import { canonicalJson, sha256Hex } from "../../domain/domain-ids.js";
import { pinsForRepository } from "../../domain/repository-set-pin.js";
import {
  AssessmentCaseSupport,
  type PinnedCase,
} from "../../infrastructure/persistence/assessment-case-support.service.js";
import { resolveAssessmentFactNeedInTx } from "../../infrastructure/persistence/assessment-fact-need.js";
import { AssessmentEvidenceInvalidation } from "./assessment-evidence-invalidation.service.js";
import { AssessmentRepositoryDiscoveryService } from "./assessment-repository-discovery.service.js";

type Tx = Prisma.TransactionClient;

type AuthorizedDiscovery = {
  run: {
    runId: string;
    assessmentId: string;
    discoveryRecordId: string | null;
    status: AssessmentDiscoveryRunStatus;
    repositorySnapshotId: string;
    repositoryId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
  };
  pins: PinnedCase;
  /** The pins viewed through the repository the run scanned; discovery checks use these, never the primary's. */
  repository: PinnedCase;
};

/**
 * Owner-controlled pre-audit question answering, separate from LangGraph's native selected-rule HITL.
 * Discovery questions are non-authoritative hints. A proposed answer becomes an accepted
 * HUMAN_PROVIDED fact only after explicit, guarded owner confirmation.
 */
@Injectable()
export class AssessmentDiscoveryInterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AssessmentCaseSupport,
    private readonly discoveries: AssessmentRepositoryDiscoveryService,
    private readonly invalidation: AssessmentEvidenceInvalidation,
  ) {}

  /**
   * Business purpose: Persist a scoped, source-verified operational answer for human review before rule selection.
   * Business rules:
   * - Only the assessment owner can submit on a completed, current-pin Discovery before any audit request.
   * - The exact question and AI use-case ID must exist in that immutable Discovery; text authored by the scanner is never evidence.
   * - Typed FactNeeds use source range provenance, canonical subject/predicate/scope identity and separate acceptance authority.
   * - One unresolved proposal per FactNeed is permitted; exact idempotent replays return their original record.
   * Execution flow:
   * 1. Lock and authorize the assessment, validate scope/pins, and verify the question against its Discovery artifact.
   * 2. Reuse or create one canonical FactNeed bound to the original Discovery record/digest.
   * 3. Persist the owner's raw answer as PENDING_REVIEW, retaining any ambiguity classification.
   * Failure cases:
   * - Foreign/stale questions, invalid owner, active audit, conflicting replay, or competing proposal roll back atomically.
   * Side effects:
   * - May append one canonical FactNeed and one immutable proposal; creates no accepted fact, evidence or legal decision.
   */
  async submit(input: {
    assessmentId: string;
    runId: string;
    ownerId: string;
    correlationId: string;
    answer: SubmitDiscoveryInterviewAnswer;
  }): Promise<DiscoveryInterviewProposal> {
    const record = await this.prisma.$transaction(async (tx) => {
      await this.support.lockCase(tx, input.assessmentId);
      const { run, repository } = await this.authorizedRunInTx(tx, input, true);
      if (!run.discoveryRecordId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      const requestDigest = sha256Hex(
        canonicalJson({
          runId: input.runId,
          useCaseId: input.answer.useCaseId,
          question: input.answer.question,
          answer: input.answer.answer,
        }),
      );
      const replay = await tx.assessmentDiscoveryInterviewProposal.findUnique({
        where: {
          assessmentId_idempotencyKey: {
            assessmentId: input.assessmentId,
            idempotencyKey: input.answer.idempotencyKey,
          },
        },
      });
      if (replay) {
        if (
          replay.requestDigest !== requestDigest ||
          replay.discoveryRunId !== input.runId
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            input.correlationId,
            {
              status: HttpStatus.CONFLICT,
            },
          );
        }
        return replay;
      }
      const investigation = await this.discoveries.verifyInterviewQuestionInTx(
        tx,
        {
          pins: repository,
          recordId: run.discoveryRecordId,
          useCaseId: input.answer.useCaseId,
          question: input.answer.question,
          correlationId: input.correlationId,
        },
      );
      const factNeed = await resolveAssessmentFactNeedInTx(tx, {
        assessmentId: input.assessmentId,
        tenantOwnerId: input.ownerId,
        repositorySnapshotId: repository.repositorySnapshotId,
        repositoryCommit: repository.repositoryCommit,
        sourcePathPrefix: repository.sourcePathPrefix,
        factNeed: {
          subject: {
            kind: FACT_NEED_SUBJECT_KINDS.useCase,
            key: `usecase.${input.answer.useCaseId.slice(7)}`,
          },
          predicate: `discovery.question.${sha256Hex(input.answer.question)}`,
          operationalScope: `repository.${sha256Hex(repository.repositoryId).slice(0, 32)}`,
          environment: {
            kind: FACT_NEED_ENVIRONMENTS.unknown,
            deploymentKey: null,
          },
          timeframe: {
            kind: FACT_NEED_TIMEFRAME_KINDS.current,
            from: null,
            to: null,
          },
          valueSchema: {
            kind: FACT_NEED_VALUE_KINDS.text,
            schemaVersion: "discovery-v1",
            allowedValues: [],
          },
          sourceInvestigationAttempts: [
            `Discovery question awaiting customer context: ${input.answer.question}`,
          ],
          acceptedEvidenceIds: [],
          investigationDiscoveryRefs: [
            {
              recordId: run.discoveryRecordId,
              contentDigest: investigation.contentDigest,
            },
          ],
          investigatedRangeIds: investigation.rangeIds,
        },
        controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT,
        choices: [],
        correlationId: input.correlationId,
      });
      if (factNeed.linkedRequestId) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      const existingNeed = await tx.assessmentFactNeed.findUniqueOrThrow({
        where: { factNeedId: factNeed.factNeedId },
        select: { status: true },
      });
      if (existingNeed.status !== AssessmentFactNeedStatus.OPEN) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      const pending = await tx.assessmentDiscoveryInterviewProposal.findFirst({
        where: {
          assessmentId: input.assessmentId,
          factNeedId: factNeed.factNeedId,
          status: AssessmentDiscoveryInterviewProposalStatus.PENDING_REVIEW,
        },
        select: { proposalId: true },
      });
      if (pending) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      return tx.assessmentDiscoveryInterviewProposal.create({
        data: {
          proposalId: randomUUID(),
          assessmentId: input.assessmentId,
          discoveryRunId: input.runId,
          factNeedId: factNeed.factNeedId,
          idempotencyKey: input.answer.idempotencyKey,
          requestDigest,
          useCaseId: input.answer.useCaseId,
          question: input.answer.question,
          answer: input.answer.answer,
          submittedBy: input.ownerId,
          status: AssessmentDiscoveryInterviewProposalStatus.PENDING_REVIEW,
          guardFailure: inspectHumanFactAnswer(
            input.answer.question,
            input.answer.answer,
            [],
          ),
        },
      });
    });
    return this.project(record, await this.currentRevision(input));
  }

  /**
   * Business purpose: Allow the assessment owner to explicitly confirm or reject an unaccepted context statement.
   * Business rules:
   * - Current ownership, source pins, pre-scope status and optimistic case revision are mandatory.
   * - Ambiguous/unknown submissions may be rejected and rewritten, never accepted as a verified operational fact.
   * - A confirmed answer is HUMAN_PROVIDED only; it does not establish legal applicability or compliance.
   * - Accepted FactNeeds are resolved exactly once, with immutable evidence and fact links.
   * - Candidate recommendations are recomputed from unchanged pinned source and newly accepted facts, without rerunning the scanner.
   * Execution flow:
   * 1. Lock case and locate the exact pending proposal under the current Discovery run.
   * 2. On rejection mark the proposal REJECTED without changing accepted facts.
   * 3. On confirmation validate the answer, create immutable answer evidence and an accepted case fact, then resolve its FactNeed.
   * 4. Persist a fresh candidate-matching revision and link the run to that immutable advisory artifact.
   * Failure cases:
   * - Stale revisions, mismatched run/owner, conflicting resolutions, or ambiguous content reject atomically.
   * Side effects:
   * - Updates proposal review status; acceptance advances caseRevision and appends evidence/fact/FactNeed links.
   */
  async review(input: {
    assessmentId: string;
    runId: string;
    proposalId: string;
    ownerId: string;
    correlationId: string;
    review: ReviewDiscoveryInterviewAnswer;
  }): Promise<DiscoveryInterviewProposal> {
    const record = await this.prisma.$transaction(async (tx) => {
      await this.support.lockCase(tx, input.assessmentId);
      const { pins, run, repository } = await this.authorizedRunInTx(
        tx,
        input,
        true,
      );
      const proposal = await tx.assessmentDiscoveryInterviewProposal.findUnique(
        {
          where: { proposalId: input.proposalId },
        },
      );
      if (
        !proposal ||
        proposal.assessmentId !== input.assessmentId ||
        proposal.discoveryRunId !== input.runId
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_NOT_FOUND,
          input.correlationId,
          {
            status: HttpStatus.NOT_FOUND,
          },
        );
      }
      const targetStatus =
        input.review.action === DISCOVERY_INTERVIEW_REVIEW_ACTIONS.accept
          ? AssessmentDiscoveryInterviewProposalStatus.ACCEPTED
          : AssessmentDiscoveryInterviewProposalStatus.REJECTED;
      if (proposal.status === targetStatus) return proposal;
      if (
        proposal.status !==
        AssessmentDiscoveryInterviewProposalStatus.PENDING_REVIEW
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_CLOSED,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      if (pins.caseRevision !== input.review.expectedCaseRevision) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.CASE_REVISION_STALE,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      if (input.review.action === DISCOVERY_INTERVIEW_REVIEW_ACTIONS.reject) {
        return tx.assessmentDiscoveryInterviewProposal.update({
          where: { proposalId: proposal.proposalId },
          data: {
            status: AssessmentDiscoveryInterviewProposalStatus.REJECTED,
            reviewedBy: input.ownerId,
            reviewedAt: new Date(),
          },
        });
      }
      if (
        proposal.guardFailure ||
        inspectHumanFactAnswer(proposal.question, proposal.answer, []) !== null
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_ANSWER_INVALID,
          input.correlationId,
          {
            status: HttpStatus.UNPROCESSABLE_ENTITY,
          },
        );
      }
      const factNeed = await tx.assessmentFactNeed.findUnique({
        where: { factNeedId: proposal.factNeedId },
      });
      if (
        !factNeed ||
        factNeed.assessmentId !== input.assessmentId ||
        factNeed.status !== AssessmentFactNeedStatus.OPEN
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      const normalizedAnswer = normalizeFactNeedAnswer(
        factNeed,
        proposal.answer,
      );
      const caseRevision = pins.caseRevision + 1;
      const evidenceId = randomUUID();
      const factId = randomUUID();
      const evidencePayload = {
        origin: "DISCOVERY_CONTEXT_INTERVIEW",
        proposalId: proposal.proposalId,
        discoveryRunId: proposal.discoveryRunId,
        factNeedId: proposal.factNeedId,
        useCaseId: proposal.useCaseId,
        question: proposal.question,
        rawAnswer: proposal.answer,
        normalizedAnswer,
        confirmedBy: input.ownerId,
        caseRevision,
      };
      await tx.assessmentCase.update({
        where: { assessmentId: input.assessmentId },
        data: { caseRevision },
      });
      await this.invalidation.invalidateFinalReportInTx(tx, input.assessmentId);
      await tx.assessmentEvidence.create({
        data: {
          evidenceId,
          assessmentId: input.assessmentId,
          type: ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER,
          repositoryCommit: pins.repositoryCommit,
          contentSha256: `sha256:${sha256Hex(canonicalJson(evidencePayload))}`,
          payload: evidencePayload,
        },
      });
      await tx.assessmentCaseFact.create({
        data: {
          factId,
          assessmentId: input.assessmentId,
          caseRevision,
          kind: ASSESSMENT_FACT_KINDS.FACT,
          authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
          statement: `Customer-confirmed operational answer: ${proposal.answer}\nDiscovery question (investigation context only): ${proposal.question}`,
        },
      });
      await tx.assessmentCaseFactEvidence.create({
        data: { assessmentId: input.assessmentId, factId, evidenceId },
      });
      const resolved = await tx.assessmentFactNeed.updateMany({
        where: {
          factNeedId: factNeed.factNeedId,
          assessmentId: input.assessmentId,
          status: AssessmentFactNeedStatus.OPEN,
        },
        data: {
          status: AssessmentFactNeedStatus.RESOLVED,
          resolvedFactId: factId,
          resolvedAt: new Date(),
        },
      });
      if (resolved.count !== 1) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      const refreshed =
        await this.discoveries.refreshCandidateRecommendationsInTx(tx, {
          pins: repository,
          recordId: run.discoveryRecordId!,
          correlationId: input.correlationId,
        });
      await tx.assessmentDiscoveryRun.update({
        where: { runId: run.runId },
        data: { discoveryRecordId: refreshed.recordId },
      });
      return tx.assessmentDiscoveryInterviewProposal.update({
        where: { proposalId: proposal.proposalId },
        data: {
          status: AssessmentDiscoveryInterviewProposalStatus.ACCEPTED,
          reviewedBy: input.ownerId,
          reviewedAt: new Date(),
          acceptedFactId: factId,
          acceptedEvidenceId: evidenceId,
        },
      });
    });
    return this.project(record, await this.currentRevision(input));
  }

  /**
   * Business purpose: List the assessment owner's proposed and reviewed pre-scope answers without claiming legal certainty.
   * Business rules:
   * - The completed Discovery source and current pins are verified for every read.
   * - Pagination limits protect clients from unbounded history; status is a review status, not a legal outcome.
   * Execution flow:
   * 1. Revalidate owner/run/snapshot and load current case revision.
   * 2. Count and page persisted proposals ordered by creation and stable ID.
   * Failure cases:
   * - Foreign or stale runs fail closed with no partial source leakage.
   * Side effects:
   * - Read-only database queries.
   */
  async list(input: {
    assessmentId: string;
    runId: string;
    ownerId: string;
    correlationId: string;
    offset: number;
    limit: number;
  }): Promise<DiscoveryInterviewPage> {
    return this.prisma.$transaction(async (tx) => {
      const { pins } = await this.authorizedRunInTx(tx, input, false);
      const [total, records] = await Promise.all([
        tx.assessmentDiscoveryInterviewProposal.count({
          where: {
            assessmentId: input.assessmentId,
            discoveryRunId: input.runId,
          },
        }),
        tx.assessmentDiscoveryInterviewProposal.findMany({
          where: {
            assessmentId: input.assessmentId,
            discoveryRunId: input.runId,
          },
          orderBy: [{ createdAt: "asc" }, { proposalId: "asc" }],
          skip: input.offset,
          take: input.limit,
        }),
      ]);
      return discoveryInterviewPageSchema.parse({
        caseRevision: pins.caseRevision,
        total,
        offset: input.offset,
        limit: input.limit,
        nextOffset:
          input.offset + records.length < total
            ? input.offset + records.length
            : null,
        items: records.map((row) => this.project(row, pins.caseRevision)),
      });
    });
  }

  /**
   * Business purpose: Enforce the exact customer and repository authority for an existing Discovery run.
   * Business rules:
   * - Only the assessment owner may operate; mutating paths additionally require an active pre-scope selected-mode case.
   * - Source pins are server-owned and unchanged, and the run must have completed successfully.
   * Execution flow:
   * 1. Verify owner/case and current repository snapshot.
   * 2. Compare run's pinned source identity and enforce pre-scope eligibility when requested.
   * Failure cases:
   * - Foreign owners raise RUNTIME_NOT_FOUND; stale source pins and incomplete or failed Discovery runs raise PROVENANCE_INTEGRITY_MISMATCH. Mutations after audit selection raise NOT_ACTIVE.
   * Side effects:
   * - Read-only transaction helper.
   */
  private async authorizedRunInTx(
    tx: Tx,
    input: {
      assessmentId: string;
      runId: string;
      ownerId: string;
      correlationId: string;
    },
    requirePreScope: boolean,
  ): Promise<AuthorizedDiscovery> {
    const assessment = await tx.assessment.findUnique({
      where: { id: input.assessmentId },
      include: { domainCase: true },
    });
    if (!assessment || assessment.ownerId !== input.ownerId) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        input.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }
    const pins = await this.support.loadPins(
      tx,
      input.assessmentId,
      input.correlationId,
    );
    if (requirePreScope) {
      const runtime = await tx.assessmentRuntime.findUnique({
        where: { assessmentId: input.assessmentId },
        select: { currentAuditRequestId: true },
      });
      if (
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
        assessment.domainCase?.auditMode !==
          ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED ||
        runtime?.currentAuditRequestId
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
    }
    const run = await tx.assessmentDiscoveryRun.findUnique({
      where: { runId: input.runId },
    });
    const repository = run
      ? pinsForRepository(pins, { snapshotId: run.repositorySnapshotId })
      : null;
    if (
      !run ||
      !repository ||
      run.assessmentId !== input.assessmentId ||
      run.status !== AssessmentDiscoveryRunStatus.COMPLETED ||
      !run.discoveryRecordId ||
      run.repositoryId !== repository.repositoryId ||
      run.repositoryCommit !== repository.repositoryCommit.toLowerCase() ||
      run.sourcePathPrefix !== repository.sourcePathPrefix
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PROVENANCE_INTEGRITY_MISMATCH,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
        },
      );
    }
    return { run, pins, repository };
  }

  /**
   * Business purpose: Project review-only context details without exposing internal worker credentials or mutable authority.
   * Business rules:
   * - A pending proposal never claims accepted fact authority.
   * - Accepted records reference immutable fact IDs and retain the owner's original text for audit.
   * Execution flow:
   * 1. Select bounded public fields and transform timestamps into strict ISO strings.
   * Failure cases:
   * - Invalid stored statuses or identifiers fail strict contract parsing.
   * Side effects:
   * - Pure projection, no persistence or network access.
   */
  private project(
    row: {
      proposalId: string;
      assessmentId: string;
      discoveryRunId: string;
      factNeedId: string;
      useCaseId: string;
      question: string;
      answer: string;
      status: AssessmentDiscoveryInterviewProposalStatus;
      guardFailure: string | null;
      acceptedFactId: string | null;
      createdAt: Date;
      reviewedAt: Date | null;
    },
    caseRevision: number,
  ): DiscoveryInterviewProposal {
    return discoveryInterviewProposalSchema.parse({
      proposalId: row.proposalId,
      assessmentId: row.assessmentId,
      discoveryRunId: row.discoveryRunId,
      factNeedId: row.factNeedId,
      useCaseId: row.useCaseId,
      question: row.question,
      answer: row.answer,
      status: row.status,
      guardFailure: row.guardFailure,
      caseRevision,
      acceptedFactId: row.acceptedFactId,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
    });
  }

  /**
   * Business purpose: Return the latest case revision for an owner-authenticated pre-scope interview result.
   * Business rules:
   * - Every mutation result carries the server revision for subsequent optimistic confirmation.
   * Execution flow:
   * 1. Read the case revision and reject an unexpectedly deleted case.
   * Failure cases:
   * - Missing case fails closed.
   * Side effects:
   * - Read-only database access.
   */
  private async currentRevision(input: {
    assessmentId: string;
    correlationId: string;
  }): Promise<number> {
    const row = await this.prisma.assessmentCase.findUnique({
      where: { assessmentId: input.assessmentId },
      select: { caseRevision: true },
    });
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        input.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }
    return row.caseRevision;
  }
}
