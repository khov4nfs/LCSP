import { Injectable } from "@nestjs/common";
import {
  AUDIT_DECISIONS,
  BILLING_RECONCILIATION_RESULTS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";

@Injectable()
export class BillingAdminReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriterService,
  ) {}
  async reject(input: {
    paymentId: string;
    expectedStatus: string;
    rationale: string;
    actorId: string;
    correlationId: string;
  }) {
    if (!input.rationale.trim()) throw new Error("RATIONALE_REQUIRED");
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findUnique({
        where: { id: input.paymentId },
      });
      if (
        !payment ||
        payment.reconciliationStatus !== input.expectedStatus ||
        payment.reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.MATCHED
      )
        throw new Error("RECONCILIATION_VERSION_CONFLICT");
      const updated = await tx.paymentTransaction.updateMany({
        where: {
          id: input.paymentId,
          reconciliationStatus: input.expectedStatus as never,
        },
        data: {
          reconciliationStatus: BILLING_RECONCILIATION_RESULTS.rejected,
          reconciledAt: new Date(),
        },
      });
      if (updated.count !== 1)
        throw new Error("RECONCILIATION_VERSION_CONFLICT");
      await this.audit.writeInTx(
        {
          eventType: "BILLING_MANUAL_RECONCILIATION_DECIDED",
          actorId: input.actorId,
          correlationId: input.correlationId,
          resourceId: payment.id,
          reasonCode: "MANUAL_RECONCILIATION",
          decision: AUDIT_DECISIONS.allow,
          result: BILLING_RECONCILIATION_RESULTS.rejected,
          payload: {
            rationale: input.rationale,
            paymentId: payment.id,
            provider: payment.provider,
            providerTransactionId: payment.providerTransactionId,
            userId: payment.userId,
            billingOrderId: payment.billingOrderId,
            beforeStatus: input.expectedStatus,
            afterStatus: BILLING_RECONCILIATION_RESULTS.rejected,
          },
        },
        tx,
      );
      return {
        id: payment.id,
        status: BILLING_RECONCILIATION_RESULTS.rejected,
      };
    });
  }
}
