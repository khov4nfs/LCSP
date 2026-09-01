import { jest } from "@jest/globals";
import { VERIFIED_AGENT_EPISODE_RECORD_STATUSES } from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { VerifiedAgentEpisodeDeduplicationService } from "./verified-agent-episode-deduplication.service.js";

describe("VerifiedAgentEpisodeDeduplicationService", () => {
  it("expires near duplicates while keeping the newest canonical episode", async () => {
    const findMany = jest.fn<(args: unknown) => Promise<Array<EpisodeRow>>>();
    const updateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>();
    findMany.mockResolvedValue([
      row({ id: "episode:canonical", contentHash: "hash:1" }),
      row({ id: "episode:duplicate", contentHash: "hash:2" }),
      row({
        id: "episode:other-domain",
        domainKey: "planner:ENG-2",
        contentHash: "hash:3",
      }),
    ]);
    updateMany.mockResolvedValue({ count: 1 });
    const service = new VerifiedAgentEpisodeDeduplicationService({
      verifiedAgentEpisode: { findMany, updateMany },
    } as unknown as PrismaService);

    await expect(
      service.expireNearDuplicates({ assessmentId: "assessment-1" }),
    ).resolves.toEqual({
      duplicateCount: 1,
      canonicalCount: 2,
      duplicateIds: ["episode:duplicate"],
      canonicalIds: ["episode:canonical", "episode:other-domain"],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["episode:duplicate"] } },
      data: { status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.expired },
    });
  });
});

type EpisodeRow = {
  id: string;
  assessmentId: string;
  ownerAgent: string;
  domainKey: string;
  inputSignature: string;
  promptVersion: string;
  modelId: string;
  contentHash: string;
  createdAt: Date;
};

function row(overrides: Partial<EpisodeRow>): EpisodeRow {
  return {
    id: "episode",
    assessmentId: "assessment-1",
    ownerAgent: "planner",
    domainKey: "planner:ENG-1",
    inputSignature: "signature:1",
    promptVersion: "planner.v1",
    modelId: "model-1",
    contentHash: "hash",
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    ...overrides,
  };
}
