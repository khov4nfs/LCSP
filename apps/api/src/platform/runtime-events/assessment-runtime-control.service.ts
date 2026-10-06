import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as Events,
  isAssessmentRuntimeControlState,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type AssessmentRuntimeControlAcknowledgement,
  type AssessmentRuntimeControlAction,
  type AssessmentRuntimeControlResult,
  type AssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
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
import { AssessmentRuntimeEventService } from "./assessment-runtime-event.service.js";

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
    private readonly events: AssessmentRuntimeEventService,
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

  /** CAS and outbox enqueue are atomic. Every retry stays bound to one run. */
  async request(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    action: AssessmentRuntimeControlAction;
    targetRunId?: string;
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
      // W3/W4 own material-blocker and native resume authority. Until that
      // proof exists, fail closed before changing the turn or enqueueing a
      // native resume side effect.
      if (input.action === Actions.resume) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
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
      // Use the existing control delivery channel. It is handled outside the
      // target thread so the stop cannot queue behind the run it must interrupt.
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
          aggregateId: input.assessmentId,
          assessmentId: input.assessmentId,
          eventType: ASSESSMENT_EVENT_TYPES.interviewAgentPauseRequestedOutbox,
          correlationId: input.correlationId,
          causationId: requestId,
          actor: { id: input.actor.userId, type: AUDIT_ACTOR_TYPES.user },
          result: ASSESSMENT_EVENT_TYPES.interviewAgentPauseRequestedOutbox,
          redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
          idempotencyKey: `${row.id}:${requested}:${requestId}`,
          payload: {
            assessmentId: input.assessmentId,
            controlAction: input.action,
            targetRunId: row.id,
            threadId: row.threadId,
            boundary: row.boundary,
            logicalRunId: row.logicalRunId,
            workflowRunId: row.workflowRunId,
            requestId,
            runtimeContext: row.contextJson,
            checkpoint: row.checkpointJson,
            ...(stop ? {} : { stoppedAt: row.updatedAt.toISOString() }),
          },
        }),
        tx,
      );
      return {
        control: { state: requested, targetRunId: row.id, requestId },
        changed: true,
      };
    });
    // Retry publication too: state/outbox may have committed before an SSE
    // journal failure. Stable lifecycle IDs make that repair idempotent.
    if (outcome.control.targetRunId)
      await this.emit(input.assessmentId, input.correlationId, outcome.control);
    return outcome.control;
  }

  /** Only the runtime can acknowledge a stopped or running turn. */
  async acknowledge(
    input: AssessmentRuntimeControlAcknowledgement,
  ): Promise<AssessmentRuntimeControlResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (input.state === States.running) {
        if (!input.context) {
          throw problemException(Problems.staleTarget, input.correlationId, {
            status: HttpStatus.CONFLICT,
          });
        }
        const { turn } = await this.loadCanonicalTurn(tx, input);
        if (turn.state === toDb(States.running)) {
          return { control: result(turn), changed: false };
        }
        if (turn.state !== toDb(States.resumeRequested)) {
          throw problemException(Problems.staleTarget, input.correlationId, {
            status: HttpStatus.CONFLICT,
          });
        }
        const claimed = await tx.assessmentRuntimeTurn.updateMany({
          where: {
            id: turn.id,
            assessmentId: input.assessmentId,
            threadId: turn.threadId,
            state: toDb(States.resumeRequested),
          },
          data: { state: toDb(States.running) },
        });
        const row = await tx.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: turn.id },
        });
        if (claimed.count) {
          await this.lifecycle.transitionFromRuntimeAcknowledgementInTx(
            {
              assessmentId: input.assessmentId,
              targetRunId: input.targetRunId,
              acknowledgedState: States.running,
              requestId: turn.requestId,
              correlationId: input.correlationId,
            },
            tx,
          );
        }
        return { control: result(row), changed: claimed.count > 0 };
      }

      if (
        input.state === States.stopped &&
        (!input.checkpoint ||
          typeof input.checkpoint !== "object" ||
          Array.isArray(input.checkpoint))
      ) {
        throw problemException(Problems.staleTarget, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const { turn } = await this.loadCanonicalTurn(tx, input);
      if (
        input.state === States.stopped &&
        turn.state !== toDb(States.stopRequested) &&
        turn.state !== toDb(States.stopped) &&
        turn.state !== toDb(States.completed)
      ) {
        throw problemException(Problems.staleTarget, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const expected =
        input.state === States.stopped
          ? [toDb(States.stopRequested)]
          : [toDb(States.running), toDb(States.stopRequested)];
      const changed = await tx.assessmentRuntimeTurn.updateMany({
        where: {
          id: input.targetRunId,
          assessmentId: input.assessmentId,
          threadId: turn.threadId,
          state: { in: expected },
        },
        data: {
          state: toDb(input.state),
          ...(input.checkpoint
            ? { checkpointJson: input.checkpoint as Prisma.InputJsonValue }
            : {}),
        },
      });
      const row = await tx.assessmentRuntimeTurn.findUniqueOrThrow({
        where: { id: input.targetRunId },
      });
      if (row.assessmentId !== input.assessmentId)
        throw new Error("Runtime assessment mismatch");
      if (changed.count && input.state === States.stopped) {
        await this.lifecycle.transitionFromRuntimeAcknowledgementInTx(
          {
            assessmentId: input.assessmentId,
            targetRunId: input.targetRunId,
            acknowledgedState: States.stopped,
            requestId: turn.requestId,
            correlationId: input.correlationId,
          },
          tx,
        );
      }
      return { control: result(row), changed: changed.count > 0 };
    });
    const control = outcome.control;
    if (outcome.changed || control.state === input.state)
      await this.emit(input.assessmentId, input.correlationId, control);
    return control;
  }

  private async loadCanonicalTurn(
    tx: Prisma.TransactionClient,
    input: AssessmentRuntimeControlAcknowledgement,
  ) {
    if (!input.threadId || !input.boundary || !input.logicalRunId) {
      throw problemException(Problems.staleTarget, input.correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    await this.lockCanonicalAssessmentAndRuntime(
      tx,
      input.assessmentId,
      input.correlationId,
    );
    const runtime = await tx.assessmentRuntime.findUnique({
      where: { assessmentId: input.assessmentId },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
        executionState: true,
      },
    });
    const turn = await tx.assessmentRuntimeTurn.findUnique({
      where: { id: input.targetRunId },
    });
    if (
      !runtime ||
      !turn ||
      runtime.checkpointNamespace !== input.assessmentId ||
      runtime.currentExecutionId !== turn.id ||
      turn.assessmentId !== input.assessmentId ||
      turn.threadId !== runtime.threadId ||
      input.threadId !== runtime.threadId ||
      input.boundary !== turn.boundary ||
      input.logicalRunId !== turn.logicalRunId
    ) {
      throw problemException(Problems.staleTarget, input.correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return { runtime, turn };
  }

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

  private async lockCanonicalAssessmentAndRuntime(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
  ) {
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

  private emit(
    assessmentId: string,
    correlationId: string,
    control: AssessmentRuntimeControlResult,
  ) {
    const eventTypes = {
      [States.running]: Events.runtimeResumed,
      [States.stopRequested]: Events.runtimeStopRequested,
      [States.stopped]: Events.runtimeStopped,
      [States.resumeRequested]: Events.runtimeResumeRequested,
      [States.completed]: Events.runtimeCompleted,
    } as const;
    return this.events.publishAgentStreamEvent({
      eventId: `${control.targetRunId}:${control.state}:${control.requestId ?? "runtime"}`,
      assessmentId,
      runId: control.targetRunId,
      correlationId,
      eventType: eventTypes[control.state],
      status: control.state,
      data: { runtimeControl: control },
    });
  }
}
