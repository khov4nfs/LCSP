import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_PIPELINE_CONTINUE_ACTIONS,
  ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES,
  ASSESSMENT_PIPELINE_CONTINUE_RERUN_REASON,
  ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS,
  ASSESSMENT_RUNTIME_PIPELINE_CONTROL_REASONS,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";
import { AssessmentStatus } from "@prisma/client";
import type { CommandBus } from "@nestjs/cqrs";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { AssessmentRuntimeControlService } from "../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { RerunClassificationCommand } from "../../../classification/application/commands/rerun-classification/rerun-classification.command.js";
import type { AssessmentInterviewRuntimeService } from "./assessment-interview-runtime.service.js";
import { AssessmentPipelineContinuationService } from "./assessment-pipeline-continuation.service.js";

const actor = {
  userId: "user-1",
  sessionId: "session-1",
  role: AUTH_USER_ROLES.customer,
  scope: "assessment:assessment-1",
};

describe("AssessmentPipelineContinuationService", () => {
  let findAssessment: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let execute: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let interview: {
    assertAssessmentVisible: jest.Mock<(...args: unknown[]) => Promise<void>>;
    pipelineInterviewStatus: jest.Mock<
      (...args: unknown[]) => Promise<{
        awaitingCustomer: boolean;
        pendingTurn: boolean;
      }>
    >;
    resumeFailedTurn: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let liveness: jest.Mock<
    (...args: unknown[]) => Promise<{
      live: boolean;
      lastActivityAt: Date | null;
    }>
  >;
  let stoppedByCustomer: jest.Mock<(...args: unknown[]) => Promise<boolean>>;
  let recordControl: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let service: AssessmentPipelineContinuationService;
  let currentControl: jest.Mock<
    (...args: unknown[]) => Promise<AssessmentRuntimeControlResult | null>
  >;
  let requestControl: jest.Mock<
    (...args: unknown[]) => Promise<AssessmentRuntimeControlResult>
  >;

  const run = () =>
    service.continuePipeline({
      assessmentId: "assessment-1",
      actor,
      correlationId: "corr-continue",
    });

  beforeEach(() => {
    findAssessment = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ status: AssessmentStatus.CLASSIFICATION_LOCKED });
    execute = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({});
    interview = {
      assertAssessmentVisible: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      pipelineInterviewStatus: jest
        .fn<
          (...args: unknown[]) => Promise<{
            awaitingCustomer: boolean;
            pendingTurn: boolean;
          }>
        >()
        .mockResolvedValue({ awaitingCustomer: false, pendingTurn: false }),
      resumeFailedTurn: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({}),
    };
    liveness = jest
      .fn<
        (...args: unknown[]) => Promise<{
          live: boolean;
          lastActivityAt: Date | null;
        }>
      >()
      .mockResolvedValue({ live: false, lastActivityAt: null });
    stoppedByCustomer = jest
      .fn<(...args: unknown[]) => Promise<boolean>>()
      .mockResolvedValue(false);
    recordControl = jest
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    currentControl = jest
      .fn<
        (...args: unknown[]) => Promise<AssessmentRuntimeControlResult | null>
      >()
      .mockResolvedValue(null);
    requestControl =
      jest.fn<
        (...args: unknown[]) => Promise<AssessmentRuntimeControlResult>
      >();
    service = new AssessmentPipelineContinuationService(
      {
        // No wallet/billing model on purpose: continue must never consult one.
        assessment: { findUnique: findAssessment },
      } as unknown as PrismaService,
      { execute } as unknown as CommandBus,
      interview as unknown as AssessmentInterviewRuntimeService,
      {
        getPipelineLiveness: liveness,
        isPipelineStoppedByCustomer: stoppedByCustomer,
        recordPipelineControl: recordControl,
      } as unknown as AssessmentRuntimeEventService,
      {
        current: currentControl,
        request: requestControl,
      } as unknown as AssessmentRuntimeControlService,
    );
  });

  it("uses native checkpoint resume before any legacy requeue or rule rerun", async () => {
    currentControl.mockResolvedValue({
      state: States.stopped,
      targetRunId: "native-run",
      requestId: "stop",
    });
    const control = {
      state: States.resumeRequested,
      targetRunId: "native-run",
      requestId: "resume",
    };
    requestControl.mockResolvedValue(control);
    await expect(run()).resolves.toEqual({
      action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.checkpointResumeRequested,
      control,
    });
    expect(requestControl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: Actions.resume,
        targetRunId: "native-run",
      }),
    );
    expect(interview.resumeFailedTurn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(recordControl).not.toHaveBeenCalled();
    expect(liveness).not.toHaveBeenCalled();
  });

  it("does not fall back to replay when Stop acknowledgement is pending", async () => {
    currentControl.mockResolvedValue({
      state: States.stopRequested,
      targetRunId: "native-run",
      requestId: "stop",
    });
    requestControl.mockRejectedValue(new Error("not stopped"));
    await expect(run()).rejects.toThrow("not stopped");
    expect(execute).not.toHaveBeenCalled();
    expect(interview.resumeFailedTurn).not.toHaveBeenCalled();
  });

  it("re-sends accepted evidence when the downstream pipeline stopped", async () => {
    await expect(run()).resolves.toEqual({
      action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.downstreamRequeued,
    });

    expect(interview.assertAssessmentVisible).toHaveBeenCalledWith(
      "assessment-1",
      actor,
    );
    expect(liveness).toHaveBeenCalledWith(
      "assessment-1",
      ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS * 1_000,
    );
    expect(execute).toHaveBeenCalledWith(
      new RerunClassificationCommand(
        "assessment-1",
        actor,
        "corr-continue",
        ASSESSMENT_PIPELINE_CONTINUE_RERUN_REASON,
        AUDIT_ACTOR_TYPES.user,
        false,
      ),
    );
    expect(interview.resumeFailedTurn).not.toHaveBeenCalled();
  });

  it("continuing after a customer stop lifts the stop and is never swallowed as a duplicate", async () => {
    stoppedByCustomer.mockResolvedValue(true);

    await expect(run()).resolves.toEqual({
      action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.downstreamRequeued,
    });

    expect(recordControl).toHaveBeenCalledWith({
      assessmentId: "assessment-1",
      correlationId: "corr-continue",
      reason:
        ASSESSMENT_RUNTIME_PIPELINE_CONTROL_REASONS.customerRequestedContinue,
    });
    expect(execute).toHaveBeenCalledWith(
      new RerunClassificationCommand(
        "assessment-1",
        actor,
        "corr-continue",
        ASSESSMENT_PIPELINE_CONTINUE_RERUN_REASON,
        AUDIT_ACTOR_TYPES.user,
        true,
      ),
    );
  });

  it("re-runs a failed or stalled Interview turn instead of skipping it", async () => {
    interview.pipelineInterviewStatus.mockResolvedValue({
      awaitingCustomer: false,
      pendingTurn: true,
    });

    await expect(run()).resolves.toEqual({
      action: ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.interviewTurnResumed,
    });

    expect(interview.resumeFailedTurn).toHaveBeenCalledWith({
      assessmentId: "assessment-1",
      actor,
      correlationId: "corr-continue",
      resume: {},
      allowStalled: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses to start a duplicate run while a worker still owns the pipeline", async () => {
    liveness.mockResolvedValue({
      live: true,
      lastActivityAt: new Date("2026-09-26T13:00:00.000Z"),
    });

    await expect(run()).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          status: 409,
          code: ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.alreadyRunning,
          meta: { lastActivityAt: "2026-09-26T13:00:00.000Z" },
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(interview.resumeFailedTurn).not.toHaveBeenCalled();
  });

  it("points the Customer at the open question instead of restarting work", async () => {
    interview.pipelineInterviewStatus.mockResolvedValue({
      awaitingCustomer: true,
      pendingTurn: false,
    });

    await expect(run()).rejects.toMatchObject({
      response: {
        problem: {
          code: ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.waitingForCustomer,
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("has nothing to continue once the assessment has finished", async () => {
    findAssessment.mockResolvedValue({
      status: AssessmentStatus.AI_NOT_DETECTED,
    });

    await expect(run()).rejects.toMatchObject({
      response: {
        problem: { code: ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.completed },
      },
    });
    expect(liveness).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
