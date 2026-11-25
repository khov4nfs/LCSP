import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AssessmentRuntimeControlService } from "../../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { ControlAssessmentRuntimeCommand } from "./control-assessment-runtime.command.js";
import { ControlAssessmentRuntimeHandler } from "./control-assessment-runtime.handler.js";

describe("ControlAssessmentRuntimeHandler", () => {
  it("delegates runtime control requests to AssessmentRuntimeControlService", async () => {
    const targetRunId = randomUUID();
    const controlResult = {
      state: ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested,
      targetRunId,
      requestId: randomUUID(),
    };
    const controls = {
      request: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(controlResult),
    };
    const handler = new ControlAssessmentRuntimeHandler(
      controls as unknown as AssessmentRuntimeControlService,
    );

    const actor = {
      userId: "user-1",
      role: AUTH_USER_ROLES.customer,
      sessionId: "session-1",
      scope: null,
    };

    const command = new ControlAssessmentRuntimeCommand(
      randomUUID(),
      actor,
      ASSESSMENT_RUNTIME_CONTROL_ACTIONS.stop,
      targetRunId,
      "corr-ctrl-1",
    );
    const result = await handler.execute(command);

    expect(result).toEqual(controlResult);
    expect(controls.request).toHaveBeenCalledWith(command);
  });

  it("propagates budgetExtension, idempotencyKey, and expectedVersion to AssessmentRuntimeControlService", async () => {
    const targetRunId = randomUUID();
    const controlResult = {
      state: ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested,
      targetRunId,
      requestId: randomUUID(),
    };
    const controls = {
      request: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(controlResult),
    };
    const handler = new ControlAssessmentRuntimeHandler(
      controls as unknown as AssessmentRuntimeControlService,
    );

    const adminActor = {
      userId: "admin-1",
      role: AUTH_USER_ROLES.admin,
      sessionId: "session-admin-1",
      scope: null,
    };
    const budgetExtension = {
      version: 2,
      auditReason: "Approve additional model calls after provider timeout",
      additionalModelCalls: 30,
    };

    // Simulate command populated with idempotencyKey and expectedVersion
    const command = Object.assign(
      new ControlAssessmentRuntimeCommand(
        randomUUID(),
        adminActor,
        ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
        targetRunId,
        "corr-ctrl-admin-1",
        "en",
        budgetExtension,
      ),
      {
        idempotencyKey: "idem-handler-1",
        expectedVersion: 1,
      },
    );
    const result = await handler.execute(command);

    expect(result).toEqual(controlResult);
    expect(controls.request).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "idem-handler-1",
        expectedVersion: 1,
        budgetExtension,
      }),
    );
  });
});
