import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { HeartbeatAssessmentRootCommand } from "./heartbeat-assessment-root.command.js";
import { HeartbeatAssessmentRootHandler } from "./heartbeat-assessment-root.handler.js";

describe("HeartbeatAssessmentRootHandler", () => {
  it("forwards heartbeat renewal parameters to runtime authority", async () => {
    const nextExpiresAt = new Date(Date.now() + 60000).toISOString();
    const heartbeatResult = {
      leaseExpiresAt: nextExpiresAt,
    };
    const authority = {
      heartbeat: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(heartbeatResult),
    };
    const handler = new HeartbeatAssessmentRootHandler(
      authority as unknown as AssessmentRuntimeAuthority,
    );

    const assessmentId = randomUUID();
    const command = new HeartbeatAssessmentRootCommand(
      assessmentId,
      "lease-token-xyz",
      "corr-789",
    );
    const result = await handler.execute(command);

    expect(result).toEqual(heartbeatResult);
    expect(authority.heartbeat).toHaveBeenCalledWith({
      assessmentId,
      leaseToken: "lease-token-xyz",
      correlationId: "corr-789",
    });
  });
});
