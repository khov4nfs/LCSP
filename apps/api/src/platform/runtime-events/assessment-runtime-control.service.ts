import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
  ARTIFACT_LIFECYCLE_STATES,
  AGENT_EXECUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_BUDGET_REASONS,
} from "@lcsp/contracts/assessment-domain";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  isAssessmentRuntimeControlState,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type AssessmentBudgetExtensionInput,
  type AssessmentRuntimeControlAction,
  type AssessmentRuntimeControlResult,
  type AssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AssessmentRuntimeControlState as DbState,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../http/filters/error.factory.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import type { RbacRequestContext } from "../rbac/interfaces/rbac-request.interface.js";
import { AssessmentLifecycleCoordinator } from "../../modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";

// Explicit persistence boundary; controllers never return Prisma values.
function toDb(state: AssessmentRuntimeControlState): DbState {
  return DbState[state];
}
function result(row: {
  id: string;
  state: string;
  requestId: string | null;
}): AssessmentRuntimeControlResult {
  if (!isAssessmentRuntimeControlState(row.state))
    throw new Error("Invalid persisted runtime control state");
  return { state: row.state, targetRunId: row.id, requestId: row.requestId };
}

@Injectable()
export class AssessmentRuntimeControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
  ) {}

  async current(
    assessmentId: string,
  ): Promise<AssessmentRuntimeControlResult | null> {
    const runtime = await this.prisma.assessmentRuntime.findUnique({
      where: { assessmentId },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
      },
    });
    if (!runtime || !runtime.currentExecutionId) return null;
    const row = await this.prisma.assessmentRuntimeTurn.findUnique({
      where: { id: runtime.currentExecutionId },
    });
    if (
      !row ||
      runtime.checkpointNamespace !== assessmentId ||
      row.assessmentId !== assessmentId ||
      row.threadId !== runtime.threadId
    ) {
      throw problemException(Problems.staleTarget, assessmentId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return result(row);
  }

  /**
   * Business purpose: Request a cooperative stop or resume of an Assessment Root execution turn on its server-owned thread.
   *
   * Business rules:
   * - Stop is accepted only when the current execution turn is running, and will pause at the next native checkpoint boundary.
   * - Resume is accepted only when the current execution is stopped and paused with valid snapshot and pins.
   * - If paused due to budget exhaustion, resume requires an explicit budget extension; repeated extensions must have strictly increasing version numbers and append historical extensions to an immutable lineage array.
   *
   * Execution flow:
   * 1. Authorize the caller and load the canonical target runtime and current execution turn under transaction.
   * 2. Verify turn state, boundary invariants, and pause/resume authority guards.
   * 3. For resume, validate budget constraints, clear blocker references, and enqueue the ROOT_REQUESTED outbox command.
   * 4. Transition the turn state to stopRequested or resumeRequested atomically and return the control outcome.
   *
   * Failure cases:
   * - Stale target runs, invalid states, mismatched pins, open human blockers, stale extension versions, or unextended budget exhaustion reject with 409 Conflict.
   *
   * Side effects:
   * - Updates turn state, clears blocker references on resume, and enqueues transactional outbox messages.
   */
  async request(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    action: AssessmentRuntimeControlAction;
    targetRunId?: string;
    responseLanguage?: string | null;
    budgetExtension?: AssessmentBudgetExtensionInput;
  }): Promise<AssessmentRuntimeControlResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { runtime, row } = await this.loadCanonicalTarget(
        tx,
        input.assessmentId,
        input.correlationId,
        input.actor,
      );
      if (input.targetRunId && input.targetRunId !== row.id) {
        const target = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: input.targetRunId },
        });
        if (
          target?.assessmentId === input.assessmentId &&
          target.threadId === runtime.threadId
        ) {
          // Completion wins a late Stop. A duplicate Continue may arrive after
          // its new native generation has already registered or completed.
          if (
            input.action === Actions.stop &&
            target.state === toDb(States.completed)
          )
            return { control: result(target), changed: false };
          if (
            input.action === Actions.resume &&
            target.state === toDb(States.resumeRequested) &&
            target.logicalRunId === row.logicalRunId
          )
            return { control: result(row), changed: false };
        }
        throw problemException(Problems.staleTarget, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const stop = input.action === Actions.stop;
      const expected = stop ? States.running : States.stopped;
      const requested = stop ? States.stopRequested : States.resumeRequested;
      if (
        row.state === toDb(requested) ||
        (stop && row.state === toDb(States.stopped)) ||
        row.state === toDb(States.completed)
      ) {
        return { control: result(row), changed: false };
      }
      if (row.state !== toDb(expected)) {
        throw problemException(Problems.notStopped, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      if (row.boundary !== ASSESSMENT_ROOT_BOUNDARY) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      if (!stop) {
        const assessment = await tx.assessment.findUniqueOrThrow({
          where: { id: input.assessmentId },
          include: {
            runtime: true,
            domainCase: { include: { ruleSet: true } },
          },
        });
        const pins = assessment.domainCase;
        const snapshot = pins?.repositorySnapshotId
          ? await tx.repositorySnapshot.findUnique({
              where: { id: pins.repositorySnapshotId },
            })
          : null;
        if (
          assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.PAUSED ||
          assessment.runtime?.executionState !==
            AGENT_EXECUTION_STATES.PAUSED ||
          !assessment.runtime.checkpointId ||
          !row.checkpointJson ||
          !pins?.ruleSetVersionId ||
          !pins.repositoryScanJobId ||
          !snapshot ||
          snapshot.assessmentId !== input.assessmentId ||
          snapshot.commitSha !== pins.repositoryCommit ||
          !pins.ruleSet ||
          ![
            ARTIFACT_LIFECYCLE_STATES.ACTIVE,
            ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
          ].some((state) => state === pins.ruleSet?.lifecycleState) ||
          (await tx.assessmentHumanRequest.count({
            where: {
              assessmentId: input.assessmentId,
              status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            },
          }))
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const blockerRef = (assessment.blockerReference ?? null) as Record<
          string,
          unknown
        > | null;

        // Verify authority: only administrators can provide budget extensions or overrides
        if (input.budgetExtension) {
          if (input.actor.role !== AUTH_USER_ROLES.admin) {
            throw problemException(
              SHARED_ERROR_CODES.forbidden,
              input.correlationId,
              { status: HttpStatus.FORBIDDEN },
            );
          }
        }

        const isBudgetExhausted =
          blockerRef &&
          (blockerRef.reason ===
            ASSESSMENT_BUDGET_REASONS.AGENT_BUDGET_REACHED ||
            blockerRef.reason === ASSESSMENT_BUDGET_REASONS.BUDGET_EXHAUSTED ||
            blockerRef.reason ===
              ASSESSMENT_BUDGET_REASONS.CALL_LIMIT_EXCEEDED ||
            blockerRef.reason ===
              ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED);

        const isNoProgressStall =
          blockerRef &&
          blockerRef.reason ===
            ASSESSMENT_BUDGET_REASONS.NO_PROGRESS_LIMIT_EXCEEDED;

        const existingExtension =
          blockerRef?.budgetExtension &&
          typeof blockerRef.budgetExtension === "object"
            ? (blockerRef.budgetExtension as Record<string, unknown>)
            : null;

        const existingHistory = Array.isArray(
          blockerRef?.budgetExtensionHistory,
        )
          ? (blockerRef.budgetExtensionHistory as Array<
              Record<string, unknown>
            >)
          : existingExtension
            ? [existingExtension]
            : [];

        let activeExtension: Record<string, unknown> | null = null;
        let updatedHistory = existingHistory;

        if (input.budgetExtension) {
          if (existingExtension && existingExtension.version !== undefined) {
            const existingVersion = Number(existingExtension.version);
            if (input.budgetExtension.version <= existingVersion) {
              throw problemException(
                ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
                input.correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
          }
          activeExtension = {
            version: input.budgetExtension.version,
            authorizedBy: input.actor.userId,
            authorizedAt: new Date().toISOString(),
            previousVersion: existingExtension
              ? (existingExtension.version ?? null)
              : null,
            ...(input.budgetExtension.auditReason
              ? { auditReason: input.budgetExtension.auditReason }
              : {}),
            additionalModelCalls:
              input.budgetExtension.additionalModelCalls ?? null,
            additionalInputTokens:
              input.budgetExtension.additionalInputTokens ?? null,
            additionalOutputTokens:
              input.budgetExtension.additionalOutputTokens ?? null,
            additionalTotalTokens:
              input.budgetExtension.additionalTotalTokens ?? null,
            overrideNoProgress:
              input.budgetExtension.overrideNoProgress ?? false,
          };
          if (
            existingExtension &&
            !existingHistory.some(
              (h) => h.version === existingExtension.version,
            )
          ) {
            updatedHistory = [...existingHistory, existingExtension];
          }
        } else if (existingExtension) {
          activeExtension = existingExtension;
        }

        const activeOverride =
          input.budgetExtension?.overrideNoProgress === true ||
          blockerRef?.overrideNoProgress === true ||
          activeExtension?.overrideNoProgress === true;

        if (
          isBudgetExhausted &&
          !activeExtension &&
          !blockerRef?.budgetExtended
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.BUDGET_EXHAUSTED,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        if (isNoProgressStall && !activeOverride) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.NO_PROGRESS_LIMIT_REACHED,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        if (blockerRef || activeExtension || activeOverride) {
          const updatedBlocker: Prisma.InputJsonValue = {
            reason: null,
            resumedAt: new Date().toISOString(),
            ...(activeExtension
              ? { budgetExtension: activeExtension as Prisma.InputJsonObject }
              : {}),
            ...(updatedHistory.length > 0
              ? {
                  budgetExtensionHistory:
                    updatedHistory as unknown as Prisma.InputJsonValue,
                }
              : {}),
            ...(activeOverride ? { overrideNoProgress: true } : {}),
            ...(blockerRef?.budgetExtended ? { budgetExtended: true } : {}),
          };
          await tx.assessment.update({
            where: { id: input.assessmentId },
            data: {
              blockerReference: updatedBlocker,
            },
          });
        }
      }
      const requestId = randomUUID();
      const claimed = await tx.assessmentRuntimeTurn.updateMany({
        where: { id: row.id, state: toDb(expected) },
        data: { state: toDb(requested), requestId },
      });
      if (claimed.count === 0) {
        const latest = await tx.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: row.id },
        });
        return { control: result(latest), changed: false };
      }
      // Stop is observed at the Root's next native checkpoint boundary. Resume is an
      // ordinary Root command on the server-owned thread, never an Interview continuation.
      if (!stop) {
        const responseLanguage = input.responseLanguage
          ? resolveResponseLanguage(input.responseLanguage)
          : undefined;
        await this.outbox.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: input.assessmentId,
            assessmentId: input.assessmentId,
            eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            correlationId: input.correlationId,
            causationId: requestId,
            actor: { id: input.actor.userId, type: AUDIT_ACTOR_TYPES.user },
            result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
            idempotencyKey: `root-resume:${row.id}:${requestId}`,
            payload: {
              assessmentId: input.assessmentId,
              ...(responseLanguage ? { responseLanguage } : {}),
            },
          }),
          tx,
        );
        if (responseLanguage) {
          await tx.assessmentRuntimeTurn.updateMany({
            where: { id: row.id },
            data: {
              contextJson: {
                ...(typeof row.contextJson === "object" &&
                row.contextJson !== null
                  ? (row.contextJson as Record<string, unknown>)
                  : {}),
                responseLanguage,
              },
            },
          });
        }
      }
      return {
        control: { state: requested, targetRunId: row.id, requestId },
        changed: true,
      };
    });
    return outcome.control;
  }

  /**
   * Business purpose: Load and validate the canonical runtime target for assessment
   * control operations while enforcing tenant boundaries and preventing execution stale states.
   *
   * Business rules:
   * - Actor must own the assessment or hold an admin role. Non-admin cross-tenant attempts
   *   fail closed with a 404 NOT_FOUND response.
   * - Assessment runtime must have an active current execution registered.
   * - Runtime turn namespace and thread identifiers must strictly match the canonical assessment.
   *
   * Execution flow:
   * 1. Acquire pessimistic row locks on assessment and assessment runtime records.
   * 2. Verify actor ownership if actor does not possess administrative privileges.
   * 3. Confirm active currentExecutionId exists on the canonical runtime record.
   * 4. Query and validate that runtime turn belongs to this assessment thread and namespace.
   * 5. Return validated runtime and turn row records to caller.
   *
   * Failure cases:
   * - Missing assessment or runtime throws 409 CONFLICT (staleTarget).
   * - Ownership violation throws 404 NOT_FOUND (ASSESSMENT_ERROR_CODES.notFound).
   * - Missing or mismatched runtime turn throws 409 CONFLICT (staleTarget).
   *
   * Side effects:
   * - Read-only query execution within caller's transactional lock boundary; no state mutations.
   */
  private async loadCanonicalTarget(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
    actor: RbacRequestContext,
  ) {
    const { assessment, runtime } =
      await this.lockCanonicalAssessmentAndRuntime(
        tx,
        assessmentId,
        correlationId,
        actor,
      );
    if (
      actor.role !== AUTH_USER_ROLES.admin &&
      assessment.ownerId !== actor.userId
    ) {
      throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    if (!runtime.currentExecutionId) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const row = await tx.assessmentRuntimeTurn.findUnique({
      where: { id: runtime.currentExecutionId },
    });
    if (
      !row ||
      runtime.checkpointNamespace !== assessmentId ||
      row.assessmentId !== assessmentId ||
      row.threadId !== runtime.threadId
    ) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return { runtime, row };
  }

  /**
   * Business purpose: Acquire pessimistic row-level locks on the assessment and runtime records
   * while enforcing tenant-scoped row locks to prevent cross-tenant Row-Lock DoS vulnerabilities.
   *
   * Business rules:
   * - Non-admin actors must only lock assessment rows matching their own userId.
   * - Admin actors are permitted to lock assessment rows across any tenant boundary.
   * - The target assessment and runtime rows must both exist; missing records reject the transaction.
   *
   * Execution flow:
   * 1. Construct tenant-filtering SQL clause based on caller role.
   * 2. Execute raw SELECT ... FOR UPDATE query on Assessment table.
   * 3. If no row matches, reject immediately before taking locks on downstream records.
   * 4. Execute raw SELECT ... FOR UPDATE query on AssessmentRuntime table.
   * 5. Fetch canonical AssessmentRuntime record and return both records.
   *
   * Failure cases:
   * - Non-existent assessment or cross-tenant target throws 409 CONFLICT (staleTarget).
   * - Non-existent runtime row throws 409 CONFLICT (staleTarget).
   *
   * Side effects:
   * - Acquires exclusive pessimistic row locks (FOR UPDATE) within the current transaction.
   */
  private async lockCanonicalAssessmentAndRuntime(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
    actor: RbacRequestContext,
  ) {
    // 1. Inspect assessment existence and ownership without row lock first.
    // This allows returning 404 Not Found for cross-tenant calls while completely preventing
    // cross-tenant Row-Lock Denial of Service (attacker cannot lock victim's row).
    const unreservedRows = await tx.$queryRaw<
      Array<{ id: string; ownerId: string }>
    >(
      Prisma.sql`SELECT "id", "ownerId" FROM "Assessment" WHERE "id" = ${assessmentId}`,
    );
    if (!unreservedRows[0]) {
      // Stale or deleted target returns 409 Conflict per canonical runtime control contract.
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    if (
      actor.role !== AUTH_USER_ROLES.admin &&
      unreservedRows[0].ownerId !== actor.userId
    ) {
      // Cross-tenant access fails closed with 404 Not Found without holding any row locks.
      throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    // 2. Once tenant ownership is verified, acquire pessimistic row locks on Assessment and AssessmentRuntime.
    const assessmentRows = await tx.$queryRaw<
      Array<{ id: string; ownerId: string }>
    >(
      Prisma.sql`SELECT "id", "ownerId" FROM "Assessment"
        WHERE "id" = ${assessmentId} FOR UPDATE`,
    );
    if (!assessmentRows[0]) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const runtimeRows = await tx.$queryRaw<Array<{ assessmentId: string }>>(
      Prisma.sql`SELECT "assessmentId" FROM "AssessmentRuntime"
        WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
    );
    if (!runtimeRows[0]) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const runtime = await tx.assessmentRuntime.findUnique({
      where: { assessmentId },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
      },
    });
    if (!runtime) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return { assessment: assessmentRows[0], runtime };
  }
}
