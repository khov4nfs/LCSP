import { describe, expect, it, jest } from "@jest/globals";
import {
  ADMIN_OVERVIEW_PERIODS,
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { ListAdminUsersQuery } from "./list-admin-users/list-admin-users.query.js";
import { ListAdminUsersHandler } from "./list-admin-users/list-admin-users.handler.js";
import { GetAdminUserDetailQuery } from "./get-admin-user-detail/get-admin-user-detail.query.js";
import { GetAdminUserDetailHandler } from "./get-admin-user-detail/get-admin-user-detail.handler.js";
import { GetAdminOverviewQuery } from "./get-admin-overview/get-admin-overview.query.js";
import { GetAdminOverviewHandler } from "./get-admin-overview/get-admin-overview.handler.js";

describe("Admin CQRS Queries", () => {
  it("GetAdminUserDetailHandler queries user detail directly from prisma", async () => {
    const mockPrisma = {
      user: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({
          id: "u-1",
          displayName: "U One",
          email: "u1@example.com",
          role: AUTH_USER_ROLES.customer,
          accessStatus: "ACTIVE",
          accessVersion: 1,
          createdAt: new Date(),
        }),
      },
      assessment: {
        count: jest.fn<() => Promise<number>>().mockResolvedValueOnce(0),
        aggregate: jest
          .fn<() => Promise<{ _max: { createdAt: Date | null } }>>()
          .mockResolvedValueOnce({ _max: { createdAt: null } }),
      },
      authRecord: {
        aggregate: jest
          .fn<() => Promise<{ _max: { createdAt: Date | null } }>>()
          .mockResolvedValueOnce({ _max: { createdAt: null } }),
      },
    } as unknown as PrismaService;

    const handler = new GetAdminUserDetailHandler(mockPrisma);
    const query = new GetAdminUserDetailQuery("u-1", "corr-2");
    const result = await handler.execute(query);

    expect(result.id).toBe("u-1");
    expect(result.fullName).toBe("U One");
    expect(result.status).toBe(AUTH_ACCOUNT_STATUSES.active);
  });

  it("ListAdminUsersHandler executes $transaction", async () => {
    const txMock = {
      $queryRaw: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce([{ count: 1n }])
        .mockResolvedValueOnce([
          {
            id: "u-1",
            fullName: "User 1",
            email: "u1@example.com",
            role: "CUSTOMER",
            status: "ACTIVE",
            createdAt: new Date(),
            version: 1,
            referenceType: "USER",
          },
        ]),
      assessment: {
        groupBy: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce([]),
      },
      authRecord: {
        groupBy: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce([]),
      },
    };

    const txSpy = jest.fn().mockImplementationOnce(async (callback) => {
      return (callback as (tx: unknown) => Promise<unknown>)(txMock);
    });

    const handler = new ListAdminUsersHandler({
      $transaction: txSpy,
    } as unknown as PrismaService);

    const query = new ListAdminUsersQuery({ page: 1 }, "corr-1");
    const result = await handler.execute(query);

    expect(result.totalCount).toBe(1);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.id).toBe("u-1");
  });

  it("GetAdminOverviewHandler queries counts and returns AdminOverviewStats", async () => {
    const mockPrisma = {
      user: {
        count: jest
          .fn<() => Promise<number>>()
          .mockResolvedValueOnce(10) // active
          .mockResolvedValueOnce(2) // suspended
          .mockResolvedValueOnce(5), // period new
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce([]),
      },
      assessment: {
        count: jest
          .fn<() => Promise<number>>()
          .mockResolvedValueOnce(20) // total
          .mockResolvedValueOnce(8), // period completed
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce([]),
      },
      legalCorpusVersion: {
        findFirst: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValueOnce({
            version: "v1",
            approvedAt: new Date(),
            _count: { documents: 5 },
          })
          .mockResolvedValueOnce(null),
      },
      auditEvent: {
        findMany: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce([]),
      },
    } as unknown as PrismaService;

    const handler = new GetAdminOverviewHandler(mockPrisma);
    const query = new GetAdminOverviewQuery(ADMIN_OVERVIEW_PERIODS.p30d);
    const result = await handler.execute(
      query,
      new Date("2026-09-20T00:00:00.000Z"),
    );

    expect(result.period).toBe(ADMIN_OVERVIEW_PERIODS.p30d);
    expect(result.summary.totalUsers.count).toBe(12);
    expect(result.summary.activeUsers.count).toBe(10);
    expect(result.summary.assessments.totalCount).toBe(20);
    expect(result.summary.currentCorpus.version).toBe("v1");
  });
});
