import { randomUUID } from "node:crypto";
import { Client } from "pg";

import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  BLOCKER_REASONS,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  assessmentBlockerSchema,
  type AgentExecutionState,
  type AssessmentLifecycleState,
  type BlockerReason,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_BUDGET_REASONS,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  RULE_AUDIT_STATUSES,
  ASSESSMENT_DOMAIN_LIMITS,
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ROOT_CAPACITY_REASONS,
  type AssessmentRootClaim,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, OutboxStatus } from "@prisma/client";
import { calculateConsecutiveTurnsWithoutProgress } from "./assessment-progress-tracker.js";

function extractSavedLocale(data: unknown): string | undefined {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const raw =
    record.responseLanguage ??
    record.response_language ??
    record.locale ??
    record.language ??
    record.lcsp_locale;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";
import { AssessmentLifecycleCoordinator } from "./assessment-lifecycle-coordinator.service.js";
import { AssessmentEventAppender } from "./assessment-event-appender.service.js";
import { AssessmentRootCapacityService } from "./assessment-root-capacity.service.js";
import {
  humanRequestScopeWhere,
  loadHumanRequestRuleScopeInTx,
} from "../../infrastructure/persistence/assessment-human-request-scope.js";
import {
  buildHumanAnswerReviewAuthorization,
  humanReviewAllowsCheckpointRebind,
  type HumanAnswerReviewAuthorization,
  type ReviewableHumanRequest,
} from "./assessment-human-answer-review.js";

/**
 * Business purpose: Recover only the exact persisted human-answer review after an unfinished or failed native execution.
 * Business rules:
 * - Every currently open request must still match the original UNKNOWN checkpoint and revision receipt.
 * - Added, missing, resolved or changed dependencies invalidate the entire carried authorization.
 * Execution flow:
 * 1. Read the server-persisted checkpoint and dependency receipt shape.
 * 2. Revalidate all open requests and compare the complete authorized request set.
 * Failure cases:
 * - Malformed, stale or cross-scope receipts return null and grant no review or checkpoint rebinding.
 * Side effects:
 * - Pure validation; no answer, fact, lease, checkpoint or lifecycle is changed.
 */
function revalidatePersistedHumanAnswerReview(
  requests: readonly ReviewableHumanRequest[],
  binding: { assessmentId: string; threadId: string },
  authorization: unknown,
): HumanAnswerReviewAuthorization | null {
  if (
    !authorization ||
    typeof authorization !== "object" ||
    Array.isArray(authorization)
  )
    return null;
  const stored = authorization as Record<string, unknown>;
  if (
    typeof stored.checkpointId !== "string" ||
    !Array.isArray(stored.requests) ||
    stored.requests.length !== requests.length ||
    !requests.every((request) =>
      humanReviewAllowsCheckpointRebind(request, authorization),
    )
  )
    return null;
  return buildHumanAnswerReviewAuthorization(requests, {
    ...binding,
    checkpointId: stored.checkpointId,
  });
}

/**
 * Business purpose: Keep resume and human-review authority inside the current assessment's native audit thread.
 * Business rules:
 * - Selected turns must bind both the current audit UUID and its checkpoint thread; legacy turns cannot carry selected-audit authority.
 * Execution flow:
 * 1. Match the persisted assessment, logical thread and Root boundary.
 * 2. Match selected audit/checkpoint metadata, or the explicit unselected legacy metadata.
 * Failure cases:
 * - Missing, foreign or malformed turn metadata returns false and cannot authorize review or checkpoint reuse.
 * Side effects:
 * - Pure identity guard; changes no lease, turn or checkpoint.
 */
function rootTurnMatchesScope(
  turn: {
    assessmentId: string;
    threadId: string;
    boundary: string;
    contextJson: unknown;
  } | null,
  binding: {
    assessmentId: string;
    threadId: string;
    auditRequestId: string | null | undefined;
  },
): boolean {
  if (
    !turn ||
    turn.assessmentId !== binding.assessmentId ||
    turn.threadId !== binding.threadId ||
    turn.boundary !== ASSESSMENT_ROOT_BOUNDARY
  )
    return false;
  const context =
    turn.contextJson &&
    typeof turn.contextJson === "object" &&
    !Array.isArray(turn.contextJson)
      ? (turn.contextJson as Record<string, unknown>)
      : null;
  return binding.auditRequestId
    ? context?.auditRequestId === binding.auditRequestId &&
        context?.checkpointThreadId === binding.auditRequestId
    : context?.auditRequestId == null &&
        (context?.checkpointThreadId == null ||
          context.checkpointThreadId === binding.threadId);
}

export interface AuthorizedRootRun {
  assessmentId: string;
  threadId: string;
  executionId: string;
  auditRequestId: string | null;
  lifecycleState: string;
  lifecycleRevision: number;
  blockerReason: BlockerReason | null;
  blockerReference: Prisma.JsonValue | null;
}

const ROOT_ACTOR = {
  id: AUDIT_ACTOR_IDS.assessmentRootAgent,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

const NATIVE_ROOT_CHECKPOINT_NAMESPACE = "";
const NATIVE_ROOT_BOUNDARY_NAME = "assessment_root_requested";
const NATIVE_ROOT_AGENT_NAME = "lcsp-assessment-root";

/**
 * Server-owned Root run authority. An agent can never name its own assessment, thread,
 * execution or lease: the API issues them at claim time and every governed tool call must
 * present the lease, which is bound to exactly one assessment/thread/execution.
 */
@Injectable()
export class AssessmentRuntimeAuthority {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AssessmentEventAppender,
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly capacity: AssessmentRootCapacityService,
  ) {}

  /**
   * Business purpose: Claim the one authorized Root execution for an assessment retry or continuation.
   *
   * Business rules:
   * - A live lease excludes a competing execution; a retry after failure uses a new execution ID on the same thread.
   * - A selected request uses its immutable request UUID as a separate native Root thread; retries and Stop/Continue
   *   reuse that thread while later requests cannot see its terminal checkpoint.
   * - A failed checkpoint is resumable only when the runtime row and failed Root turn bind the same checkpoint,
   *   or a missing API checkpoint is recovered from the latest native Root checkpoint with matching persisted
   *   assessment, runtime, boundary, agent, and timestamp provenance.
   * - Missing or inconsistent checkpoint IDs and metadata grant no checkpoint authority.
   * - Human interrupts, safe pauses, and authenticated transport recovery retain their existing lifecycle guards.
   * - A fresh physical reservation must bind this exact native transport run; lease expiry never releases capacity.
   * - Both the native run and its server incarnation must match the live reservation, including during recovery.
   * - A waiting assessment may run a review-only continuation when every open dependency has a fresh UNKNOWN response at the bound checkpoint; it remains waiting and cannot submit decisions.
   * - Review authority is persisted with exact request revisions so later wait checkpoint rebinding cannot authorize unrelated or changed requests.
   * - A gracefully failed review retains its original UNKNOWN authority separately from the failed native checkpoint; retry uses a new execution and requires native ancestry verification before graph work.

   *
   * Execution flow:
   * 1. Lock the assessment/runtime and load the current Root turn.
   * 2. Validate lifecycle, lease, and any failed-turn checkpoint binding; recover a missing checkpoint only
   *    from the request-bound native checkpoint thread under the same assessment transaction.
   * 3. Issue a lease and execution identity, returning only the authorized resume checkpoint.
   *
   * Failure cases:
   * - Missing runtime, inactive lifecycle, held lease, or invalid guarded recovery returns the corresponding domain problem.
   * - A failed turn with no matching checkpoint record remains claimable as a fresh attempt without checkpoint authority.
   *
   * Side effects:
   * - Updates runtime and turn execution state, issues a lease, and appends an execution-state event when needed.
   */
  async claimRoot(input: {
    assessmentId: string;
    correlationId: string;
    runtimeRunId?: string;
    runtimeIncarnationId?: string;
  }): Promise<AssessmentRootClaim> {
    return this.prisma.$transaction(async (tx) => {
      const row = await lockAssessmentAndRuntime(tx, input.assessmentId);
      if (!row) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const auditMode = await tx.assessmentCase.findUnique({
        where: { assessmentId: input.assessmentId },
        select: { auditMode: true },
      });
      if (auditMode?.auditMode === ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED) {
        const auditRequest = row.currentAuditRequestId
          ? await tx.assessmentRuleAuditRequest.findUnique({
              where: { requestId: row.currentAuditRequestId },
            })
          : null;
        if (
          !auditRequest ||
          auditRequest.assessmentId !== input.assessmentId ||
          (auditRequest.status === RULE_AUDIT_STATUSES.COMPLETED &&
            !(
              row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE &&
              row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
              Boolean(input.runtimeRunId)
            )) ||
          auditRequest.status === RULE_AUDIT_STATUSES.CANCELLED
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }
      const humanRequestRuleScope = await loadHumanRequestRuleScopeInTx(tx, {
        assessmentId: input.assessmentId,
        auditRequestId: row.currentAuditRequestId,
        correlationId: input.correlationId,
      });
      const humanRequestWhere = humanRequestScopeWhere(
        input.assessmentId,
        humanRequestRuleScope,
      );
      const previousTurn = row.currentExecutionId
        ? await tx.assessmentRuntimeTurn.findUnique({
            where: { id: row.currentExecutionId },
          })
        : null;
      const previousContextJson =
        previousTurn?.contextJson &&
        typeof previousTurn.contextJson === "object" &&
        !Array.isArray(previousTurn.contextJson)
          ? previousTurn.contextJson
          : null;
      const previousTurnMatchesScope = rootTurnMatchesScope(previousTurn, {
        assessmentId: input.assessmentId,
        threadId: row.threadId,
        auditRequestId: row.currentAuditRequestId,
      });
      const previousRuntimeRunId = previousContextJson?.runtimeRunId;
      const failedCheckpointJson =
        previousTurn?.checkpointJson &&
        typeof previousTurn.checkpointJson === "object" &&
        !Array.isArray(previousTurn.checkpointJson)
          ? previousTurn.checkpointJson
          : null;
      const failedCheckpointId =
        row.executionState === AGENT_EXECUTION_STATES.FAILED &&
        row.checkpointId &&
        previousTurn?.assessmentId === input.assessmentId &&
        previousTurn.threadId === row.threadId &&
        previousTurnMatchesScope &&
        previousTurn.boundary === ASSESSMENT_ROOT_BOUNDARY &&
        previousTurn.state === Controls.completed &&
        failedCheckpointJson?.checkpointId === row.checkpointId
          ? row.checkpointId
          : null;
      const caseRow = tx.assessmentCase
        ? await tx.assessmentCase.findUnique({
            where: { assessmentId: input.assessmentId },
            select: {
              ruleSetVersionId: true,
              repositorySnapshotId: true,
              repositoryCommit: true,
              caseRevision: true,
            },
          })
        : null;
      const nativeCheckpointRecovery =
        row.executionState === AGENT_EXECUTION_STATES.FAILED &&
        row.checkpointId === null &&
        previousTurn?.id === row.currentExecutionId &&
        previousTurn.assessmentId === input.assessmentId &&
        previousTurn.threadId === row.threadId &&
        previousTurn.boundary === ASSESSMENT_ROOT_BOUNDARY &&
        previousTurn.state === Controls.completed &&
        previousTurn.checkpointJson === null &&
        previousTurnMatchesScope &&
        typeof previousRuntimeRunId === "string" &&
        previousRuntimeRunId.length > 0
          ? await findFailedNativeCheckpoint(tx, {
              assessmentId: input.assessmentId,
              threadId: row.currentAuditRequestId ?? row.threadId,
              checkpointNamespace: NATIVE_ROOT_CHECKPOINT_NAMESPACE,
              auditRequestId: row.currentAuditRequestId,
              runtimeRunId: previousRuntimeRunId,
              turnCreatedAt: previousTurn.createdAt,
              turnUpdatedAt: previousTurn.updatedAt,
              casePins: caseRow ?? undefined,
            })
          : null;
      const resumedCheckpointId =
        failedCheckpointId ?? nativeCheckpointRecovery?.checkpointId ?? null;
      const nativeCheckpointRecoveryContext = nativeCheckpointRecovery && {
        nativeCheckpointRecovery: {
          checkpointId: nativeCheckpointRecovery.checkpointId,
          checkpointTimestamp: nativeCheckpointRecovery.checkpointTimestamp,
          resumedFromExecutionId: previousTurn?.id ?? null,
          recoverySource: "NATIVE_CHECKPOINT_METADATA",
        },
      };
      const recoveredExecution = Boolean(
        input.runtimeRunId &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
        previousTurn?.boundary === ASSESSMENT_ROOT_BOUNDARY &&
        previousTurn.assessmentId === input.assessmentId &&
        previousTurn.threadId === row.threadId &&
        previousTurnMatchesScope &&
        (previousTurn.contextJson as Prisma.JsonObject)?.runtimeRunId ===
          input.runtimeRunId,
      );
      // The authenticated transport serializes this persisted run with a PostgreSQL thread lock.
      const recoveredComplete =
        recoveredExecution &&
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE;
      const blockedRequestId = humanFactBlockerRequestId(row);
      const blockedHumanWait =
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
        blockedRequestId !== null &&
        (await tx.assessmentHumanRequest.count({
          where: {
            ...humanRequestWhere,
            requestId: blockedRequestId,
            threadId: row.threadId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
        })) === 1;
      const recoveringHumanInterrupt =
        (row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
          blockedHumanWait) &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
        row.leaseExpiresAt !== null &&
        row.leaseExpiresAt <= new Date();
      const reviewableLifecycle =
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
        blockedHumanWait;
      const openHumanRequests =
        reviewableLifecycle &&
        row.currentExecutionId !== null &&
        row.checkpointId !== null &&
        (row.executionState === AGENT_EXECUTION_STATES.INTERRUPTED ||
          recoveredExecution ||
          recoveringHumanInterrupt ||
          failedCheckpointId !== null)
          ? await tx.assessmentHumanRequest.findMany({
              where: {
                ...humanRequestWhere,
                status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
              },
            })
          : [];
      const humanAnswerReview =
        previousTurnMatchesScope &&
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN
          ? buildHumanAnswerReviewAuthorization(openHumanRequests, {
              assessmentId: input.assessmentId,
              threadId: row.threadId,
              checkpointId: row.checkpointId,
            })
          : null;
      const previousReview = previousTurnMatchesScope
        ? revalidatePersistedHumanAnswerReview(
            openHumanRequests,
            { assessmentId: input.assessmentId, threadId: row.threadId },
            previousContextJson?.humanAnswerReview,
          )
        : null;
      // A failed native checkpoint may be newer than the request's original UNKNOWN
      // checkpoint. Preserve both identities; the runner proves their ancestry before work.
      const failedHumanAnswerReview =
        reviewableLifecycle && failedCheckpointId !== null
          ? previousReview
          : null;
      // Unfinished transport recovery keeps the original producer of the server-bound
      // checkpoint even when a prior failed retry already began a new execution.
      const carriedHumanAnswerReview =
        recoveringHumanInterrupt || (recoveredExecution && reviewableLifecycle)
          ? previousReview
          : null;
      const reviewContext =
        humanAnswerReview ??
        failedHumanAnswerReview ??
        carriedHumanAnswerReview;
      const reviewExecutionId = reviewContext
        ? failedHumanAnswerReview || humanAnswerReview
          ? row.currentExecutionId
          : typeof previousContextJson?.humanAnswerReviewExecutionId ===
              "string"
            ? previousContextJson.humanAnswerReviewExecutionId
            : row.currentExecutionId
        : null;
      const reviewCheckpointId =
        reviewContext &&
        typeof reviewContext === "object" &&
        !Array.isArray(reviewContext) &&
        typeof reviewContext.checkpointId === "string"
          ? reviewContext.checkpointId
          : null;
      const recoveringReviewedHumanWait =
        recoveringHumanInterrupt && reviewCheckpointId !== null;
      const safePauseResume =
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PAUSED &&
        row.executionState === AGENT_EXECUTION_STATES.PAUSED &&
        row.currentExecutionId &&
        row.checkpointId
          ? await tx.assessmentRuntimeTurn.findFirst({
              where: {
                id: row.currentExecutionId,
                assessmentId: input.assessmentId,
                threadId: row.threadId,
                boundary: ASSESSMENT_ROOT_BOUNDARY,
                state: Controls.resumeRequested,
              },
            })
          : null;
      if (
        row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
        !recoveringHumanInterrupt &&
        !humanAnswerReview &&
        !failedHumanAnswerReview &&
        !safePauseResume &&
        !recoveredComplete &&
        !(
          recoveredExecution &&
          (row.lifecycleState ===
            ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
            blockedHumanWait)
        )
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const now = new Date();
      if (
        row.leaseToken &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt > now &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
        !recoveredExecution
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_HELD,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const blockerRef =
        row.blockerReference &&
        typeof row.blockerReference === "object" &&
        !Array.isArray(row.blockerReference)
          ? (row.blockerReference as Record<string, unknown>)
          : {};
      const overrideNoProgress = blockerRef.overrideNoProgress === true;
      const configuredNoProgressLimit =
        Number(process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT) > 0
          ? Number(process.env.LCSP_ASSESSMENT_NO_PROGRESS_LIMIT)
          : 15;
      if (
        !overrideNoProgress &&
        !safePauseResume &&
        !recoveringHumanInterrupt &&
        !humanAnswerReview &&
        !failedHumanAnswerReview &&
        !recoveredExecution
      ) {
        const consecutiveTurnsWithoutProgress =
          await calculateConsecutiveTurnsWithoutProgress(
            tx,
            input.assessmentId,
          );
        if (consecutiveTurnsWithoutProgress >= configuredNoProgressLimit) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.NO_PROGRESS_LIMIT_REACHED,
            input.correlationId,
            {
              status: HttpStatus.CONFLICT,
              meta: {
                consecutiveTurnsWithoutProgress,
                noProgressLimit: configuredNoProgressLimit,
              },
            },
          );
        }
      }
      // A human interrupt or safe pause resumes the SAME execution; a failed, finished or
      // never-started one begins a new execution ID on the same thread (retry semantics).
      await this.capacity.bindInTx(
        tx,
        input.assessmentId,
        input.runtimeRunId,
        input.correlationId,
        input.runtimeIncarnationId,
      );
      const recoveringStop = row.currentExecutionId
        ? await tx.assessmentRuntimeTurn.findFirst({
            where: {
              id: row.currentExecutionId,
              assessmentId: input.assessmentId,
              threadId: row.threadId,
              boundary: ASSESSMENT_ROOT_BOUNDARY,
              state: Controls.stopRequested,
            },
          })
        : null;
      const resumesSameExecution =
        row.currentExecutionId !== null &&
        (row.executionState === AGENT_EXECUTION_STATES.INTERRUPTED ||
          row.executionState === AGENT_EXECUTION_STATES.PAUSED ||
          Boolean(recoveringStop) ||
          recoveredExecution ||
          recoveringReviewedHumanWait);
      const executionId = resumesSameExecution
        ? (row.currentExecutionId as string)
        : randomUUID();
      const previousState = resumesSameExecution
        ? row.executionState
        : AGENT_EXECUTION_STATES.QUEUED;
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + ASSESSMENT_DOMAIN_LIMITS.LEASE_SECONDS * 1000,
      );
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: {
          currentExecutionId: executionId,
          executionState: AGENT_EXECUTION_STATES.RUNNING,
          ...(nativeCheckpointRecovery
            ? { checkpointId: nativeCheckpointRecovery.checkpointId }
            : {}),
          leaseToken,
          leaseExpiresAt,
          startedAt: now,
          lastResumedAt: now,
        },
      });
      if (row.currentAuditRequestId) {
        await tx.assessmentRuleAuditRequest.update({
          where: { requestId: row.currentAuditRequestId },
          data: { status: RULE_AUDIT_STATUSES.RUNNING },
        });
      }
      const [latestCommand] = await Promise.all([
        tx.outboxMessage?.findFirst
          ? tx.outboxMessage.findFirst({
              where: {
                aggregateId: input.assessmentId,
                eventType: ASSESSMENT_ROOT_COMMAND_TYPES["ROOT_REQUESTED"],
              },
              orderBy: { createdAt: "desc" },
              select: { payload: true },
            })
          : Promise.resolve(null),
      ]);
      const persistedLanguage =
        extractSavedLocale(latestCommand?.payload) ??
        extractSavedLocale(previousTurn?.contextJson);

      await tx.assessmentRuntimeTurn.upsert({
        where: { id: executionId },
        create: {
          id: executionId,
          assessmentId: input.assessmentId,
          threadId: row.threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: executionId,
          correlationId: input.correlationId,
          state: Controls.running,
          contextJson: {
            startCaseRevision: caseRow?.caseRevision ?? 0,
            ...(persistedLanguage
              ? { responseLanguage: persistedLanguage }
              : {}),
            ...(input.runtimeRunId ? { runtimeRunId: input.runtimeRunId } : {}),
            ...(row.currentAuditRequestId
              ? {
                  auditRequestId: row.currentAuditRequestId,
                  checkpointThreadId: row.currentAuditRequestId,
                }
              : {}),
            ...(nativeCheckpointRecoveryContext ?? {}),
            humanAnswerReview: reviewContext,
            humanAnswerReviewExecutionId: reviewExecutionId,
          },
          ...(nativeCheckpointRecovery
            ? {
                checkpointJson: {
                  checkpointId: nativeCheckpointRecovery.checkpointId,
                  resumedFromExecutionId: previousTurn?.id ?? null,
                  recoverySource: "NATIVE_CHECKPOINT_METADATA",
                },
              }
            : {}),
        },
        update: {
          state: recoveringStop ? Controls.stopRequested : Controls.running,
          contextJson: {
            ...((previousTurn?.contextJson as Prisma.JsonObject) ?? {}),
            ...(typeof (
              previousTurn?.contextJson as Record<string, unknown> | null
            )?.startCaseRevision !== "number"
              ? { startCaseRevision: caseRow?.caseRevision ?? 0 }
              : {}),
            ...(persistedLanguage
              ? { responseLanguage: persistedLanguage }
              : {}),
            ...(input.runtimeRunId ? { runtimeRunId: input.runtimeRunId } : {}),
            ...(row.currentAuditRequestId
              ? {
                  auditRequestId: row.currentAuditRequestId,
                  checkpointThreadId: row.currentAuditRequestId,
                }
              : {}),
            ...(nativeCheckpointRecoveryContext ?? {}),
            humanAnswerReview: reviewContext,
            humanAnswerReviewExecutionId: reviewExecutionId,
          },
        },
      });
      if (safePauseResume) {
        if (
          await tx.assessmentHumanRequest.count({
            where: {
              assessmentId: input.assessmentId,
              status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            },
          })
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        await this.coordinator.transitionVerifiedInTx(
          {
            assessmentId: input.assessmentId,
            expectedRevision: row.lifecycleRevision!,
            toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
            correlationId: input.correlationId,
            actorId: ROOT_ACTOR.id,
          },
          tx,
          [
            AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
            AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
            AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
          ],
          ROOT_ACTOR,
        );
      }
      if (previousState !== AGENT_EXECUTION_STATES.RUNNING) {
        await this.events.appendInTx(tx, {
          assessmentId: input.assessmentId,
          correlationId: input.correlationId,
          eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
          executionId,
          payload: {
            fromState: previousState,
            toState: AGENT_EXECUTION_STATES.RUNNING,
          },
          auditActor: ROOT_ACTOR,
        });
      }
      return {
        assessmentId: input.assessmentId,
        threadId: row.threadId,
        checkpointThreadId: row.currentAuditRequestId ?? row.threadId,
        executionId,
        leaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        checkpointNamespace: row.checkpointNamespace,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
        resumeCheckpointId: resumesSameExecution
          ? row.checkpointId
          : resumedCheckpointId,
        lifecycleState: safePauseResume
          ? ASSESSMENT_LIFECYCLE_STATES.ACTIVE
          : row.lifecycleState!,
        recoveredExecution: recoveredExecution || recoveringReviewedHumanWait,
        humanAnswerReviewRequired:
          row.lifecycleState ===
            ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN &&
          reviewContext !== null,
        humanAnswerReviewExecutionId: reviewExecutionId,
        humanAnswerReviewCheckpointId: reviewCheckpointId,
      };
    });
  }

  /**
   * Business purpose: Bind every governed Root tool write to the current leased execution and scope.
   * Business rules:
   * - Only an unexpired RUNNING lease may write; active-only tools require the ACTIVE lifecycle.
   * Execution flow:
   * 1. Lock assessment and runtime in the canonical order.
   * 2. Validate lease, execution identity and lifecycle before returning request identity.
   * Failure cases:
   * - Missing runtime, stale lease or inactive case rejects without a domain write.
   * Side effects:
   * - Holds transaction locks for the caller; this helper is otherwise read-only.
   */
  async authorizeInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      leaseToken: string | undefined;
      correlationId: string;
      requireActive?: boolean;
    },
  ): Promise<AuthorizedRootRun> {
    const row = await lockAssessmentAndRuntime(tx, input.assessmentId);
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      !input.leaseToken ||
      row.leaseToken !== input.leaseToken ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt <= new Date() ||
      row.executionState !== AGENT_EXECUTION_STATES.RUNNING ||
      !row.currentExecutionId
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
        input.correlationId,
        { status: HttpStatus.FORBIDDEN },
      );
    }
    if (
      (input.requireActive ?? true) &&
      row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return {
      assessmentId: input.assessmentId,
      threadId: row.threadId,
      executionId: row.currentExecutionId,
      auditRequestId: row.currentAuditRequestId,
      lifecycleState: row.lifecycleState ?? "",
      lifecycleRevision: row.lifecycleRevision ?? 0,
      blockerReason: row.blockerReason,
      blockerReference: row.blockerReference,
    };
  }

  /**
   * Business purpose: Restrict every selected-mode Root mutation to rules in its immutable claimed request.
   *
   * Business rules:
   * - A non-null audit request grants authority only for membership rows in that request; historical coverage
   *   and prior accepted decisions do not grant membership. A null request is the explicit legacy full-audit path.
   *
   * Execution flow:
   * 1. Read the exact request/rule membership under the caller's existing transaction and locks.
   * 2. Return only for a current member; reject absent membership before the caller performs side effects.
   *
   * Failure cases:
   * - A selected request that does not contain the rule fails with REQUEST_INVALID and HTTP 403.
   *
   * Side effects:
   * - Performs a read-only membership lookup.
   */
  async requireSelectedRuleMembershipInTx(
    tx: Prisma.TransactionClient,
    run: AuthorizedRootRun,
    assessmentRuleId: string,
    correlationId: string,
  ): Promise<void> {
    if (!run.auditRequestId) return;
    const member = await tx.assessmentRuleAuditItem.findUnique({
      where: {
        requestId_assessmentRuleId: {
          requestId: run.auditRequestId,
          assessmentRuleId,
        },
      },
      select: { assessmentRuleId: true },
    });
    if (!member)
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
        correlationId,
        { status: HttpStatus.FORBIDDEN },
      );
  }

  async authorize(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
    requireActive?: boolean;
  }): Promise<AuthorizedRootRun> {
    return this.prisma.$transaction((tx) => this.authorizeInTx(tx, input));
  }

  async heartbeat(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
  }): Promise<{ leaseExpiresAt: string }> {
    return this.prisma.$transaction(async (tx) => {
      await this.authorizeInTx(tx, { ...input, requireActive: false });
      const leaseExpiresAt = new Date(
        Date.now() + ASSESSMENT_DOMAIN_LIMITS.LEASE_SECONDS * 1000,
      );
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: { leaseExpiresAt },
      });
      return { leaseExpiresAt: leaseExpiresAt.toISOString() };
    });
  }

  /**
   * Business purpose: Settle the leased Root execution and its durable human wait without releasing physical occupancy or declaring a legal outcome.
   * Business rules:
   * - The current lease, assessment, selected audit and native checkpoint bindings remain authoritative.
   * - Human waits name exactly the active audit's open dependencies; only a stored review of unchanged revisions permits checkpoint rebinding.
   * - Uncertain crash work may settle only FAILED and quarantines the admitted command; SUCCEEDED requires the completed audit or full report.
   * Execution flow:
   * 1. Lock and authorize the Root and validate the terminal or interruption request.
   * 2. Verify pause authority or all scoped human blockers and any review checkpoint rebind.
   * 3. Persist runtime, request and turn settlement, quarantining uncertain commands when required.
   * 4. Append the execution event; physical termination is established separately by the native future.
   * Failure cases:
   * - Invalid lease, foreign audit/checkpoint, changed review revisions, unproven success or invalid recovery reservation rolls back settlement.
   * Side effects:
   * - Updates runtime, scoped requests, turns, outbox and events; preserves accepted facts and the authoritative Completion Gate.
   */

  async finishExecution(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
    toState: AgentExecutionState;
    checkpointId?: string;
    requestIds?: string[];
    controlRequestId?: string;
    recoveryRequired?: boolean;
    reason?: string;
  }): Promise<{ executionState: AgentExecutionState }> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      if (
        ![
          AGENT_EXECUTION_STATES.INTERRUPTED,
          AGENT_EXECUTION_STATES.PAUSED,
          AGENT_EXECUTION_STATES.SUCCEEDED,
          AGENT_EXECUTION_STATES.FAILED,
          AGENT_EXECUTION_STATES.CANCELLED,
        ].some((state) => state === input.toState)
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      let pauseRequestId: string | null = null;
      if (input.recoveryRequired) {
        const turn = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: run.executionId },
        });
        const runtimeRunId = (turn?.contextJson as Prisma.JsonObject | null)
          ?.runtimeRunId;
        const slot =
          typeof runtimeRunId === "string"
            ? await tx.assessmentRootExecutionSlot.findFirst({
                where: {
                  runId: runtimeRunId,
                  assessmentId: input.assessmentId,
                  releasedAt: null,
                },
              })
            : null;
        if (input.toState !== AGENT_EXECUTION_STATES.FAILED || !slot) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        await tx.outboxMessage.update({
          where: { id: slot.commandId },
          data: {
            status: OutboxStatus.DLQ,
            errorMessage: ROOT_CAPACITY_REASONS.fenced,
            nextAttemptAt: null,
          },
        });
      }
      if (input.toState === AGENT_EXECUTION_STATES.PAUSED) {
        const turn = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: run.executionId },
        });
        const isStopRequested =
          turn &&
          turn.threadId === run.threadId &&
          turn.assessmentId === input.assessmentId &&
          turn.boundary === ASSESSMENT_ROOT_BOUNDARY &&
          turn.state === Controls.stopRequested &&
          input.controlRequestId &&
          turn.requestId === input.controlRequestId;

        const isBudgetPause =
          input.reason === ASSESSMENT_BUDGET_REASONS.AGENT_BUDGET_REACHED ||
          input.reason === ASSESSMENT_BUDGET_REASONS.BUDGET_EXHAUSTED ||
          input.reason === ASSESSMENT_BUDGET_REASONS.CALL_LIMIT_EXCEEDED ||
          input.reason === ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED ||
          input.reason === ASSESSMENT_BUDGET_REASONS.NO_PROGRESS_LIMIT_EXCEEDED;

        if (
          !input.checkpointId ||
          !turn ||
          turn.threadId !== run.threadId ||
          turn.assessmentId !== input.assessmentId ||
          turn.boundary !== ASSESSMENT_ROOT_BOUNDARY ||
          run.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
          (!isStopRequested && !isBudgetPause)
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        pauseRequestId =
          turn.requestId ?? input.controlRequestId ?? randomUUID();
      }
      if (input.toState === AGENT_EXECUTION_STATES.INTERRUPTED) {
        const ruleScope = await loadHumanRequestRuleScopeInTx(tx, {
          assessmentId: input.assessmentId,
          auditRequestId: run.auditRequestId,
          correlationId: input.correlationId,
        });
        const humanRequestWhere = humanRequestScopeWhere(
          input.assessmentId,
          ruleScope,
        );
        const requests = await tx.assessmentHumanRequest.findMany({
          where: {
            ...humanRequestWhere,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
        });
        const ids = new Set(input.requestIds);
        const turn = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: run.executionId },
        });
        const turnContext = turn?.contextJson;
        const humanAnswerReview =
          turnContext &&
          typeof turnContext === "object" &&
          !Array.isArray(turnContext)
            ? turnContext.humanAnswerReview
            : null;
        const blockedRequestId = humanFactBlockerRequestId(run);
        const blockedHumanWait =
          run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
          blockedRequestId !== null &&
          ids.has(blockedRequestId);
        if (
          !input.checkpointId ||
          !rootTurnMatchesScope(turn, {
            assessmentId: input.assessmentId,
            threadId: run.threadId,
            auditRequestId: run.auditRequestId,
          }) ||
          requests.length === 0 ||
          requests.length !== ids.size ||
          (run.lifecycleState !==
            ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN &&
            !blockedHumanWait) ||
          requests.some(
            (request) =>
              !ids.has(request.requestId) ||
              request.threadId !== run.threadId ||
              (request.checkpointId &&
                request.checkpointId !== input.checkpointId &&
                !humanReviewAllowsCheckpointRebind(request, humanAnswerReview)),
          )
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        await tx.assessmentHumanRequest.updateMany({
          where: {
            ...humanRequestWhere,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
          data: { checkpointId: input.checkpointId },
        });
      }
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: {
          executionState: input.toState,
          leaseToken: null,
          leaseExpiresAt: null,
          ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
        },
      });
      if (run.auditRequestId) {
        const current = await tx.assessmentRuleAuditRequest.findUniqueOrThrow({
          where: { requestId: run.auditRequestId },
        });
        if (
          input.toState === AGENT_EXECUTION_STATES.SUCCEEDED &&
          current.status !== RULE_AUDIT_STATUSES.COMPLETED
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (
          input.toState === AGENT_EXECUTION_STATES.FAILED ||
          input.toState === AGENT_EXECUTION_STATES.INTERRUPTED ||
          input.toState === AGENT_EXECUTION_STATES.CANCELLED
        ) {
          await tx.assessmentRuleAuditRequest.update({
            where: { requestId: run.auditRequestId },
            data: {
              status:
                input.toState === AGENT_EXECUTION_STATES.FAILED
                  ? RULE_AUDIT_STATUSES.FAILED
                  : input.toState === AGENT_EXECUTION_STATES.INTERRUPTED
                    ? RULE_AUDIT_STATUSES.WAITING_FOR_CUSTOMER
                    : RULE_AUDIT_STATUSES.CANCELLED,
            },
          });
        }
      }
      const turn = await tx.assessmentRuntimeTurn.findUnique({
        where: { id: run.executionId },
        select: { contextJson: true },
      });
      const previousCtx =
        turn?.contextJson &&
        typeof turn.contextJson === "object" &&
        !Array.isArray(turn.contextJson)
          ? (turn.contextJson as Record<string, unknown>)
          : {};
      const startCaseRevision =
        typeof previousCtx.startCaseRevision === "number"
          ? previousCtx.startCaseRevision
          : null;
      const caseRow = tx.assessmentCase
        ? await tx.assessmentCase.findUnique({
            where: { assessmentId: input.assessmentId },
            select: { caseRevision: true },
          })
        : null;
      const endCaseRevision = caseRow?.caseRevision ?? startCaseRevision ?? 0;
      const domainEventsCount = tx.assessmentEvent
        ? await tx.assessmentEvent.count({
            where: {
              assessmentId: input.assessmentId,
              executionId: run.executionId,
              eventType: {
                in: [
                  AGENTIC_ASSESSMENT_EVENT_TYPES.EVIDENCE_ACCEPTED,
                  AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED,
                  AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
                  AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED,
                ],
              },
            },
          })
        : 0;
      const progressMade =
        (startCaseRevision !== null && endCaseRevision > startCaseRevision) ||
        domainEventsCount > 0;

      await tx.assessmentRuntimeTurn.update({
        where: { id: run.executionId },
        data: {
          state:
            input.toState === AGENT_EXECUTION_STATES.PAUSED
              ? Controls.stopped
              : Controls.completed,
          ...(input.toState === AGENT_EXECUTION_STATES.PAUSED && pauseRequestId
            ? { requestId: pauseRequestId }
            : {}),
          ...(input.checkpointId
            ? { checkpointJson: { checkpointId: input.checkpointId } }
            : {}),
          contextJson: {
            ...previousCtx,
            ...(startCaseRevision !== null ? { startCaseRevision } : {}),
            endCaseRevision,
            progressMade,
          },
        },
      });
      if (input.toState === AGENT_EXECUTION_STATES.PAUSED) {
        if (input.reason) {
          await tx.assessment.update({
            where: { id: input.assessmentId },
            data: {
              blockerReference: {
                reason: input.reason,
                pausedAt: new Date().toISOString(),
              },
            },
          });
        }
        await this.coordinator.transitionFromRuntimeAcknowledgementInTx(
          {
            assessmentId: input.assessmentId,
            targetRunId: run.executionId,
            acknowledgedState: Controls.stopped,
            requestId: pauseRequestId,
            correlationId: input.correlationId,
          },
          tx,
        );
      }
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
        executionId: run.executionId,
        payload: {
          fromState: AGENT_EXECUTION_STATES.RUNNING,
          toState: input.toState,
          ...(input.reason ? { reason: input.reason } : {}),
        },
        auditActor: ROOT_ACTOR,
      });
      return { executionState: input.toState };
    });
  }
}

interface LockedRuntimeRow {
  lifecycleState: AssessmentLifecycleState | null;
  lifecycleRevision: number | null;
  blockerReason: BlockerReason | null;
  blockerReference: Prisma.JsonValue | null;
  threadId: string;
  checkpointNamespace: string;
  checkpointId: string | null;
  currentExecutionId: string | null;
  currentAuditRequestId: string | null;
  executionState: AgentExecutionState;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

interface FailedNativeCheckpoint {
  checkpointId: string;
  checkpointTimestamp: string;
}

export type SeparateCheckpointClient = {
  connect(): Promise<unknown>;
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
  end(): Promise<unknown>;
};

/**
 * Business purpose: Construct a PostgreSQL client connected to a physically separate native checkpoint database.
 *
 * Business rules:
 * - Creates a standard pg.Client configured with 5-second query and connection timeouts.
 * - Used as the default client factory for separate checkpoint queries when no test override is installed.
 *
 * Execution flow:
 * 1. Instantiate and return a new pg.Client instance for the provided database connection URL.
 *
 * Failure cases:
 * - None during construction; connection failures are handled during client.connect.
 *
 * Side effects:
 * - Allocates a pg.Client object without opening network sockets until connect is called.
 */
function defaultSeparateCheckpointClientFactory(
  databaseUrl: string,
): SeparateCheckpointClient {
  return new Client({
    connectionString: databaseUrl,
    query_timeout: 5000,
    connectionTimeoutMillis: 5000,
  });
}

let separateCheckpointClientFactory: (
  databaseUrl: string,
) => SeparateCheckpointClient = defaultSeparateCheckpointClientFactory;

/**
 * Business purpose: Configure an alternative PostgreSQL client factory for separate checkpoint testing.
 *
 * Business rules:
 * - Overrides the module-level client factory for separate checkpoint queries during test execution.
 * - Restores standard pg.Client behavior when passed the default factory implementation.
 *
 * Execution flow:
 * 1. Assign the provided factory function to the module-scoped variable.
 *
 * Failure cases:
 * - None; assignment is synchronous and infallible.
 *
 * Side effects:
 * - Modifies the client factory reference used by querySeparateCheckpointDatabase.
 */
export function setSeparateCheckpointClientFactoryForTesting(
  factory?: (databaseUrl: string) => SeparateCheckpointClient,
): void {
  separateCheckpointClientFactory =
    factory ?? defaultSeparateCheckpointClientFactory;
}

/**
 * Business purpose: Reset the PostgreSQL client factory for separate checkpoint testing back to the default implementation.
 *
 * Business rules:
 * - Restores defaultSeparateCheckpointClientFactory so test pollution cannot affect subsequent queries.
 *
 * Execution flow:
 * 1. Assign defaultSeparateCheckpointClientFactory to separateCheckpointClientFactory.
 *
 * Failure cases:
 * - None; assignment is synchronous and infallible.
 *
 * Side effects:
 * - Restores module-level client factory state.
 */
export function resetSeparateCheckpointClientFactoryForTesting(): void {
  separateCheckpointClientFactory = defaultSeparateCheckpointClientFactory;
}

/**
 * Business purpose: Query the newest native checkpoint row from a physically separate native checkpoint database.
 *
 * Business rules:
 * - Connects read-only to the specified native checkpoint database URL with bounded query and connection timeouts.
 * - Verifies the existence of the public.checkpoints table before querying.
 * - Fetches only the newest checkpoint for the specified thread and native Root namespace.
 * - Always disconnects the client to prevent connection leaks regardless of success or failure.
 *
 * Execution flow:
 * 1. Instantiate and connect a dedicated PostgreSQL client to the checkpoint database URL.
 * 2. Verify that public.checkpoints exists via to_regclass.
 * 3. Query the newest checkpoint row for the thread and namespace, ordered by checkpoint_id descending.
 * 4. Clean up the connection and return the raw row if found.
 *
 * Failure cases:
 * - Connection failures, timeouts, missing table, or missing rows safely return undefined.
 *
 * Side effects:
 * - Establishes a short-lived read-only database connection to the separate checkpoint store.
 */
async function querySeparateCheckpointDatabase(
  databaseUrl: string,
  threadId: string,
  checkpointNamespace: string = NATIVE_ROOT_CHECKPOINT_NAMESPACE,
): Promise<
  | {
      checkpointId: string;
      serializedCheckpointId: string | null;
      checkpointTimestamp: string | null;
      metadata: unknown;
    }
  | undefined
> {
  const client = separateCheckpointClientFactory(databaseUrl);
  try {
    await client.connect();
    const tableRes = await client.query<{ tableName: string | null }>(
      `SELECT to_regclass('public.checkpoints')::text AS "tableName"`,
    );
    if (!tableRes.rows[0]?.tableName) {
      return undefined;
    }
    const res = await client.query<{
      checkpointId: string;
      serializedCheckpointId: string | null;
      checkpointTimestamp: string | null;
      metadata: unknown;
    }>(
      `SELECT "checkpoint_id" AS "checkpointId",
          "checkpoint"->>'id' AS "serializedCheckpointId",
          "checkpoint"->>'ts' AS "checkpointTimestamp",
          "metadata"
        FROM "public"."checkpoints"
        WHERE "thread_id" = $1
          AND "checkpoint_ns" = $2
        ORDER BY "checkpoint_id" DESC
        LIMIT 1`,
      [threadId, checkpointNamespace],
    );
    return res.rows[0];
  } catch {
    return undefined;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Business purpose: Recover a native checkpoint omitted from the API runtime row after a failed Root turn.
 *
 * Business rules:
 * - The newest checkpoint for the exact assessment or immutable selected-request Root thread and native Root namespace must carry the same persisted
 *   assessment, transport run, Root boundary, agent identity, and exact immutable case pins (rule set, repository snapshot, commit).
 * - Authoritative case pins (rule set, repository snapshot, commit) are required; missing case pins fail closed.
 * - Checkpoint metadata must explicitly contain string values for rule_set_version_id, repository_snapshot_id, and repository_commit matching case pins.
 * - Missing checkpoint pins, malformed pins, or mismatching pins immediately fail closed and return null.
 * - The checkpoint row ID must match its serialized checkpoint ID, and its timestamp must fall within that turn.
 * - If the checkpoint table is absent from the API database, the authority checks the configured native checkpoint database URL.
 * - An unavailable table, missing row, malformed checkpoint, or mismatched provenance grants no resume authority.
 *
 * Execution flow:
 * 1. Validate that the input case pins exist and contain non-empty string values for rule set, repository snapshot, and commit.
 * 2. Check for the co-located native checkpoint table in the current database transaction.
 * 3. If absent and a separate native checkpoint database URL is configured, query that external database securely.
 * 4. Read only the newest checkpoint for this thread and the native Root namespace; selected requests also
 *    require matching request metadata so an adjacent request cannot authorize recovery.
 * 5. Validate checkpoint identity, metadata types, case pins, and timestamp against the failed turn before returning its ID.
 *
 * Failure cases:
 * - Missing table or row, missing/malformed/mismatched case pins or identity metadata return null; query errors abort or return null.
 *
 * Side effects:
 * - Performs read-only queries against the co-located or separate native checkpoint store.
 */
async function findFailedNativeCheckpoint(
  tx: Prisma.TransactionClient,
  input: {
    assessmentId: string;
    threadId: string;
    checkpointNamespace?: string;
    auditRequestId?: string | null;
    runtimeRunId: string;
    turnCreatedAt: Date;
    turnUpdatedAt: Date;
    casePins?: {
      ruleSetVersionId?: string | null;
      repositorySnapshotId?: string | null;
      repositoryCommit?: string | null;
    } | null;
  },
): Promise<FailedNativeCheckpoint | null> {
  if (
    !input.casePins ||
    typeof input.casePins.ruleSetVersionId !== "string" ||
    input.casePins.ruleSetVersionId.length === 0 ||
    typeof input.casePins.repositorySnapshotId !== "string" ||
    input.casePins.repositorySnapshotId.length === 0 ||
    typeof input.casePins.repositoryCommit !== "string" ||
    input.casePins.repositoryCommit.length === 0
  ) {
    return null;
  }

  const [table] = await tx.$queryRaw<Array<{ tableName: string | null }>>(
    Prisma.sql`SELECT to_regclass('public.checkpoints')::text AS "tableName"`,
  );

  let checkpoint:
    | {
        checkpointId: string;
        serializedCheckpointId: string | null;
        checkpointTimestamp: string | null;
        metadata: unknown;
      }
    | undefined;

  if (table?.tableName) {
    const [row] = await tx.$queryRaw<
      Array<{
        checkpointId: string;
        serializedCheckpointId: string | null;
        checkpointTimestamp: string | null;
        metadata: unknown;
      }>
    >(
      Prisma.sql`SELECT "checkpoint_id" AS "checkpointId",
          "checkpoint"->>'id' AS "serializedCheckpointId",
          "checkpoint"->>'ts' AS "checkpointTimestamp",
          "metadata"
        FROM "public"."checkpoints"
        WHERE "thread_id" = ${input.threadId}
          AND "checkpoint_ns" = ${input.checkpointNamespace ?? NATIVE_ROOT_CHECKPOINT_NAMESPACE}
        -- Checkpoint IDs are time-ordered; validate the newest row rather than falling back to older metadata.
        ORDER BY "checkpoint_id" DESC
        LIMIT 1`,
    );
    checkpoint = row;
  } else if (process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL) {
    checkpoint = await querySeparateCheckpointDatabase(
      process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL,
      input.threadId,
      input.checkpointNamespace ?? NATIVE_ROOT_CHECKPOINT_NAMESPACE,
    );
  } else {
    return null;
  }

  if (
    !checkpoint?.checkpointId ||
    checkpoint.serializedCheckpointId !== checkpoint.checkpointId ||
    !checkpoint.checkpointTimestamp
  ) {
    return null;
  }

  const metadata =
    checkpoint.metadata &&
    typeof checkpoint.metadata === "object" &&
    !Array.isArray(checkpoint.metadata)
      ? (checkpoint.metadata as Record<string, unknown>)
      : null;
  if (
    !metadata ||
    metadata.assessment_id !== input.assessmentId ||
    (input.auditRequestId
      ? metadata.assessment_root_audit_request_id !== input.auditRequestId
      : metadata.assessment_root_audit_request_id != null) ||
    metadata.lcsp_runtime_run_id !== input.runtimeRunId ||
    metadata.lcsp_boundary_name !== NATIVE_ROOT_BOUNDARY_NAME ||
    metadata.lc_agent_name !== NATIVE_ROOT_AGENT_NAME ||
    (typeof metadata.thread_id === "string" &&
      metadata.thread_id !== input.threadId) ||
    typeof metadata.rule_set_version_id !== "string" ||
    metadata.rule_set_version_id !== input.casePins.ruleSetVersionId ||
    typeof metadata.repository_snapshot_id !== "string" ||
    metadata.repository_snapshot_id !== input.casePins.repositorySnapshotId ||
    typeof metadata.repository_commit !== "string" ||
    metadata.repository_commit !== input.casePins.repositoryCommit
  ) {
    return null;
  }

  const timestamp = new Date(checkpoint.checkpointTimestamp);
  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp < input.turnCreatedAt ||
    timestamp > input.turnUpdatedAt
  ) {
    return null;
  }

  return {
    checkpointId: checkpoint.checkpointId,
    checkpointTimestamp: checkpoint.checkpointTimestamp,
  };
}

/**
 * Business purpose: Serialize Root authority with assessment lifecycle and request changes.
 * Business rules:
 * - Assessment is locked before runtime to avoid a competing lease or lifecycle transition.
 * Execution flow:
 * 1. Lock assessment. 2. Lock its runtime row and combine their state.
 * Failure cases:
 * - Missing assessment or runtime yields no authority row to the caller.
 * Side effects:
 * - Acquires transaction row locks; does not persist changes.
 */
async function lockAssessmentAndRuntime(
  tx: Prisma.TransactionClient,
  assessmentId: string,
): Promise<LockedRuntimeRow | undefined> {
  const assessment = await tx.$queryRaw<
    Array<
      Pick<
        LockedRuntimeRow,
        | "lifecycleState"
        | "lifecycleRevision"
        | "blockerReason"
        | "blockerReference"
      >
    >
  >(
    Prisma.sql`SELECT "lifecycleState", "lifecycleRevision", "blockerReason", "blockerReference" FROM "Assessment"
      WHERE "id" = ${assessmentId} FOR UPDATE`,
  );
  if (!assessment[0]) return undefined;
  const runtime = await tx.$queryRaw<
    Array<
      Omit<
        LockedRuntimeRow,
        | "lifecycleState"
        | "lifecycleRevision"
        | "blockerReason"
        | "blockerReference"
      >
    >
  >(
    Prisma.sql`SELECT "threadId", "checkpointNamespace", "checkpointId", "currentExecutionId", "currentAuditRequestId", "executionState",
        "leaseToken", "leaseExpiresAt"
      FROM "AssessmentRuntime" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
  );
  if (!runtime[0]) return undefined;
  return { ...assessment[0], ...runtime[0] };
}

function humanFactBlockerRequestId(row: {
  blockerReason: unknown;
  blockerReference: unknown;
}): string | null {
  const blocker = assessmentBlockerSchema.safeParse({
    reason: row.blockerReason,
    reference: row.blockerReference,
  });
  return blocker.success &&
    blocker.data.reason === BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE
    ? blocker.data.reference.humanResolutionRequestId
    : null;
}
