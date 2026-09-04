import { jest } from "@jest/globals";
import { VERIFIED_AGENT_EPISODE_RECORD_STATUSES } from "@lcsp/contracts/evidence";
import { isRecord } from "../../../../common/utils/index.js";
import { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { VerifiedAgentEpisodeConsolidationWorker } from "./verified-agent-episode-consolidation.worker.js";
import type { VerifiedAgentEpisodeDeduplicationService } from "./verified-agent-episode-deduplication.service.js";

describe("VerifiedAgentEpisodeConsolidationWorker", () => {
  it("does not start when consolidation interval is not configured", () => {
    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    const worker = new VerifiedAgentEpisodeConsolidationWorker(
      prisma({ count: 0 }),
      configService(undefined),
      deduplicationService(0),
    );

    worker.onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("expires active TTL episodes across assessments", async () => {
    const updateMany = jest.fn<(args: unknown) => Promise<{ count: number }>>();
    updateMany.mockResolvedValue({ count: 2 });
    const worker = new VerifiedAgentEpisodeConsolidationWorker(
      {
        verifiedAgentEpisode: {
          findMany: jest
            .fn<() => Promise<Array<{ id: string }>>>()
            .mockResolvedValue([{ id: "episode:ttl" }]),
          updateMany,
        },
      } as unknown as PrismaService,
      configService(undefined),
      deduplicationService(1),
    );

    await expect(worker.consolidateExpiredEpisodes()).resolves.toEqual({
      expiredCount: 2,
      duplicateCount: 1,
      expiredEpisodeIds: ["episode:ttl", "episode:duplicate"],
    });
    const updateManyArg = firstMockArg(updateMany);
    const where = recordField(updateManyArg, "where");
    const expiresAt = recordField(where, "expiresAt");
    expect(where.status).toBe(VERIFIED_AGENT_EPISODE_RECORD_STATUSES.active);
    expect(expiresAt.not).toBeNull();
    expect(expiresAt.lte).toBeInstanceOf(Date);
    expect(updateManyArg.data).toEqual({
      status: VERIFIED_AGENT_EPISODE_RECORD_STATUSES.expired,
    });
  });
});

function firstMockArg(
  mock: jest.Mock<(args: unknown) => Promise<{ count: number }>>,
): Record<string, unknown> {
  const arg = mock.mock.calls[0]?.[0];
  if (!isRecord(arg)) {
    throw new Error("Expected Prisma mock to receive an object argument");
  }
  return arg;
}

function recordField(
  value: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const result = value[field];
  if (!isRecord(result)) {
    throw new Error(`Expected ${field} to be an object`);
  }
  return result;
}

function prisma(result: { count: number }): PrismaService {
  return {
    verifiedAgentEpisode: {
      findMany: jest
        .fn<() => Promise<Array<{ id: string }>>>()
        .mockResolvedValue([]),
      updateMany: jest
        .fn<() => Promise<{ count: number }>>()
        .mockResolvedValue(result),
    },
  } as unknown as PrismaService;
}

function configService(intervalMs: number | undefined): ConfigService {
  return {
    get: jest.fn(() => intervalMs),
  } as unknown as ConfigService;
}

function deduplicationService(
  duplicateCount: number,
): VerifiedAgentEpisodeDeduplicationService {
  return {
    expireNearDuplicates: jest
      .fn<
        () => Promise<{
          duplicateCount: number;
          canonicalCount: number;
          duplicateIds: string[];
          canonicalIds: string[];
        }>
      >()
      .mockResolvedValue({
        duplicateCount,
        canonicalCount: 0,
        duplicateIds: duplicateCount > 0 ? ["episode:duplicate"] : [],
        canonicalIds: [],
      }),
  } as unknown as VerifiedAgentEpisodeDeduplicationService;
}
