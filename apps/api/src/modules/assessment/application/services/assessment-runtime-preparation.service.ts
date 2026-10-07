import { randomUUID } from "node:crypto";

import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_ROOT_COMMAND_TYPES,
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
import {
  ArtifactLifecycleState,
  Prisma,
  RepositoryScanJobStatus,
  RepositoryScanTriggerSource,
  RepositorySnapshotStatus,
} from "@prisma/client";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { AssessmentLifecycleCoordinator } from "./assessment-lifecycle-coordinator.service.js";

export const PREPARATION_RESULTS = {
  ACTIVATED: "ACTIVATED",
  ALREADY_ACTIVE: "ALREADY_ACTIVE",
  WAITING_FOR_LEGAL_PORTFOLIO: "WAITING_FOR_LEGAL_PORTFOLIO",
} as const;
export type PreparationResult =
  (typeof PREPARATION_RESULTS)[keyof typeof PREPARATION_RESULTS];

const ORCHESTRATOR = {
  id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

/**
 * PREPARING -> ACTIVE for one assessment. It pins the legal portfolio and repository snapshot,
 * creates a decision-coverage row for EVERY EngineeringRule of the pinned portfolio, then asks
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

  /** Creates the case at assessment creation, pinning the then-ACTIVE legal portfolio. */
  async createCaseInTx(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<{ legalPortfolioVersionId: string | null }> {
    const portfolio = await tx.legalPortfolioVersion.findFirst({
      where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
      select: { id: true },
    });
    await tx.assessmentCase.create({
      data: {
        assessmentId,
        legalPortfolioVersionId: portfolio?.id ?? null,
      },
    });
    return { legalPortfolioVersionId: portfolio?.id ?? null };
  }

  async prepareInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      snapshotId: string;
      correlationId: string;
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

    let assessmentCase = await tx.assessmentCase.findUnique({
      where: { assessmentId: input.assessmentId },
    });
    if (!assessmentCase) {
      await this.createCaseInTx(tx, input.assessmentId);
      assessmentCase = await tx.assessmentCase.findUniqueOrThrow({
        where: { assessmentId: input.assessmentId },
      });
    }
    let portfolioId = assessmentCase.legalPortfolioVersionId;
    if (!portfolioId) {
      // The assessment has not started reasoning, so a late pin of the then-ACTIVE
      // portfolio is the same decision creation would have made.
      const active = await tx.legalPortfolioVersion.findFirst({
        where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
        select: { id: true },
      });
      if (!active)
        return { result: PREPARATION_RESULTS.WAITING_FOR_LEGAL_PORTFOLIO };
      portfolioId = active.id;
      await tx.assessmentCase.update({
        where: { assessmentId: input.assessmentId },
        data: { legalPortfolioVersionId: portfolioId },
      });
    }

    const snapshot = await tx.repositorySnapshot.findFirst({
      where: {
        id: input.snapshotId,
        assessmentId: input.assessmentId,
        status: RepositorySnapshotStatus.READY,
      },
      select: { id: true, commitSha: true },
    });
    if (!snapshot || !/^[0-9a-fA-F]{40,64}$/u.test(snapshot.commitSha)) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    // The scan-job row is the deterministic snapshot-archive ticket for sandbox hydration.
    // It is created without publishing any scan command: nothing scans or reasons here.
    const ticketKey = `runtime-hydration:${input.assessmentId}:${snapshot.id}`;
    const ticket = await tx.repositoryScanJob.upsert({
      where: { idempotencyKey: ticketKey },
      update: {},
      create: {
        id: randomUUID(),
        assessmentId: input.assessmentId,
        snapshotId: snapshot.id,
        idempotencyKey: ticketKey,
        triggerSource: RepositoryScanTriggerSource.TRUSTED,
        status: RepositoryScanJobStatus.QUEUED,
        correlationId: input.correlationId,
      },
      select: { id: true },
    });
    await tx.assessmentCase.update({
      where: { assessmentId: input.assessmentId },
      data: {
        repositorySnapshotId: snapshot.id,
        repositoryScanJobId: ticket.id,
        repositoryCommit: snapshot.commitSha.toLowerCase(),
      },
    });

    const rules = await tx.engineeringRule.findMany({
      where: { portfolioVersionId: portfolioId },
      select: { engineeringRuleId: true, engineeringRuleVersion: true },
    });
    if (rules.length === 0) {
      return { result: PREPARATION_RESULTS.WAITING_FOR_LEGAL_PORTFOLIO };
    }
    await tx.assessmentDecisionCoverage.createMany({
      data: rules.map((rule) => ({
        assessmentId: input.assessmentId,
        engineeringRuleId: rule.engineeringRuleId,
        portfolioVersionId: portfolioId,
        engineeringRuleVersion: rule.engineeringRuleVersion,
      })),
      skipDuplicates: true,
    });

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
        // Identifiers only: the Root loads everything else from server state with its lease.
        payload: { assessmentId: input.assessmentId },
      }),
      tx,
    );
    return { result: PREPARATION_RESULTS.ACTIVATED };
  }
}
