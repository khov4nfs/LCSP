import { jest } from "@jest/globals";
import { AUDIT_DECISIONS, type AuditDecision } from "@lcsp/contracts/audit";
import { ORGANIZATION_SCOPE_ERROR_CODES } from "@lcsp/contracts/auth";
import { BadRequestException } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { ListAuditEventsHandler } from "./list-audit-events.handler.js";
import { ListAuditEventsQuery } from "./list-audit-events.query.js";

const occurredAt = new Date("2026-07-10T08:30:00.000Z");

interface AuditRow {
  id: string;
  eventType: string;
  actorId: string | null;
  organizationId: string | null;
  decision: AuditDecision | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

function query(
  overrides: Partial<{
    organizationId: string;
    sessionOrganizationId: string;
    eventType: string;
    actorId: string;
    fromDate: string;
    toDate: string;
    page: number;
    pageSize: number;
  }> = {},
) {
  return new ListAuditEventsQuery(
    overrides.organizationId ?? "org-1",
    overrides.sessionOrganizationId ?? "org-1",
    overrides.eventType,
    overrides.actorId,
    overrides.fromDate,
    overrides.toDate,
    overrides.page,
    overrides.pageSize,
    "corr-1",
  );
}

function buildHandler() {
  const count = jest.fn<() => Promise<number>>().mockResolvedValue(1);
  const findMany = jest.fn<() => Promise<AuditRow[]>>().mockResolvedValue([
    {
      id: "event-1",
      eventType: "auth.sign_in",
      actorId: "user-1",
      organizationId: "org-1",
      decision: AUDIT_DECISIONS.allow,
      payload: {
        email: "dev@example.com",
        sessionToken: "must-not-leak",
        nested: { passwordHash: "must-not-leak", safe: true },
      },
      createdAt: occurredAt,
    },
  ]);
  const transaction = jest
    .fn()
    .mockImplementation(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
  const prisma = {
    authAuditEvent: { count, findMany },
    $transaction: transaction,
  } as unknown as PrismaService;

  return {
    handler: new ListAuditEventsHandler(prisma, new AuditRedactorService()),
    count,
    findMany,
    transaction,
  };
}

describe("ListAuditEventsHandler", () => {
  it("returns a paginated, ordered, pre-redacted audit event list", async () => {
    const { handler, findMany } = buildHandler();

    await expect(handler.execute(query())).resolves.toEqual({
      events: [
        {
          event_id: "event-1",
          event_type: "auth.sign_in",
          actor_id: "user-1",
          organization_id: "org-1",
          decision: AUDIT_DECISIONS.allow,
          payload: {
            email: "dev@example.com",
            nested: { safe: true },
          },
          occurred_at: occurredAt.toISOString(),
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
      correlationId: "corr-1",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("applies event, actor, inclusive date, and pagination filters", async () => {
    const { handler, count, findMany } = buildHandler();
    const from = "2026-07-01T00:00:00.000Z";
    const to = "2026-07-31T23:59:59.999Z";

    await handler.execute(
      query({
        eventType: "auth.sign_in",
        actorId: "user-1",
        fromDate: from,
        toDate: to,
        page: 2,
        pageSize: 10,
      }),
    );

    const where = {
      organizationId: "org-1",
      eventType: "auth.sign_in",
      actorId: "user-1",
      createdAt: { gte: new Date(from), lte: new Date(to) },
    };
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 10, take: 10 }),
    );
  });

  it("caps page_size at 100", async () => {
    const { handler, findMany } = buildHandler();

    const result = await handler.execute(query({ pageSize: 999 }));

    expect(result.page_size).toBe(100);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("rejects date ranges longer than 90 days", async () => {
    const { handler } = buildHandler();

    await expect(
      handler.execute(
        query({
          fromDate: "2026-01-01T00:00:00.000Z",
          toDate: "2026-04-02T00:00:00.001Z",
        }),
      ),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        problem: { code: "AUDIT_DATE_RANGE_EXCEEDED", correlationId: "corr-1" },
      },
    });
  });

  it("rejects cross-organization access before querying persistence", async () => {
    const { handler, transaction } = buildHandler();

    await expect(
      handler.execute(query({ sessionOrganizationId: "org-2" })),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          code: ORGANIZATION_SCOPE_ERROR_CODES.mismatch,
          correlationId: "corr-1",
        },
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    query({ page: Number.NaN }),
    query({ page: 0 }),
    query({ fromDate: "not-a-date" }),
  ])("rejects malformed query parameters", async (invalidQuery) => {
    const { handler } = buildHandler();

    await expect(handler.execute(invalidQuery)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
