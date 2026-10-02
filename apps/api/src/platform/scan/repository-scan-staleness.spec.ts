import { jest } from "@jest/globals";
import {
  DEFAULT_REPOSITORY_SCAN_STALE_AFTER_MS,
  failStaleRepositoryScanJobs,
  repositoryScanStaleAfterMs,
} from "./repository-scan-staleness.js";

describe("repository scan staleness", () => {
  const originalEnv = process.env.REPOSITORY_SCAN_STALE_AFTER_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REPOSITORY_SCAN_STALE_AFTER_MS;
    } else {
      process.env.REPOSITORY_SCAN_STALE_AFTER_MS = originalEnv;
    }
  });

  it("uses the fixed five-minute inactivity window even when a legacy env override exists", () => {
    process.env.REPOSITORY_SCAN_STALE_AFTER_MS = String(45 * 60 * 1000);

    expect(DEFAULT_REPOSITORY_SCAN_STALE_AFTER_MS).toBe(5 * 60 * 1000);
    expect(repositoryScanStaleAfterMs()).toBe(5 * 60 * 1000);
  });

  it("keeps a long-running scan alive when a recent runtime heartbeat exists", async () => {
    const now = new Date("2026-10-01T02:00:00.000Z");
    const findMany = jest
      .fn<() => Promise<Array<{ id: string; updatedAt: Date }>>>()
      .mockResolvedValue([
        {
          id: "scan-1",
          updatedAt: new Date(now.getTime() - 20 * 60 * 1000),
        },
      ]);
    const findFirst = jest
      .fn<() => Promise<{ createdAt: Date }>>()
      .mockResolvedValue({
        createdAt: new Date(now.getTime() - 10_000),
      });
    const updateMany = jest.fn();

    const stale = await failStaleRepositoryScanJobs(
      {
        repositoryScanJob: { findMany, updateMany },
        assessmentRuntimeEvent: { findFirst },
      } as never,
      { assessmentId: "assessment-1", now },
    );

    expect(stale).toEqual([]);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: "scan-1" },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("fails an abandoned active scan after five minutes without runtime activity", async () => {
    const now = new Date("2026-10-01T02:00:00.000Z");
    const findMany = jest
      .fn<() => Promise<Array<{ id: string; updatedAt: Date }>>>()
      .mockResolvedValue([
        {
          id: "scan-1",
          updatedAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
      ]);
    const findFirst = jest
      .fn<() => Promise<{ createdAt: Date }>>()
      .mockResolvedValue({
        createdAt: new Date(now.getTime() - 6 * 60 * 1000),
      });
    const updateMany = jest
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });

    const stale = await failStaleRepositoryScanJobs(
      {
        repositoryScanJob: { findMany, updateMany },
        assessmentRuntimeEvent: { findFirst },
      } as never,
      { now },
    );

    expect(stale).toEqual(["scan-1"]);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["scan-1"] } },
        data: expect.objectContaining({
          blockedReason: expect.any(String) as string,
        }) as unknown,
      }),
    );
  });
});
