import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetBillingReconciliationQuery } from "./get-billing-reconciliation.query.js";

@QueryHandler(GetBillingReconciliationQuery)
export class GetBillingReconciliationHandler implements IQueryHandler<GetBillingReconciliationQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetBillingReconciliationQuery) {
    const row = await this.prisma.paymentTransaction.findUnique({
      where: { id: query.paymentId },
      include: { billingOrder: true, user: true, webhookEvent: true },
    });
    if (!row) throw new Error("PAYMENT_NOT_FOUND");
    return {
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
      order: row.billingOrder
        ? {
            id: row.billingOrder.id,
            userId: row.billingOrder.userId,
            status: row.billingOrder.status,
            amountMinorUnits: row.billingOrder.amountMinorUnits.toString(),
            creditUnits: row.billingOrder.creditUnits.toString(),
            expiresAt: row.billingOrder.expiresAt,
            creditedAt: row.billingOrder.creditedAt,
          }
        : null,
      webhookEvent: row.webhookEvent
        ? {
            id: row.webhookEvent.id,
            securityAcceptedAt: row.webhookEvent.securityAcceptedAt,
            processedAt: row.webhookEvent.processedAt,
          }
        : null,
    };
  }
}
