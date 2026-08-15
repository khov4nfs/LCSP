import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";
import { jest } from "@jest/globals";

import type { PythonWorkerRuntimeClient } from "../../application/services/evidence/python-worker-runtime.client.js";
import {
  dispatchAgenticToolWorkerBridge,
  request_targeted_reanalysis,
  resume_waiting_runs,
} from "./agentic-tool-worker-bridge-dispatcher.js";

const baseArgs = {
  assessmentId: "assessment-1",
  organizationId: "org-1",
  userId: "user-1",
  correlationId: "correlation-1",
};

describe("agentic worker bridge dispatcher", () => {
  it("exports exact same-name bridge functions", () => {
    expect(request_targeted_reanalysis.name).toBe(
      "request_targeted_reanalysis",
    );
    expect(resume_waiting_runs.name).toBe("resume_waiting_runs");
  });

  it("routes request_targeted_reanalysis through PythonWorkerRuntimeClient", async () => {
    const requestTargetedReanalysis = jest.fn(() =>
      Promise.resolve({ status: "READY" }),
    );
    const client = {
      requestTargetedReanalysis,
    } as unknown as PythonWorkerRuntimeClient;
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

    await dispatchAgenticToolWorkerBridge(args, client);

    expect(requestTargetedReanalysis).toHaveBeenCalledTimes(1);
  });

  it("routes resume_waiting_runs through PythonWorkerRuntimeClient", async () => {
    const resumeWaitingRuns = jest.fn(() =>
      Promise.resolve({ status: "READY" }),
    );
    const client = {
      resumeWaitingRuns,
    } as unknown as PythonWorkerRuntimeClient;
    const args = {
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.resumeWaitingRuns,
      artifactVersions: { corpusVersionId: "corpus-1" },
      input: {
        maxRuns: 25,
        idempotencyKey: "resume-12345678",
      },
    };

    await dispatchAgenticToolWorkerBridge(args, client);

    expect(resumeWaitingRuns).toHaveBeenCalledTimes(1);
  });
});
