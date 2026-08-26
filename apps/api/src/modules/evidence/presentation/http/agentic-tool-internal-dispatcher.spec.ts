import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";
import { jest } from "@jest/globals";
import type { CommandBus } from "@nestjs/cqrs";

import {
  dispatchAgenticToolInternalCommand,
  request_targeted_reanalysis,
  resume_waiting_runs,
} from "./agentic-tool-internal-dispatcher.js";

const baseArgs = {
  assessmentId: "assessment-1",
  userId: "user-1",
  correlationId: "correlation-1",
};

describe("agentic internal command dispatcher", () => {
  it("exports exact same-name command functions", () => {
    expect(request_targeted_reanalysis.name).toBe(
      "request_targeted_reanalysis",
    );
    expect(resume_waiting_runs.name).toBe("resume_waiting_runs");
  });

  it("routes request_targeted_reanalysis through CommandBus", async () => {
    const execute = jest.fn(() => Promise.resolve({ status: "READY" }));
    const commandBus = { execute } as unknown as CommandBus;
    const args = {
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.requestTargetedReanalysis,
      artifactVersions: { technicalEvidenceReportId: "ter-1" },
      input: {
        analyzerId: "RUN_TS_JS_SEMANTIC_ANALYSIS",
        scope: { pathPrefixes: ["apps/api/"] },
        reasonRequirementId: "requirement:12345678",
        idempotencyKey: "request-12345678",
      },
    };

    await dispatchAgenticToolInternalCommand(args, commandBus);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("routes resume_waiting_runs through CommandBus", async () => {
    const execute = jest.fn(() => Promise.resolve({ status: "READY" }));
    const commandBus = { execute } as unknown as CommandBus;
    const args = {
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.resumeWaitingRuns,
      artifactVersions: { corpusVersionId: "corpus-1" },
      input: {
        maxRuns: 25,
        idempotencyKey: "resume-12345678",
      },
    };

    await dispatchAgenticToolInternalCommand(args, commandBus);

    expect(execute).toHaveBeenCalledTimes(1);
  });
});
