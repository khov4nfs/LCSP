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
    const ruleSet = await tx.complianceRuleSetVersion.findFirst({
      where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
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
   * 2. Confirm a nonempty catalog and create legacy coverage when applicable.
   * Failure cases:
   * - Missing Rule Set returns WAITING; invalid snapshot rejects the transaction.
   * Side effects:
   * - Writes pins, hydration ticket and legacy coverage within the caller's transaction.
   */
  async pinRuntimeInputsInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      snapshotId: string;
      correlationId: string;
    },
  ): Promise<{ result: PinResult }> {
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
        where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
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
      snapshotId: string;
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
      where: { assessmentId: input.assessmentId }, select: { auditMode: true },
    });
    if (auditCase.auditMode === AssessmentAuditMode.LEGACY_FULL) await this.outbox.enqueue(
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
