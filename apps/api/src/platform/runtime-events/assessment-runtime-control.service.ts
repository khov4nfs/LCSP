import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
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
  ) {}

  async current(
    assessmentId: string,
  ): Promise<AssessmentRuntimeControlResult | null> {
    const row = await this.prisma.assessmentRuntimeTurn.findFirst({
      where: { assessmentId },
      orderBy: { createdAt: "desc" },
    });
    return row ? result(row) : null;
  }

  /** CAS and outbox enqueue are atomic. Every retry stays bound to one run. */
  async request(input: {
    assessmentId: string;
    actorId: string;
    correlationId: string;
    action: AssessmentRuntimeControlAction;
    targetRunId?: string;
  }): Promise<AssessmentRuntimeControlResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await tx.assessmentRuntimeTurn.findFirst({
        where: { assessmentId: input.assessmentId },
        orderBy: { createdAt: "desc" },
      });
      if (!row) {
        // Missing registration is not proof that the visible runtime completed.
        // Report the unavailable target instead of silently accepting a no-op.
        throw problemException(Problems.staleTarget, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      if (input.targetRunId && input.targetRunId !== row.id) {
        const target = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: input.targetRunId },
        });
        if (target?.assessmentId === input.assessmentId) {
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
          actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
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
    if (input.state === States.running) {
      if (
        !input.threadId ||
        !input.boundary ||
        !input.logicalRunId ||
        !input.context
      ) {
        throw new Error(
          "Runtime registration requires its original execution context",
        );
      }
      const row = await this.prisma.assessmentRuntimeTurn.upsert({
        where: { id: input.targetRunId },
        update: {},
        create: {
          id: input.targetRunId,
          assessmentId: input.assessmentId,
          threadId: input.threadId,
          boundary: input.boundary,
          logicalRunId: input.logicalRunId,
          workflowRunId: input.workflowRunId,
          correlationId: input.correlationId,
          state: toDb(States.running),
          contextJson: input.context as Prisma.InputJsonValue,
        },
      });
      if (row.assessmentId !== input.assessmentId)
        throw new Error("Runtime assessment mismatch");
      const control = result(row);
      if (control.state === States.running)
        await this.emit(input.assessmentId, input.correlationId, control);
      return control;
    }
    const expected =
      input.state === States.stopped
        ? [toDb(States.stopRequested)]
        : [toDb(States.running), toDb(States.stopRequested)];
    const changed = await this.prisma.assessmentRuntimeTurn.updateMany({
      where: {
        id: input.targetRunId,
        assessmentId: input.assessmentId,
        state: { in: expected },
      },
      data: {
        state: toDb(input.state),
        ...(input.checkpoint
          ? { checkpointJson: input.checkpoint as Prisma.InputJsonValue }
          : {}),
      },
    });
    const row = await this.prisma.assessmentRuntimeTurn.findUniqueOrThrow({
      where: { id: input.targetRunId },
    });
    if (row.assessmentId !== input.assessmentId)
      throw new Error("Runtime assessment mismatch");
    const control = result(row);
    if (changed.count || control.state === input.state)
      await this.emit(input.assessmentId, input.correlationId, control);
    return control;
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
