import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { AUDIT_ACTOR_TYPES, type AuditActorType } from "@lcsp/contracts/audit";
import {
  ASSESSMENT_PIPELINE_CONTINUE_ACTIONS,
  ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES,
  ASSESSMENT_PIPELINE_CONTINUE_RERUN_REASON,
  ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS,
  ASSESSMENT_RUNTIME_PIPELINE_CONTROL_REASONS,
  type AssessmentPipelineContinueResult,
} from "@lcsp/contracts/evidence";
import { HttpStatus, Injectable } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";

import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
} from "@lcsp/contracts/evidence";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { AssessmentRuntimeControlService } from "../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { RerunClassificationCommand } from "../../../classification/application/commands/rerun-classification/rerun-classification.command.js";
import { AssessmentInterviewRuntimeService } from "./assessment-interview-runtime.service.js";
import { AssessmentLifecycleCoordinator } from "./assessment-lifecycle-coordinator.service.js";

/**
 * One Customer "Continue" for a paused or stopped assessment pipeline. The API,
 * not the browser, decides which step to restart: a failed or stalled Interview
 * turn is re-run, otherwise the accepted technical evidence is re-sent so the
 * gated engineering assessment (rules, repository analysis, gate) resumes
 * from the governed Interview context already on record.
 */
@Injectable()
export class AssessmentPipelineContinuationService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly interviewRuntime: AssessmentInterviewRuntimeService,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
    private readonly runtimeControl: AssessmentRuntimeControlService,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
  ) {}

  /** Whether the customer stopped the pipeline and has not continued it. */
  isStoppedByCustomer(assessmentId: string): Promise<boolean> {
    return this.runtimeEvents.isPipelineStoppedByCustomer(assessmentId);
  }

  async continuePipeline(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    actorType?: AuditActorType;
  }): Promise<AssessmentPipelineContinueResult> {
    await this.interviewRuntime.assertAssessmentVisible(
      input.assessmentId,
      input.actor,
    );
    const lifecycle = await this.lifecycle.current(
      input.assessmentId,
      input.actor,
      input.correlationId,
    );
    if (
      !lifecycle ||
      lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.COMPLETE ||
      lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.CANCELLED
    ) {
      throw this.conflict(
        lifecycle
          ? ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.completed
          : ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        input.correlationId,
      );
    }
    const control = await this.runtimeControl.current(input.assessmentId);
    if (
      control &&
      control.state !== ASSESSMENT_RUNTIME_CONTROL_STATES.completed &&
      control.state !== ASSESSMENT_RUNTIME_CONTROL_STATES.running
    ) {
      const requested = await this.runtimeControl.request({
        assessmentId: input.assessmentId,
        actor: input.actor,
        correlationId: input.correlationId,
        action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
        targetRunId: control.targetRunId,
      });
      return {
        action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.checkpointResumeRequested,
        control: requested,
      };
    }
    const liveness = await this.runtimeEvents.getPipelineLiveness(
      input.assessmentId,
      ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS * 1_000,
    );
    if (liveness.live) {
      throw this.conflict(
        ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.alreadyRunning,
        input.correlationId,
        {
          lastActivityAt: liveness.lastActivityAt?.toISOString() ?? "",
          retryAfterSeconds: String(
            ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS,
          ),
        },
      );
    }
    // Continue lifts a customer stop; remember whether there was one so the
    // rerun is not swallowed by the stopped dispatch's recent outbox row.
    const afterCustomerStop =
      await this.runtimeEvents.isPipelineStoppedByCustomer(input.assessmentId);
    await this.runtimeEvents.recordPipelineControl({
      assessmentId: input.assessmentId,
      correlationId: input.correlationId,
      reason:
        ASSESSMENT_RUNTIME_PIPELINE_CONTROL_REASONS.customerRequestedContinue,
    });
    const interview = await this.interviewRuntime.pipelineInterviewStatus(
      input.assessmentId,
    );
    if (interview.awaitingCustomer) {
      throw this.conflict(
        ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.waitingForCustomer,
        input.correlationId,
      );
    }
    if (interview.pendingTurn) {
      await this.interviewRuntime.resumeFailedTurn({
        assessmentId: input.assessmentId,
        actor: input.actor,
        correlationId: input.correlationId,
        resume: {},
        allowStalled: true,
        actorType: input.actorType,
      });
      return {
        action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.interviewTurnResumed,
      };
    }
    await this.commandBus.execute(
      new RerunClassificationCommand(
        input.assessmentId,
        input.actor,
        input.correlationId,
        ASSESSMENT_PIPELINE_CONTINUE_RERUN_REASON,
        input.actorType ?? AUDIT_ACTOR_TYPES.user,
        afterCustomerStop,
      ),
    );
    return { action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.downstreamRequeued };
  }

  private conflict(
    code: string,
    correlationId: string,
    meta?: Record<string, string>,
  ) {
    return problemException(code, correlationId, {
      status: HttpStatus.CONFLICT,
      meta,
    });
  }
}
