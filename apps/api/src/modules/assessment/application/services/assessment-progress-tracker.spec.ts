import { describe, expect, it, jest } from "@jest/globals";
import { calculateConsecutiveTurnsWithoutProgress } from "./assessment-progress-tracker.js";

describe("calculateConsecutiveTurnsWithoutProgress", () => {
  it("resets counter to 0 when active RUNNING turn advances caseRevision", async () => {
    const turns = [
      {
        id: "turn-running",
        state: "RUNNING",
        contextJson: { caseRevision: 3, baselineCaseRevision: 2 },
        createdAt: new Date("2026-11-14T10:05:00Z"),
      },
      {
        id: "turn-1",
        state: "COMPLETED",
        contextJson: { progressMade: false },
        createdAt: new Date("2026-11-14T10:00:00Z"),
      },
    ];

    const tx = {
      assessmentRuntimeTurn: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue(turns),
      },
      assessmentEvent: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      },
    };

    const count = await calculateConsecutiveTurnsWithoutProgress(
      tx as any,
      "assessment-1",
    );
    expect(count).toBe(0);
  });

  it("resets counter to 0 when active RUNNING turn has accepted domain events", async () => {
    const turns = [
      {
        id: "turn-running",
        state: "RUNNING",
        contextJson: { caseRevision: 2, baselineCaseRevision: 2 },
        createdAt: new Date("2026-11-14T10:05:00Z"),
      },
      {
        id: "turn-1",
        state: "COMPLETED",
        contextJson: { progressMade: false },
        createdAt: new Date("2026-11-14T10:00:00Z"),
      },
    ];

    const tx = {
      assessmentRuntimeTurn: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue(turns),
      },
      assessmentEvent: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(1),
      },
    };

    const count = await calculateConsecutiveTurnsWithoutProgress(
      tx as any,
      "assessment-1",
    );
    expect(count).toBe(0);
  });

  it("increments counter when active RUNNING turn makes no progress and previous turns had no progress", async () => {
    const turns = [
      {
        id: "turn-running",
        state: "RUNNING",
        contextJson: { caseRevision: 2, baselineCaseRevision: 2 },
        createdAt: new Date("2026-11-14T10:05:00Z"),
      },
      {
        id: "turn-1",
        state: "COMPLETED",
        contextJson: { progressMade: false },
        createdAt: new Date("2026-11-14T10:00:00Z"),
      },
    ];

    const tx = {
      assessmentRuntimeTurn: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue(turns),
      },
      assessmentEvent: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      },
    };

    const count = await calculateConsecutiveTurnsWithoutProgress(
      tx as any,
      "assessment-1",
    );
    expect(count).toBe(2);
  });

  it("returns 0 when no turns are recorded", async () => {
    const tx = {
      assessmentRuntimeTurn: {
        findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
      },
      assessmentEvent: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      },
    };

    const count = await calculateConsecutiveTurnsWithoutProgress(
      tx as any,
      "assessment-1",
    );
    expect(count).toBe(0);
  });
});
