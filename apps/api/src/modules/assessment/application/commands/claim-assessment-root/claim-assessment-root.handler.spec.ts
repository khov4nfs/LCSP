import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { ClaimAssessmentRootCommand } from "./claim-assessment-root.command.js";
import { ClaimAssessmentRootHandler } from "./claim-assessment-root.handler.js";

describe("ClaimAssessmentRootHandler", () => {
  it("forwards claim parameters with physical server ownership to runtime authority", async () => {
    const claimResult = {
      assessmentId: randomUUID(),
      threadId: randomUUID(),
      executionId: randomUUID(),
      leaseToken: "lease-token-abc",
      leaseExpiresAt: new Date().toISOString(),
      resumed: false,
      checkpointId: null,
      context: null,
    };
    const authority = {
      claimRoot: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(claimResult),
    };
    const handler = new ClaimAssessmentRootHandler(
      authority as unknown as AssessmentRuntimeAuthority,
    );

    const command = new ClaimAssessmentRootCommand(
      claimResult.assessmentId,
      "corr-123",
      "runtime-run-1",
      "incarnation-1",
    );
    const result = await handler.execute(command);

    expect(result).toEqual(claimResult);
    expect(authority.claimRoot).toHaveBeenCalledWith({
      assessmentId: claimResult.assessmentId,
      correlationId: "corr-123",
      runtimeRunId: "runtime-run-1",
      runtimeIncarnationId: "incarnation-1",
    });
  });
});
