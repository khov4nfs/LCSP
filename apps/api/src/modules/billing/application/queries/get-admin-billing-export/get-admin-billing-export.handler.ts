import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
} from "@lcsp/contracts/billing";
import type {
  BillingAdminExportQuery,
  BillingAdminExportReport,
} from "@lcsp/contracts/billing";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  BILLING_ADMIN_PAYMENT_RELATIONS,
  toBillingAdminPaymentRow,
} from "../get-admin-billing-dashboard/billing-admin-payment.mapper.js";
import { GetBillingAdminExportQuery } from "./get-admin-billing-export.query.js";

const BILLING_ADMIN_EXPORT_BATCH_SIZE = 500;

@QueryHandler(GetBillingAdminExportQuery)
export class GetBillingAdminExportHandler implements IQueryHandler<GetBillingAdminExportQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetBillingAdminExportQuery,
  ): Promise<BillingAdminExportReport> {
    const input: BillingAdminExportQuery = query.input;
    const now = query.now ?? new Date();
    const from = periodStart(now, input.period);
    const where: Prisma.PaymentTransactionWhereInput = {
      receivedAt: { gte: from, lte: now },
      ...(input.status !== BILLING_ADMIN_PAYMENT_FILTERS.all
        ? { reconciliationStatus: input.status }
        : {}),
      ...(input.gateway !== BILLING_ADMIN_GATEWAYS.all
        ? { provider: input.gateway }
        : {}),
    };

    return this.prisma.$transaction(
      async (transaction) => {
        const items: BillingAdminExportReport["items"] = [];
        let cursor: { receivedAt: Date; id: string } | undefined;

        while (true) {
          const pageWhere: Prisma.PaymentTransactionWhereInput = cursor
            ? {
                ...where,
                AND: [
                  {
                    OR: [
                      { receivedAt: { lt: cursor.receivedAt } },
                      {
                        receivedAt: cursor.receivedAt,
                        id: { lt: cursor.id },
                      },
                    ],
                  },
                ],
              }
            : where;
          const page = await transaction.paymentTransaction.findMany({
            where: pageWhere,
            include: BILLING_ADMIN_PAYMENT_RELATIONS,
            orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
            take: BILLING_ADMIN_EXPORT_BATCH_SIZE,
          });

          items.push(...page.map(toBillingAdminPaymentRow));
          if (page.length < BILLING_ADMIN_EXPORT_BATCH_SIZE) break;

          const last = page.at(-1);
          if (!last) break;
          cursor = { receivedAt: last.receivedAt, id: last.id };
        }

        return { period: input.period, items };
      },
      { isolationLevel: "RepeatableRead", timeout: 60_000 },
    );
  }
}

function periodStart(
  now: Date,
  period: BillingAdminExportQuery["period"],
): Date {
  if (period === BILLING_ADMIN_PERIODS.mtd) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const days =
    period === BILLING_ADMIN_PERIODS.d7
      ? 7
      : period === BILLING_ADMIN_PERIODS.d90
        ? 90
        : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
