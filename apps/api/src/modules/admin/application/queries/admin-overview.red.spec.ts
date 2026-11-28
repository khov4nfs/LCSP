import { describe, expect, it, jest } from "@jest/globals";
import { ADMIN_OVERVIEW_PERIODS } from "@lcsp/contracts/auth";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { GetAdminOverviewHandler } from "./get-admin-overview/get-admin-overview.handler.js";
import { GetAdminOverviewQuery } from "./get-admin-overview/get-admin-overview.query.js";

const now = new Date("2026-09-20T00:00:00.000Z");

function overviewPrisma() {
  const assessmentFindMany = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValue([]);
  const assessmentCount = jest
    .fn<(args?: unknown) => Promise<number>>()
    .mockResolvedValue(0);
  const activityQuery = jest
    .fn<
      () => Promise<
        Array<{ bucket: number; startedCount: bigint; completedCount: bigint }>
      >
    >()
    .mockResolvedValue([{ bucket: 0, startedCount: 0n, completedCount: 0n }]);
  return {
    assessmentFindMany,
    assessmentCount,
    activityQuery,
    prisma: {
      $queryRaw: activityQuery,
      user: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      },
      assessment: { count: assessmentCount, findMany: assessmentFindMany },
      legalSourceVersion: {
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      },
      auditEvent: {
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      },
    } as unknown as PrismaService,
  };
}

describe("Admin overview RED regressions", () => {
  it("A-01 aggregates activity without materializing every Assessment in the period", async () => {
    const { prisma, assessmentFindMany } = overviewPrisma();
    // Why: A valid 90-day dashboard read can otherwise load an unbounded system-wide row set.
    // How: Require the handler to consume bounded database aggregates rather than Assessment.findMany.
    // Invariant: Dashboard memory must not grow with the number of Assessment rows.
    await new GetAdminOverviewHandler(prisma).execute(
      new GetAdminOverviewQuery(ADMIN_OVERVIEW_PERIODS.p90d),
      now,
    );
    expect(assessmentFindMany).not.toHaveBeenCalled();
  });

  it("A-02 does not classify a later update as completion in the selected period", async () => {
    const { prisma, assessmentCount } = overviewPrisma();
    // Why: Assessment.updatedAt changes for reasons other than a COMPLETE transition.
    // How: Reject a completed-in-period count predicate based on updatedAt.
    // Invariant: Completion metrics must be keyed to a durable completion event or timestamp.
    assessmentCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const result = await new GetAdminOverviewHandler(prisma).execute(
      new GetAdminOverviewQuery(ADMIN_OVERVIEW_PERIODS.p7d),
      now,
    );
    expect(result.summary.assessments.periodCompletedCount).toBe(0);
    expect(assessmentCount).toHaveBeenCalledTimes(1);
  });
});
