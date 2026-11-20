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

  it("keeps a long-running scan alive when a recent runtime heartbeat exists via batched query", async () => {
    const now = new Date("2026-10-01T02:00:00.000Z");
    const scanFindMany = jest
      .fn<() => Promise<Array<{ id: string; updatedAt: Date }>>>()
      .mockResolvedValue([
        {
          id: "scan-1",
          updatedAt: new Date(now.getTime() - 20 * 60 * 1000),
        },
      ]);
    const eventFindMany = jest
      .fn<() => Promise<Array<{ runId: string; createdAt: Date }>>>()
      .mockResolvedValue([
        {
          runId: "scan-1",
          createdAt: new Date(now.getTime() - 10_000),
        },
      ]);
    const updateMany = jest.fn();

    const stale = await failStaleRepositoryScanJobs(
      {
        repositoryScanJob: { findMany: scanFindMany, updateMany },
        assessmentRuntimeEvent: { findMany: eventFindMany },
      } as never,
      { assessmentId: "assessment-1", now },
    );

    expect(stale).toEqual([]);
    expect(eventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: { in: ["scan-1"] } },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("fails an abandoned active scan after five minutes without runtime activity", async () => {
    const now = new Date("2026-10-01T02:00:00.000Z");
    const scanFindMany = jest
      .fn<() => Promise<Array<{ id: string; updatedAt: Date }>>>()
      .mockResolvedValue([
        {
          id: "scan-1",
          updatedAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
      ]);
    const eventFindMany = jest
      .fn<() => Promise<Array<{ runId: string; createdAt: Date }>>>()
      .mockResolvedValue([
        {
          runId: "scan-1",
          createdAt: new Date(now.getTime() - 6 * 60 * 1000),
        },
      ]);
    const updateMany = jest
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });

    const stale = await failStaleRepositoryScanJobs(
      {
        repositoryScanJob: { findMany: scanFindMany, updateMany },
        assessmentRuntimeEvent: { findMany: eventFindMany },
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

  it("resolves N+1 query loop by batching multiple candidates into a single findMany event query", async () => {
    const now = new Date("2026-10-01T02:00:00.000Z");
    const candidates = [
      {
        id: "scan-active-alive",
        updatedAt: new Date(now.getTime() - 15 * 60 * 1000),
      },
      {
        id: "scan-abandoned-1",
        updatedAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
      {
        id: "scan-abandoned-2",
        updatedAt: new Date(now.getTime() - 8 * 60 * 1000),
      },
    ];
    const scanFindMany = jest
      .fn<() => Promise<Array<{ id: string; updatedAt: Date }>>>()
      .mockResolvedValue(candidates);

    // Single batched query returns events for all candidates
    const eventFindMany = jest
      .fn<() => Promise<Array<{ runId: string; createdAt: Date }>>>()
      .mockResolvedValue([
        // Alive scan has a recent event
        {
          runId: "scan-active-alive",
          createdAt: new Date(now.getTime() - 60 * 1000),
        },
        // Abandoned scan 1 has an old event
        {
          runId: "scan-abandoned-1",
          createdAt: new Date(now.getTime() - 7 * 60 * 1000),
        },
        // Abandoned scan 2 has no events
      ]);

    const updateMany = jest
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 2 });

    const stale = await failStaleRepositoryScanJobs(
      {
        repositoryScanJob: { findMany: scanFindMany, updateMany },
        assessmentRuntimeEvent: { findMany: eventFindMany },
      } as never,
      { now },
    );

    // Exactly 1 batched call to eventFindMany with all 3 candidates
    expect(eventFindMany).toHaveBeenCalledTimes(1);
    expect(eventFindMany).toHaveBeenCalledWith({
      where: {
        runId: {
          in: ["scan-active-alive", "scan-abandoned-1", "scan-abandoned-2"],
        },
      },
      orderBy: { createdAt: "desc" },
      select: { runId: true, createdAt: true },
    });

    // Only abandoned scans are marked as stale
    expect(stale).toEqual(["scan-abandoned-1", "scan-abandoned-2"]);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["scan-abandoned-1", "scan-abandoned-2"] },
        }),
      }),
    );
  });

  it("enforces tenant/workspace scoping with ownerId and assessmentId in queries and updates", async () => {
    const now = new Date("2026-10-01T02:00:00.000Z");
    const scanFindMany = jest
      .fn<() => Promise<Array<{ id: string; updatedAt: Date }>>>()
      .mockResolvedValue([
        {
          id: "scan-tenant-1",
          updatedAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
      ]);
    const eventFindMany = jest
      .fn<() => Promise<Array<{ runId: string; createdAt: Date }>>>()
      .mockResolvedValue([]);
    const updateMany = jest
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });

    await failStaleRepositoryScanJobs(
      {
        repositoryScanJob: { findMany: scanFindMany, updateMany },
        assessmentRuntimeEvent: { findMany: eventFindMany },
      } as never,
      { assessmentId: "asmt-999", ownerId: "user-888", now },
    );

    // Verify candidate query was scoped by tenant/owner and assessment
    expect(scanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assessmentId: "asmt-999",
          assessment: { ownerId: "user-888" },
        }),
      }),
    );

    // Verify update was scoped by tenant/owner and assessment
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["scan-tenant-1"] },
          assessmentId: "asmt-999",
          assessment: { ownerId: "user-888" },
        }),
      }),
    );
  });
});
