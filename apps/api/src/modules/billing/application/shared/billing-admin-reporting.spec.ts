import { describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  getRevenueSummary,
  listAdminTransactions,
} from "./billing-admin-reporting.js";

type PrismaStub = {
  paymentTransaction: {
    aggregate: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
  };
  creditLedgerEntry: { aggregate: jest.Mock };
  billingWallet: { aggregate: jest.Mock };
};

function prismaStub(): PrismaStub {
  const resolved = (value: unknown): jest.Mock => {
    const fn = jest.fn<() => Promise<unknown>>();
    fn.mockImplementation(() => Promise.resolve(value));
    return fn;
  };
  return {
    paymentTransaction: {
      aggregate: resolved({
        _sum: { amountMinorUnits: 800n },
        _count: { _all: 2 },
      }),
      count: resolved(1),
      findMany: resolved([
        {
          id: "payment-1",
          provider: "SEPAY",
          providerTransactionId: "provider-1",
          amountMinorUnits: 500n,
          reconciliationStatus: "MATCHED",
          reconciliationReason: null,
          user: { id: "user-1", email: "user@example.com" },
          billingOrder: {
            id: "order-1",
            paymentCode: "LCSP-1",
            status: "CREDITED",
            amountMinorUnits: 500n,
            creditUnits: 500n,
          },
          receivedAt: new Date("2026-01-01T00:00:00.000Z"),
          reconciledAt: new Date("2026-01-01T00:01:00.000Z"),
        },
      ]),
    },
    creditLedgerEntry: {
      aggregate: resolved({
        _sum: { deltaCredits: -130n },
        _count: { _all: 2 },
      }),
    },
    billingWallet: {
      aggregate: resolved({
        _sum: { availableCredits: 700n, reservedCredits: 50n },
      }),
    },
  };
}

describe("billing admin reporting", () => {
  it("uses settled payments, both settled debit sources, and wallet projections", async () => {
    const prisma = prismaStub();
    const result = await getRevenueSummary(prisma as unknown as PrismaService, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });

    expect(result.settledTopUps).toEqual({
      amountMinorUnits: "800",
      count: 2,
    });
    expect(result.usageRevenue).toEqual({
      amountMinorUnits: "130",
      count: 2,
    });
    expect(result.outstandingCredits.credits).toBe("750");

    const paymentCall = prisma.paymentTransaction.aggregate.mock
      .calls[0]?.[0] as { where: unknown };
    const paymentWhere = paymentCall.where;
    expect(paymentWhere).toMatchObject({
      reconciliationStatus: "MATCHED",
      reconciledAt: {
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    const ledgerCall = prisma.creditLedgerEntry.aggregate.mock
      .calls[0]?.[0] as { where: unknown };
    expect(ledgerCall.where).toMatchObject({
      source: { in: ["LLM_USAGE_DEBIT", "RESERVATION_SETTLEMENT"] },
      deltaCredits: { lt: 0n },
    });
  });

  it("filters transactions server-side and projects only safe fields", async () => {
    const prisma = prismaStub();
    const result = await listAdminTransactions(
      prisma as unknown as PrismaService,
      {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-02T00:00:00.000Z",
        status: "MATCHED",
        provider: "SEPAY",
        userId: "user-1",
        email: "user@example.com",
        paymentCode: "LCSP-1",
        orderId: "order-1",
        cursor: Buffer.from(
          JSON.stringify({
            receivedAt: "2026-01-01T00:01:00.000Z",
            id: "payment-2",
          }),
          "utf8",
        ).toString("base64url"),
        pageSize: 10,
      },
    );

    expect(result.items[0]).toEqual({
      paymentId: "payment-1",
      provider: "SEPAY",
      providerTransactionId: "provider-1",
      amountMinorUnits: "500",
      reconciliationStatus: "MATCHED",
      reconciliationReason: null,
      user: { id: "user-1", email: "user@example.com" },
      order: {
        id: "order-1",
        paymentCode: "LCSP-1",
        status: "CREDITED",
        amountMinorUnits: "500",
        creditUnits: "500",
      },
      receivedAt: "2026-01-01T00:00:00.000Z",
      reconciledAt: "2026-01-01T00:01:00.000Z",
    });
    const findManyCall = prisma.paymentTransaction.findMany.mock
      .calls[0]?.[0] as {
      take: number;
      orderBy: unknown;
      select: unknown;
    };
    expect(findManyCall).toMatchObject({
      take: 11,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    });
    expect(findManyCall.select).not.toHaveProperty("webhookEvent");
  });

  it("rejects invalid status and overlong reporting periods", async () => {
    const prisma = prismaStub();
    await expect(
      listAdminTransactions(prisma as unknown as PrismaService, {
        status: "PENDING",
      }),
    ).rejects.toThrow("BILLING_REPORTING_INVALID_INPUT");
    await expect(
      getRevenueSummary(prisma as unknown as PrismaService, {
        from: "2024-01-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("BILLING_REPORTING_INVALID_INPUT");
  });

  it("requires timezone-explicit reporting instants", async () => {
    const prisma = prismaStub();
    await expect(
      getRevenueSummary(prisma as unknown as PrismaService, {
        from: "2026-01-01T00:00:00",
        to: "2026-01-02T00:00:00",
      }),
    ).rejects.toThrow("BILLING_REPORTING_INVALID_INPUT");

    const utc = await getRevenueSummary(prisma as unknown as PrismaService, {
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-02T00:00:00Z",
    });
    const offset = await getRevenueSummary(prisma as unknown as PrismaService, {
      from: "2026-01-01T07:00:00+07:00",
      to: "2026-01-02T07:00:00+07:00",
    });
    expect(offset.period).toEqual(utc.period);
  });
});
