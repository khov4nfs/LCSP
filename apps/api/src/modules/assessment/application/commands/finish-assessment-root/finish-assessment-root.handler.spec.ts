import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { FinishAssessmentRootCommand } from "./finish-assessment-root.command.js";
import { FinishAssessmentRootHandler } from "./finish-assessment-root.handler.js";

describe("FinishAssessmentRootHandler", () => {
  it("forwards settlement parameters to runtime authority", async () => {
    const settlementResult = {
      executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
    };
    const authority = {
      finishExecution: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(settlementResult),
    };
    const handler = new FinishAssessmentRootHandler(
      authority as unknown as AssessmentRuntimeAuthority,
    );

    const assessmentId = randomUUID();
    const command = new FinishAssessmentRootCommand(
      assessmentId,
      "lease-token-abc",
      AGENT_EXECUTION_STATES.SUCCEEDED,
      "corr-456",
      "chk-1",
      ["req-1"],
      "ctrl-1",
      false,
      "Completed successfully",
    );
    const result = await handler.execute(command);

    expect(result).toEqual(settlementResult);
    expect(authority.finishExecution).toHaveBeenCalledWith({
      assessmentId,
      leaseToken: "lease-token-abc",
      correlationId: "corr-456",
      toState: AGENT_EXECUTION_STATES.SUCCEEDED,
      checkpointId: "chk-1",
      requestIds: ["req-1"],
      controlRequestId: "ctrl-1",
      recoveryRequired: false,
      reason: "Completed successfully",
    });
  });
});
