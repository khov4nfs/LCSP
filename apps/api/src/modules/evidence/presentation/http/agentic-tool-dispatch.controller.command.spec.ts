import { jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";

import type { AppConfig } from "../../../../config/config.types.js";
import type { RbacPreflightService } from "../../../../platform/rbac/rbac-preflight.service.js";
import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { InternalAgenticToolDispatchController } from "./agentic-tool-dispatch.controller.js";

function runtimeEventsMock() {
  return {
    recordRunStartedIfMissing: jest.fn(() => Promise.resolve(undefined)),
    recordRunStageChangedIfNeeded: jest.fn(() => Promise.resolve(undefined)),
    recordToolStarted: jest.fn(() => Promise.resolve(undefined)),
    recordToolWaitingInput: jest.fn(() => Promise.resolve(undefined)),
    recordToolCompleted: jest.fn(() => Promise.resolve(undefined)),
    recordToolFailed: jest.fn(() => Promise.resolve(undefined)),
  } as unknown as AssessmentRuntimeEventService;
}

function configMock() {
  return {
    get: jest.fn(() => false),
  } as unknown as ConfigService<AppConfig, true>;
}

function commandPayload() {
  return {
    tool_name: "submit_classification_for_independent_review",
    assessment_id: "assessment-1",
    user_id: "user-1",
    correlationId: "correlation-1",
    workflow_run_id: "run-1",
    artifact_versions: { baselineId: "baseline-1" },
    input: {
      baselineRef: "legal-match:baseline-1",
      proposedClass: "HIGH_RISK",
      rationaleCitationRefs: ["citation:1"],
      proposalGateRef: "proposal-gate:1",
      idempotencyKey: "submit-12345678",
    },
  };
}

describe("InternalAgenticToolDispatchController protected commands", () => {
  it("rejects retired protected command tools without RBAC or CommandBus execution", async () => {
    const queryExecute = jest.fn(() =>
      Promise.reject(new Error("retired tool")),
    );
    const queryBus = { execute: queryExecute } as unknown as QueryBus;
    const commandExecute = jest.fn();
    const commandBus = { execute: commandExecute } as unknown as CommandBus;
    const evaluateWithPolicy = jest.fn();
    const rbacPreflight = {
      evaluateWithPolicy,
    } as unknown as RbacPreflightService;

    const controller = new InternalAgenticToolDispatchController(
      queryBus,
      configMock(),
      runtimeEventsMock(),
      commandBus,
      rbacPreflight,
    );

    await expect(controller.dispatch(commandPayload())).rejects.toBeDefined();

    expect(evaluateWithPolicy).not.toHaveBeenCalled();
    expect(commandExecute).not.toHaveBeenCalled();
    expect(queryExecute).not.toHaveBeenCalled();
  });
});
