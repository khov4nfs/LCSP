import { describe, expect, it } from "@jest/globals";
import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetBillingAdminExportHandler } from "./get-admin-billing-export.handler.js";
import { GetBillingAdminExportQuery } from "./get-admin-billing-export.query.js";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const RECEIVED_AT = new Date("2026-09-21T10:00:00.000Z");

function payment(id: string) {
  return {
    id,
    provider: BILLING_ADMIN_GATEWAYS.sepay,
    providerTransactionId: `provider-${id}`,
    amountMinorUnits: 1000n,
    reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
    reconciliationReason: null,
    receivedAt: RECEIVED_AT,
    reconciledAt: null,
    user: { id: "user-1", email: "admin-test@example.com", displayName: null },
    billingOrder: null,
  };
}

describe("GetBillingAdminExportHandler", () => {
  it("keeps cursor pages stable when a same-timestamp payment arrives mid-export", async () => {
    const snapshot = Array.from({ length: 501 }, (_, index) =>
      payment(`payment-${String(index).padStart(3, "0")}`),
    );
    const expectedIds = snapshot
      .map((row) => row.id)
      .sort((left, right) => right.localeCompare(left));
    const liveRows = [...snapshot];
    let findManyCalls = 0;
    const findManyArgs: Array<Record<string, unknown>> = [];

    const transaction = {
      paymentTransaction: {
        findMany: (args: Record<string, unknown>) => {
          findManyCalls += 1;
          findManyArgs.push(args);
          if (findManyCalls === 2) {
            liveRows.push(payment("payment-000x"));
          }

          const where = args.where as {
            AND?: Array<{
              OR: [
                { receivedAt: { lt: Date } },
                { receivedAt: Date; id: { lt: string } },
              ];
            }>;
          };
          const cursor = where.AND?.[0]?.OR;
          const filtered = snapshot.filter((row) => {
            if (!cursor) return true;
            return (
              row.receivedAt < cursor[0].receivedAt.lt ||
              (row.receivedAt.getTime() === cursor[1].receivedAt.getTime() &&
                row.id < cursor[1].id.lt)
            );
          });
          filtered.sort((left, right) => right.id.localeCompare(left.id));
          return filtered.slice(0, args.take as number);
        },
      },
    };
    let transactionOptions: unknown;
    const prisma = {
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
        options: unknown,
      ) => {
        transactionOptions = options;
        return callback(transaction);
      },
    } as unknown as PrismaService;
    const handler = new GetBillingAdminExportHandler(prisma);

    const report = await handler.execute(
      new GetBillingAdminExportQuery(
        {
          period: BILLING_ADMIN_PERIODS.mtd,
          status: BILLING_ADMIN_PAYMENT_FILTERS.all,
          gateway: BILLING_ADMIN_GATEWAYS.all,
        },
        NOW,
      ),
    );

    expect(liveRows).toHaveLength(502);
    expect(report.items.map((row) => row.id)).toEqual(expectedIds);
    expect(new Set(report.items.map((row) => row.id)).size).toBe(501);
    expect(report.items).not.toContainEqual(
      expect.objectContaining({ id: "payment-000x" }),
    );
    expect(transactionOptions).toEqual({
      isolationLevel: "RepeatableRead",
      timeout: 60_000,
    });
    expect(findManyCalls).toBe(2);
    expect(findManyArgs[0]).toMatchObject({
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: 500,
    });
    expect(findManyArgs[1]?.where).toMatchObject({
      AND: [
        {
          OR: [
            { receivedAt: { lt: RECEIVED_AT } },
            { receivedAt: RECEIVED_AT, id: { lt: "payment-001" } },
          ],
        },
      ],
    });
  });
});
