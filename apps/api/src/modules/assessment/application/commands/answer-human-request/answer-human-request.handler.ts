import { randomUUID } from "node:crypto";
import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  BLOCKER_REASONS,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  assessmentBlockerSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  humanAnswerAuditSchema,
  type AnswerAssessmentHumanRequestResult,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { z } from "zod";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { canonicalJson, sha256Hex } from "../../../domain/domain-ids.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentHumanRequestSupport } from "../../../infrastructure/persistence/assessment-human-request-support.service.js";
import { humanRequestDependenciesOf } from "../../../infrastructure/persistence/assessment-human-request-dependencies.js";
import {
  humanRequestScopeWhere,
  loadHumanRequestRuleScopeInTx,
} from "../../../infrastructure/persistence/assessment-human-request-scope.js";
import { buildHumanAnswerReviewAuthorization } from "../../services/assessment-human-answer-review.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentEvidenceInvalidation } from "../../services/assessment-evidence-invalidation.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AnswerHumanRequestCommand } from "./answer-human-request.command.js";

/** Facts only. Owner/request/case CAS, answer history, evidence/fact and conditional same-thread
 * resume commit atomically. Unknown answers remain unresolved and may schedule a review-only Root continuation. */
@CommandHandler(AnswerHumanRequestCommand)
export class AnswerHumanRequestHandler implements ICommandHandler<AnswerHumanRequestCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AssessmentHumanRequestSupport,
    private readonly cases: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
    private readonly invalidation: AssessmentEvidenceInvalidation,
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly outbox: OutboxRepository,
    private readonly audit: AuditWriterService,
  ) {}

  /**
   * Business purpose: Record an authenticated customer's factual answer and resume the same Assessment only when its human blockers are resolved.
   *
   * Business rules:
   * - Only the Assessment owner may answer an open request at the current request and case revisions and its bound native checkpoint.
   * - Exact idempotent replays preserve the original result; a conflicting payload or actor is rejected.
   * - A known answer supplies human-owned text, while the agent-authored question remains explicitly labelled context rather than a customer assertion.
   * - Typed choice answers snapshot their canonical value and label in immutable evidence while preserving raw answer value.
   * - Unknown answers keep the request open and create no accepted fact or case revision.
   * - Once every open dependency has an unknown response at the current checkpoint, enqueue one review-only continuation while preserving WAITING_FOR_HUMAN.
   * - A shared request resolves one fact; only dependencies in the current audit return to investigation after their other open requests resolve.
   * - Historical requests outside selected membership neither authorize an answer nor block this audit's continuation.
   *
   * Execution flow:
   * 1. Lock the owned Assessment, validate replay identity, revisions, checkpoint and any selected choice.
   * 2. For a known answer, advance the case revision, invalidate affected current decisions, snapshot choice meaning, and persist answer evidence and a provenance-labelled fact.
   * 3. Append checkpoint-bound answer history, update each dependent rule's coverage, and enqueue normal resume after all blockers resolve or a review-only continuation after all open dependencies have replied UNKNOWN.
   *
   * Failure cases:
   * - Missing, closed, stale, conflicting or checkpoint-mismatched requests are rejected with the existing domain problem codes.
   * - An invalid choice is rejected; transaction failure rolls back facts, history, lifecycle and outbox effects together.
   *
   * Side effects:
   * - Atomically persists the answer and audit history; a known answer also writes evidence/fact links and may transition the lifecycle and enqueue Root continuation.
   * - Preserves historical answers and decision packets; it does not interpret the answer or author a compliance decision.
   */
  execute(
    input: AnswerHumanRequestCommand,
  ): Promise<AnswerAssessmentHumanRequestResult> {
    const requestDigest = sha256Hex(canonicalJson(input.request));
    const actor = { id: input.actor.userId, type: AUDIT_ACTOR_TYPES.user };
    const reject = (code: string) =>
      problemException(code, input.correlationId, {
        status: HttpStatus.CONFLICT,
      });
    return this.prisma.$transaction(async (tx) => {
      const assessment = await this.support.requireOwner(tx, input, true);
      const row = await tx.assessmentHumanRequest.findFirst({
        where: { assessmentId: input.assessmentId, requestId: input.requestId },
        include: { dependencies: true },
      });
      if (!row)
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      const auditRequestId = assessment.runtime?.currentAuditRequestId;
      const ruleScope = await loadHumanRequestRuleScopeInTx(tx, {
        assessmentId: input.assessmentId,
        auditRequestId,
        correlationId: input.correlationId,
      });
      const activeDependencies = humanRequestDependenciesOf(row).filter(
        (dependency) =>
          ruleScope === null || ruleScope.includes(dependency.assessmentRuleId),
      );
      if (activeDependencies.length === 0)
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      const humanRequestWhere = humanRequestScopeWhere(
        input.assessmentId,
        ruleScope,
      );
      const answers = z.array(humanAnswerAuditSchema).parse(row.answers);
      const replay = answers.find(
        (answer) => answer.idempotencyKey === input.request.idempotencyKey,
      );
      if (replay) {
        if (
          replay.actorId !== actor.id ||
          replay.requestDigest !== requestDigest
        )
          throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT);
        return {
          requestId: row.requestId,
          requestRevision: replay.requestRevision,
          caseRevision: replay.caseRevision,
          status: replay.doesNotKnow
            ? HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN
            : HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
          factId: replay.doesNotKnow ? null : row.resolvedFactId,
          resumed: false,
          replayed: true,
        };
      }
      if (row.status !== HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN)
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_CLOSED);
      if (row.requestRevision !== input.request.expectedRequestRevision)
        throw reject(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_REVISION_STALE,
        );
      await this.cases.lockCase(tx, input.assessmentId);
      const pins = await this.cases.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      if (pins.caseRevision !== input.request.expectedCaseRevision)
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.CASE_REVISION_STALE);
      const runtime = assessment.runtime;
      if (
        !runtime ||
        runtime.threadId !== row.threadId ||
        !row.checkpointId ||
        row.checkpointId !== runtime.checkpointId ||
        ![
          AGENT_EXECUTION_STATES.INTERRUPTED,
          AGENT_EXECUTION_STATES.PAUSED,
        ].some((state) => state === runtime.executionState)
      ) {
        throw reject(ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID);
      }
      const answer = input.request.doesNotKnow ? null : input.request.answer;
      const choices = z
        .array(z.object({ value: z.string() }))
        .parse(row.choices);
      if (
        answer !== null &&
        row.controlType === HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT &&
        !choices.some((choice) => choice.value === answer)
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_ANSWER_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      let factId: string | null = null;
      let caseRevision = pins.caseRevision;
      const requestRevision = row.requestRevision + 1;
      const choicesList = Array.isArray(row.choices)
        ? (row.choices as Array<{ value: string; label: string }>)
        : [];
      const selectedChoice =
        answer !== null
          ? (choicesList.find((choice) => choice.value === answer) ?? null)
          : null;
      if (answer !== null) {
        caseRevision += 1;
        await tx.assessmentCase.update({
          where: { assessmentId: input.assessmentId },
          data: { caseRevision },
        });
        await this.invalidation.invalidateCaseRevisionInTx(
          tx,
          input.assessmentId,
          caseRevision,
        );
        const evidenceId = randomUUID();
        const payload = {
          requestId: row.requestId,
          actorId: actor.id,
          answer,
          selectedChoice: selectedChoice
            ? { value: selectedChoice.value, label: selectedChoice.label }
            : null,
          controlType: row.controlType,
          caseRevision,
          requestRevision,
        };
        await tx.assessmentEvidence.create({
          data: {
            evidenceId,
            assessmentId: input.assessmentId,
            type: ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER,
            repositoryCommit: pins.repositoryCommit,
            contentSha256: `sha256:${sha256Hex(canonicalJson(payload))}`,
            payload,
          },
        });
        factId = randomUUID();
        const answerDisplay = selectedChoice
          ? `${selectedChoice.label} (${selectedChoice.value})`
          : answer;
        await tx.assessmentCaseFact.create({
          data: {
            factId,
            assessmentId: input.assessmentId,
            caseRevision,
            kind: ASSESSMENT_FACT_KINDS.FACT,
            authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
            statement: `Customer answer: ${answerDisplay}\nAgent-authored question (context only): ${row.question}`,
          },
        });
        await tx.assessmentCaseFactEvidence.create({
          data: { assessmentId: input.assessmentId, factId, evidenceId },
        });
        await this.events.appendInTx(tx, {
          assessmentId: input.assessmentId,
          correlationId: input.correlationId,
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EVIDENCE_ACCEPTED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
          payload: {
            evidenceId,
            caseRevision,
          },
          auditActor: actor,
        });
      }
      const status =
        answer === null
          ? HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN
          : HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED;
      await tx.assessmentHumanRequest.update({
        where: { requestId: row.requestId },
        data: {
          requestRevision,
          status,
          answers: [
            ...answers,
            {
              idempotencyKey: input.request.idempotencyKey,
              requestDigest,
              actorId: actor.id,
              answeredAt: new Date().toISOString(),
              caseRevision,
              requestRevision,
              doesNotKnow: answer === null,
              answer,
              selectedChoice: selectedChoice
                ? { value: selectedChoice.value, label: selectedChoice.label }
                : null,
              checkpointId: row.checkpointId,
            },
          ],
          ...(factId ? { resolvedFactId: factId, resolvedAt: new Date() } : {}),
        },
      });
      if (factId) {
        for (const dependency of activeDependencies) {
          const remaining = await tx.assessmentHumanRequestDependency.count({
            where: {
              assessmentId: input.assessmentId,
              assessmentRuleId: dependency.assessmentRuleId,
              request: { status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN },
            },
          });
          if (remaining === 0) {
            await tx.assessmentDecisionCoverage.updateMany({
              where: {
                assessmentId: input.assessmentId,
                assessmentRuleId: dependency.assessmentRuleId,
                resolutionState: DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT,
              },
              data: {
                resolutionState: DECISION_RESOLUTION_STATES.INVESTIGATING,
              },
            });
          }
        }
      }
      if (factId)
        await this.events.appendInTx(tx, {
          assessmentId: input.assessmentId,
          correlationId: input.correlationId,
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
          payload: {
            requestId: row.requestId,
            fromStatus: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            toStatus: status,
            caseRevision,
          },
          auditActor: actor,
        });
      await this.audit.writeInTx(
        {
          eventType: ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.HUMAN_ANSWER_RECORDED,
          actorId: actor.id,
          actor,
          assessmentId: input.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: input.assessmentId,
          decision: AUDIT_DECISIONS.allow,
          correlationId: input.correlationId,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            requestId: row.requestId,
            requestRevision,
            caseRevision,
            doesNotKnow: answer === null,
          },
        },
        tx,
      );
      let resumed = false;
      const openCount = await tx.assessmentHumanRequest.count({
        where: {
          ...humanRequestWhere,
          status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
        },
      });
      const blocker = assessmentBlockerSchema.safeParse({
        reason: assessment.blockerReason,
        reference: assessment.blockerReference,
      });
      const resolvedHumanBlocker =
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
        blocker.success &&
        blocker.data.reason === BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE &&
        (await tx.assessmentHumanRequest.count({
          where: {
            ...humanRequestWhere,
            requestId: blocker.data.reference.humanResolutionRequestId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
          },
        })) === 1;
      if (
        factId &&
        openCount === 0 &&
        (assessment.lifecycleState ===
          ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
          resolvedHumanBlocker) &&
        runtime.executionState === AGENT_EXECUTION_STATES.INTERRUPTED
      ) {
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: input.assessmentId,
            expectedRevision: assessment.lifecycleRevision!,
            toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
            correlationId: input.correlationId,
            actorId: actor.id,
          },
          tx,
          [
            AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
            AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
            AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
            ...(resolvedHumanBlocker
              ? [
                  AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_NEW_RESOLVABLE_INPUT_ACCEPTED,
                ]
              : []),
          ],
          actor,
        );
        await this.outbox.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: input.assessmentId,
            assessmentId: input.assessmentId,
            eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            correlationId: input.correlationId,
            causationId: input.correlationId,
            actor,
            result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            idempotencyKey: `human-resume:${input.assessmentId}:${runtime.checkpointId}`,
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
        resumed = true;
      }
      if (
        !resumed &&
        openCount > 0 &&
        assessment.lifecycleState ===
          ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN &&
        runtime.executionState === AGENT_EXECUTION_STATES.INTERRUPTED
      ) {
        const review = buildHumanAnswerReviewAuthorization(
          await tx.assessmentHumanRequest.findMany({
            where: {
              ...humanRequestWhere,
              status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            },
          }),
          {
            assessmentId: input.assessmentId,
            threadId: runtime.threadId,
            checkpointId: runtime.checkpointId,
          },
        );
        if (review) {
          await this.outbox.enqueue(
            buildOutboxMessageInput({
              aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
              aggregateId: input.assessmentId,
              assessmentId: input.assessmentId,
              eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
              correlationId: input.correlationId,
              causationId: input.correlationId,
              actor,
              result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
              redactionStatus: AUDIT_REDACTION_STATUSES.none,
              idempotencyKey: `human-review:${input.assessmentId}:${runtime.checkpointId}`,
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
          resumed = true;
        }
      }
      return {
        requestId: row.requestId,
        requestRevision,
        caseRevision,
        status,
        factId,
        resumed,
        replayed: false,
      };
    });
  }
}
