import { jest } from "@jest/globals";
import {
  VERIFIED_AGENT_EPISODE_RECORD_STATUSES,
  VERIFIED_AGENT_EPISODE_TRUST_LEVELS,
  VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { CaptureVerifiedAgentEpisodeCommand } from "./capture-verified-agent-episode.command.js";
import { CaptureVerifiedAgentEpisodeHandler } from "./capture-verified-agent-episode.handler.js";

type EpisodeRow = ReturnType<typeof episodeRow>;

describe("CaptureVerifiedAgentEpisodeHandler", () => {
  it("persists verified episode through Prisma upsert", async () => {
    const upsert = jest.fn<(args: unknown) => Promise<EpisodeRow>>();
    upsert.mockResolvedValue(episodeRow());
    const prisma = {
      verifiedAgentEpisode: { upsert },
    } as unknown as PrismaService;
    const handler = new CaptureVerifiedAgentEpisodeHandler(prisma);

    const result = await handler.execute(
      new CaptureVerifiedAgentEpisodeCommand(
        "assessment-1",
        {
          record_id: "episode:1",
          owner_agent: "planner",
          workflow_run_id: "workflow-1",
          assessment_id: "assessment-1",
          engineering_rule_ids: ["ENG-1"],
          artifact_versions: { technicalEvidenceReportId: "ter-1" },
          trust_level: VERIFIED_AGENT_EPISODE_TRUST_LEVELS.verifiedExample,
          validation_status:
            VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES.verified,
          schema_version: "lcsp.verified_episode.v1",
          content_hash: "sha256:hash",
          domain_key: "planner:ENG-1",
          input_signature: "sha256:input",
          successful_strategy_summary: "READY strategy",
          evidence_refs: ["evidence:1"],
          prompt_version: "planner.v1",
          model_id: "test-model",
          summary: "READY",
          handoff: { status: "READY" },
        },
        "user-1",
        "correlation-1",
      ),
    );

    const upsertArg = firstMockArg(upsert);
    expect(upsertArg.where).toEqual({
      assessmentId_contentHash: {
        assessmentId: "assessment-1",
        contentHash: "sha256:hash",
      },
    });
    expect(upsertArg.create).toMatchObject({
      validationStatus: VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES.verified,
    });
    expect(result.episode.record_id).toBe("episode:1");
  });

  it("rejects non-VERIFIED validation status before persistence", async () => {
    const upsert = jest.fn<(args: unknown) => Promise<EpisodeRow>>();
    const prisma = {
      verifiedAgentEpisode: { upsert },
    } as unknown as PrismaService;
    const handler = new CaptureVerifiedAgentEpisodeHandler(prisma);

    try {
      await handler.execute(
        new CaptureVerifiedAgentEpisodeCommand(
          "assessment-1",
          {
            record_id: "episode:1",
            owner_agent: "planner",
            assessment_id: "assessment-1",
            artifact_versions: { technicalEvidenceReportId: "ter-1" },
            validation_status: "VALIDATED",
            schema_version: "lcsp.verified_episode.v1",
            content_hash: "sha256:hash",
            domain_key: "planner:ENG-1",
            input_signature: "sha256:input",
            handoff: { status: "READY" },
          },
          "user-1",
          "correlation-1",
        ),
      );
      throw new Error(
        "Expected handler to reject non-VERIFIED validation status",
      );
    } catch (error: unknown) {
      expect(problemCode(error)).toBe("EVIDENCE_VALIDATION_FAILED");
    }
    expect(upsert).not.toHaveBeenCalled();
  });
});

function firstMockArg(
  mock: jest.Mock<(args: unknown) => Promise<EpisodeRow>>,
): Record<string, unknown> {
  const arg = mock.mock.calls[0]?.[0];
  if (!isRecord(arg)) {
    throw new Error("Expected Prisma mock to receive an object argument");
  }
  return arg;
}

function problemCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  const response = error["response"];
  if (!isRecord(response)) {
    return null;
  }
  const problem = response["problem"];
  if (!isRecord(problem)) {
    return null;
  }
  return typeof problem["code"] === "string" ? problem["code"] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function episodeRow() {
  return {
    id: "episode:1",
    ownerAgent: "planner",
    workflowRunId: "workflow-1",
    assessmentId: "assessment-1",
    engineeringRuleIds: ["ENG-1"],
    artifactVersions: { technicalEvidenceReportId: "ter-1" },
    trustLevel: VERIFIED_AGENT_EPISODE_TRUST_LEVELS.verifiedExample,
    validationStatus: VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES.verified,
    schemaVersion: "lcsp.verified_episode.v1",
    contentHash: "sha256:hash",
    domainKey: "planner:ENG-1",
    inputSignature: "sha256:input",
    successfulStrategySummary: "READY strategy",
    evidenceRefs: ["evidence:1"],
    promptVersion: "planner.v1",
    modelId: "test-model",
    summary: "READY",
    handoffJson: { status: "READY" },
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    expiresAt: null,
    status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
  };
}
