import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
  BILLING_ORDER_STATUSES,
  LLM_USAGE_STATUSES,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import type {
  BillingAdminDashboard,
  BillingAdminPeriod,
} from "@lcsp/contracts/billing";
import type { BillingAdminDashboardQuery } from "@lcsp/contracts/billing";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetBillingAdminDashboardQuery } from "./get-admin-billing-dashboard.query.js";
import {
  BILLING_ADMIN_PAYMENT_RELATIONS,
  toBillingAdminPaymentRow,
} from "./billing-admin-payment.mapper.js";

const OPEN_RECONCILIATION_STATUSES = [
  PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
  PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
  PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
] as const;

@QueryHandler(GetBillingAdminDashboardQuery)
export class GetBillingAdminDashboardHandler implements IQueryHandler<GetBillingAdminDashboardQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetBillingAdminDashboardQuery,
  ): Promise<BillingAdminDashboard> {
    const input: BillingAdminDashboardQuery = query.input;
    const now = query.now ?? new Date();
    const from = periodStart(now, input.period);
    const trendFrom = new Date(now);
    trendFrom.setUTCHours(0, 0, 0, 0);
    trendFrom.setUTCDate(trendFrom.getUTCDate() - 6);
    const paymentWhere: Prisma.PaymentTransactionWhereInput = {
      receivedAt: { gte: from, lte: now },
      ...(input.status !== BILLING_ADMIN_PAYMENT_FILTERS.all
        ? { reconciliationStatus: input.status }
        : {}),
      ...(input.gateway !== BILLING_ADMIN_GATEWAYS.all
        ? { provider: input.gateway }
        : {}),
    };

    const [
      topUps,
      usage,
      pendingReconciliationCount,
      duplicatePaymentCount,
      settledTopUpTrend,
      items,
      totalCount,
    ] = await Promise.all([
      this.prisma.billingOrder.aggregate({
        where: {
          status: BILLING_ORDER_STATUSES.CREDITED,
          creditedAt: { gte: from, lte: now },
        },
        _sum: { amountMinorUnits: true },
      }),
      this.prisma.llmUsageEvent.aggregate({
        where: {
          status: LLM_USAGE_STATUSES.SETTLED,
          occurredAt: { gte: from, lte: now },
        },
        _sum: { customerChargeVnd: true },
      }),
      this.prisma.paymentTransaction.count({
        where: {
          reconciliationStatus: { in: [...OPEN_RECONCILIATION_STATUSES] },
          receivedAt: { gte: from, lte: now },
        },
      }),
      this.prisma.paymentTransaction.count({
        where: {
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.DUPLICATE,
          receivedAt: { gte: from, lte: now },
        },
      }),
      this.getSettledTopUpTrend(trendFrom, now),
      this.prisma.paymentTransaction.findMany({
        where: paymentWhere,
        include: BILLING_ADMIN_PAYMENT_RELATIONS,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.paymentTransaction.count({ where: paymentWhere }),
    ]);

    return {
      period: input.period,
      summary: {
        settledTopUpVnd: (topUps._sum.amountMinorUnits ?? 0n).toString(),
        usageRevenueVnd: (usage._sum.customerChargeVnd ?? 0n).toString(),
        pendingReconciliationCount,
        duplicatePaymentCount,
        settledTopUpTrend,
      },
      items: items.map(toBillingAdminPaymentRow),
      page: input.page,
      pageSize: input.pageSize,
      totalCount,
    };
  }

  private async getSettledTopUpTrend(from: Date, through: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; amountMinorUnits: bigint }>
    >`
      SELECT date_trunc('day', "creditedAt" AT TIME ZONE 'UTC') AS "day",
        COALESCE(SUM("amountMinorUnits"), 0)::bigint AS "amountMinorUnits"
      FROM "BillingOrder"
      WHERE "status" = ${BILLING_ORDER_STATUSES.CREDITED}::"BillingOrderStatus"
        AND "creditedAt" >= ${from}
        AND "creditedAt" <= ${through}
      GROUP BY 1
      ORDER BY 1
    `;
    const byDay = new Map(
      rows.map((row) => [
        row.day.toISOString().slice(0, 10),
        row.amountMinorUnits,
      ]),
    );

    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(from);
      day.setUTCDate(day.getUTCDate() + index);
      const key = day.toISOString().slice(0, 10);
      return { day: key, amountVnd: (byDay.get(key) ?? 0n).toString() };
    });
  }
}

function periodStart(now: Date, period: BillingAdminPeriod): Date {
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
