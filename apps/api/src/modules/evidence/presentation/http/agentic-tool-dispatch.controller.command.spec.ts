import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";
import {
  PBAC_ACTIONS,
  PBAC_DECISION,
  PBAC_REASON_CODE,
} from "@lcsp/contracts/pbac";
import { jest } from "@jest/globals";
import type { ConfigService } from "@nestjs/config";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";

import type { AppConfig } from "../../../../config/config.types.js";
import type { PbacPreflightService } from "../../../../platform/pbac/pbac-preflight.service.js";
import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { PythonWorkerRuntimeClient } from "../../application/services/evidence/python-worker-runtime.client.js";
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
    tool_name: AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
    assessment_id: "assessment-1",
    organization_id: "org-1",
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
  it("re-evaluates PBAC and passes trusted policy metadata to CommandBus", async () => {
    const queryExecute = jest.fn();
    const queryBus = { execute: queryExecute } as unknown as QueryBus;
    const pythonWorkerRuntime = {} as PythonWorkerRuntimeClient;
    const commandExecute = jest.fn(() => Promise.resolve({ status: "READY" }));
    const commandBus = { execute: commandExecute } as unknown as CommandBus;
    const evaluateWithPolicy = jest.fn(() =>
      Promise.resolve({
        decision: PBAC_DECISION.allow,
        reasonCode: null,
        correlationId: "correlation-1",
        policyId: "policy-trusted",
        policyVersion: "v7",
      }),
    );
    const pbacPreflight = {
      evaluateWithPolicy,
    } as unknown as PbacPreflightService;

    const controller = new InternalAgenticToolDispatchController(
      queryBus,
      pythonWorkerRuntime,
      configMock(),
      runtimeEventsMock(),
      commandBus,
      pbacPreflight,
    );

    await controller.dispatch(commandPayload());

    expect(evaluateWithPolicy).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      action: PBAC_ACTIONS.classificationReviewSubmit,
      correlationId: "correlation-1",
    });
    expect(commandExecute).toHaveBeenCalledTimes(1);
    const command = (commandExecute.mock.calls as unknown[][])[0][0] as {
      policyId: string;
      policyVersion: string;
    };
    expect(command.policyId).toBe("policy-trusted");
    expect(command.policyVersion).toBe("v7");
    expect(queryExecute).not.toHaveBeenCalled();
  });

  it("fails closed on PBAC deny before CommandBus execution", async () => {
    const queryExecute = jest.fn();
    const queryBus = { execute: queryExecute } as unknown as QueryBus;
    const commandExecute = jest.fn();
    const commandBus = { execute: commandExecute } as unknown as CommandBus;
    const evaluateWithPolicy = jest.fn(() =>
      Promise.resolve({
        decision: PBAC_DECISION.deny,
        reasonCode: PBAC_REASON_CODE.actionNotGranted,
        correlationId: "correlation-1",
        policyId: null,
        policyVersion: null,
      }),
    );
    const pbacPreflight = {
      evaluateWithPolicy,
    } as unknown as PbacPreflightService;

    const controller = new InternalAgenticToolDispatchController(
      queryBus,
      {} as PythonWorkerRuntimeClient,
      configMock(),
      runtimeEventsMock(),
      commandBus,
      pbacPreflight,
    );

    await expect(controller.dispatch(commandPayload())).rejects.toBeDefined();
    expect(commandExecute).not.toHaveBeenCalled();
    expect(queryExecute).not.toHaveBeenCalled();
  });
});
