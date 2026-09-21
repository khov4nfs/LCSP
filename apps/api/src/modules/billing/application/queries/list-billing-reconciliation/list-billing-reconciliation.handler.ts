import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";
import { PAYMENT_RECONCILIATION_STATUSES } from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { ListBillingReconciliationQuery } from "./list-billing-reconciliation.query.js";

@QueryHandler(ListBillingReconciliationQuery)
export class ListBillingReconciliationHandler implements IQueryHandler<ListBillingReconciliationQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListBillingReconciliationQuery) {
    const page = Math.max(query.page ?? 1, 1);
    const take = Math.min(Math.max(query.take ?? 50, 1), 100);
    const where: Prisma.PaymentTransactionWhereInput = query.status
      ? { reconciliationStatus: query.status as never }
      : {
          reconciliationStatus: {
            in: [
              PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
              PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
              PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
            ],
          },
        };
    const [rows, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        include: { billingOrder: true, user: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
      }),
      this.prisma.paymentTransaction.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        providerTransactionId: row.providerTransactionId,
        amountMinorUnits: row.amountMinorUnits.toString(),
        reconciliationStatus: row.reconciliationStatus,
        reconciliationReason: row.reconciliationReason,
        reconciliationVersion: row.reconciliationVersion,
        userId: row.userId,
        userEmail: row.user?.email ?? null,
        billingOrderId: row.billingOrderId,
        orderStatus: row.billingOrder?.status ?? null,
        orderAmountMinorUnits:
          row.billingOrder?.amountMinorUnits.toString() ?? null,
        receivedAt: row.receivedAt,
        reconciledAt: row.reconciledAt,
      })),
      page,
      take,
      total,
    };
  }
}
