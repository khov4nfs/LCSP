import { jest } from "@jest/globals";
import {
  VERIFIED_AGENT_EPISODE_RECORD_STATUSES,
  VERIFIED_AGENT_EPISODE_TRUST_LEVELS,
  VERIFIED_AGENT_EPISODE_VALIDATION_STATUSES,
} from "@lcsp/contracts/evidence";

import { isRecord } from "../../../../../common/utils/index.js";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { RetrieveVerifiedAgentEpisodesHandler } from "./retrieve-verified-agent-episodes.handler.js";
import { RetrieveVerifiedAgentEpisodesQuery } from "./retrieve-verified-agent-episodes.query.js";

type EpisodeRow = ReturnType<typeof baseEpisode>;

describe("RetrieveVerifiedAgentEpisodesHandler", () => {
  it("uses exact assessment owner status filters and then filters rule IDs and artifact versions", async () => {
    const findMany = jest.fn<(args: unknown) => Promise<EpisodeRow[]>>();
    findMany.mockResolvedValue([
      episode({
        id: "episode:1",
        engineeringRuleIds: ["ENG-1"],
        artifactVersions: { technicalEvidenceReportId: "ter-1" },
      }),
      episode({
        id: "episode:2",
        engineeringRuleIds: ["ENG-2"],
        artifactVersions: { technicalEvidenceReportId: "ter-1" },
      }),
      episode({
        id: "episode:3",
        engineeringRuleIds: ["ENG-1"],
        artifactVersions: { technicalEvidenceReportId: "ter-2" },
      }),
    ]);
    const prisma = {
      verifiedAgentEpisode: { findMany },
    } as unknown as PrismaService;
    const handler = new RetrieveVerifiedAgentEpisodesHandler(prisma);

    const result = await handler.execute(
      new RetrieveVerifiedAgentEpisodesQuery(
        "assessment-1",
        {
          ownerAgent: "planner",
          engineeringRuleIds: ["ENG-1"],
          artifactVersions: { technicalEvidenceReportId: "ter-1" },
        },
        "user-1",
        "correlation-1",
      ),
    );

    const findManyArg = firstMockArg(findMany);
    expect(findManyArg.take).toBe(100);
    expect(findManyArg.where).toMatchObject({
      assessmentId: "assessment-1",
      ownerAgent: "planner",
      status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
    });
    expect(result.episodes.map((item) => item.record_id)).toEqual([
      "episode:1",
    ]);
    expect(result.retrieval).toEqual({ mode: "EXACT_FILTER" });
  });

  it("limits exact-filter results after compatibility filtering", async () => {
    const findMany = jest.fn<(args: unknown) => Promise<EpisodeRow[]>>();
    findMany.mockResolvedValue([
      episode({ id: "episode:1" }),
      episode({ id: "episode:2" }),
    ]);
    const prisma = {
      verifiedAgentEpisode: { findMany },
    } as unknown as PrismaService;
    const handler = new RetrieveVerifiedAgentEpisodesHandler(prisma);

    const result = await handler.execute(
      new RetrieveVerifiedAgentEpisodesQuery(
        "assessment-1",
        {
          ownerAgent: "planner",
          engineeringRuleIds: ["ENG-1"],
          artifactVersions: { technicalEvidenceReportId: "ter-1" },
          limit: 1,
        },
        "user-1",
        "correlation-1",
      ),
    );

    expect(result.episodes.map((item) => item.record_id)).toEqual([
      "episode:1",
    ]);
  });
});

function firstMockArg(
  mock: jest.Mock<(args: unknown) => Promise<EpisodeRow[]>>,
): Record<string, unknown> {
  const arg = mock.mock.calls[0]?.[0];
  if (!isRecord(arg)) {
    throw new Error("Expected Prisma mock to receive an object argument");
  }
  return arg;
}

function episode(overrides: Partial<ReturnType<typeof baseEpisode>>) {
  return { ...baseEpisode(), ...overrides };
}

function baseEpisode() {
  return {
    id: "episode:base",
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
    successfulStrategySummary: "summary strategy",
    evidenceRefs: ["evidence:1"],
    promptVersion: "planner.v1",
    modelId: "test-model",
    summary: "summary",
    handoffJson: { status: "READY" },
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    expiresAt: null,
    status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active,
  };
}
