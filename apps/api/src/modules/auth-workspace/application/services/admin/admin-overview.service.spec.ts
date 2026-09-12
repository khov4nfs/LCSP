import { describe, expect, it, jest } from "@jest/globals";
import {
  ADMIN_OVERVIEW_ACTION_KEYS,
  ADMIN_OVERVIEW_PERIODS,
  AUTH_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AdminOverviewService } from "./admin-overview.service.js";

describe("AdminOverviewService", () => {
  const fixedNow = new Date("2026-09-11T12:00:00.000Z");

  const mockPrisma = {
    user: {
      count: jest.fn<() => Promise<number>>(),
      findMany:
        jest.fn<
          () => Promise<
            Array<{ id: string; email: string; displayName: string | null }>
          >
        >(),
    },
    accountInvitation: {
      count: jest.fn<() => Promise<number>>(),
    },
    assessment: {
      count: jest.fn<() => Promise<number>>(),
      findMany:
        jest.fn<
          () => Promise<
            Array<{ createdAt: Date; status: string; updatedAt: Date }>
          >
        >(),
    },
    legalCorpusVersion: {
      findFirst: jest.fn<() => Promise<any>>(),
    },
    auditEvent: {
      findMany: jest.fn<() => Promise<Array<any>>>(),
    },
  };

  const service = new AdminOverviewService(
    mockPrisma as unknown as PrismaService,
  );

  it("calculates authoritative user metrics for 30D period, canonical corpus semantics, and audit-safe admin events", async () => {
    mockPrisma.user.count
      .mockResolvedValueOnce(842) // active users
      .mockResolvedValueOnce(34) // suspended users
      .mockResolvedValueOnce(38); // period new users (User records only)

    mockPrisma.accountInvitation.count.mockResolvedValueOnce(64); // pending invitations

    mockPrisma.assessment.count
      .mockResolvedValueOnce(2417) // total assessments
      .mockResolvedValueOnce(312); // period completed assessments

    mockPrisma.legalCorpusVersion.findFirst
      .mockResolvedValueOnce({
        version: "v2026.08.31",
        status: "APPROVED",
        approvedAt: new Date("2026-08-31T00:00:00.000Z"),
        _count: { documents: 184 },
      })
      .mockResolvedValueOnce({
        version: "v2026.09.02-draft",
        status: "DRAFT",
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
        _count: { documents: 188 },
      });

    mockPrisma.assessment.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
        status: "READY_FOR_REVIEW",
        updatedAt: new Date("2026-09-02T10:00:00.000Z"),
      },
    ]);

    mockPrisma.auditEvent.findMany.mockResolvedValueOnce([
      {
        id: "evt-1",
        eventType: AUTH_AUDIT_EVENT_TYPES.authAdminUserSuspended,
        actorId: "admin-1",
        createdAt: new Date("2026-09-11T10:24:00.000Z"),
        payload: {
          targetUserId: "usr-2",
          email: "linh@example.com",
          passwordHash: "SECRET_HASH_DO_NOT_EXPOSE",
        },
      },
    ]);

    mockPrisma.user.findMany.mockResolvedValueOnce([
      {
        id: "admin-1",
        email: "admin@example.com",
        displayName: "Admin User",
      },
    ]);

    const result = await service.getOverview("30D", fixedNow);

    expect(result.period).toBe(ADMIN_OVERVIEW_PERIODS.p30d);
    expect(result.periodDays).toBe(30);

    // Total users is strictly User records (842 active + 34 suspended = 876 total users)
    expect(result.summary.totalUsers.count).toBe(876);
    expect(result.summary.totalUsers.periodChange).toBe(38);
    expect(result.summary.activeUsers.count).toBe(842);
    expect(result.summary.activeUsers.percentageOfTotal).toBeCloseTo(96.1, 1);
    expect(result.summary.assessments.totalCount).toBe(2417);
    expect(result.summary.assessments.periodCompletedCount).toBe(312);

    // Canonical corpus summary preserves ruleCount as null
    expect(result.summary.currentCorpus.version).toBe("v2026.08.31");
    expect(result.summary.currentCorpus.sourceCount).toBe(184);
    expect(result.summary.currentCorpus.ruleCount).toBeNull();

    // Corpus status details
    expect(result.corpusStatus.current?.version).toBe("v2026.08.31");
    expect(result.corpusStatus.current?.ruleCount).toBeNull();
    expect(result.corpusStatus.draft?.version).toBe("v2026.09.02-draft");
    expect(result.corpusStatus.draft?.ruleCount).toBeNull();

    // Account distribution retains separate invited count
    expect(result.accountDistribution.activeCount).toBe(842);
    expect(result.accountDistribution.invitedCount).toBe(64);
    expect(result.accountDistribution.suspendedCount).toBe(34);
    expect(result.accountDistribution.totalCount).toBe(940);

    // Recent activity audit sanitization with actionKey and ISO timestamp
    expect(result.recentActivity).toHaveLength(1);
    expect(result.recentActivity[0].adminEmail).toBe("admin@example.com");
    expect(result.recentActivity[0].actionKey).toBe(
      ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount,
    );
    expect(result.recentActivity[0].target).toBe("linh@example.com");
    expect(result.recentActivity[0].occurredAt).toBe(
      "2026-09-11T10:24:00.000Z",
    );
    expect(
      (result.recentActivity[0] as unknown as Record<string, unknown>)
        .passwordHash,
    ).toBeUndefined();
  });

  it("handles assessments created before window but completed inside window without dropping them from completion activity", async () => {
    mockPrisma.user.count.mockResolvedValue(10);
    mockPrisma.accountInvitation.count.mockResolvedValue(2);
    mockPrisma.assessment.count.mockResolvedValue(5);
    mockPrisma.legalCorpusVersion.findFirst.mockResolvedValue(null);
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);

    const createdBeforeWindow = new Date("2026-07-01T00:00:00.000Z");
    const completedInsideWindow = new Date("2026-09-05T14:00:00.000Z");

    mockPrisma.assessment.findMany.mockResolvedValueOnce([
      {
        createdAt: createdBeforeWindow,
        status: "READY_FOR_REVIEW",
        updatedAt: completedInsideWindow,
      },
    ]);

    const result = await service.getOverview("30D", fixedNow);

    // Assessment was completed in the window, so totalCompleted should count it even though created before window
    expect(result.assessmentActivity.totalCompleted).toBe(1);
    expect(result.assessmentActivity.totalStarted).toBe(0);
  });

  it("handles 7D and 90D periods and empty state safely", async () => {
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.accountInvitation.count.mockResolvedValue(0);
    mockPrisma.assessment.count.mockResolvedValue(0);
    mockPrisma.legalCorpusVersion.findFirst.mockResolvedValue(null);
    mockPrisma.assessment.findMany.mockResolvedValue([]);
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);

    const result7d = await service.getOverview("7D", fixedNow);
    expect(result7d.period).toBe(ADMIN_OVERVIEW_PERIODS.p7d);
    expect(result7d.periodDays).toBe(7);
    expect(result7d.summary.totalUsers.count).toBe(0);
    expect(result7d.summary.activeUsers.percentageOfTotal).toBe(0);
    expect(result7d.corpusStatus.current).toBeNull();
    expect(result7d.recentActivity).toHaveLength(0);

    const result90d = await service.getOverview("90D", fixedNow);
    expect(result90d.period).toBe(ADMIN_OVERVIEW_PERIODS.p90d);
    expect(result90d.periodDays).toBe(90);
  });
});
