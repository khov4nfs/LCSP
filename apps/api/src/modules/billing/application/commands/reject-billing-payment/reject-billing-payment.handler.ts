import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_RECONCILIATION_ACTIONS,
  PAYMENT_RECONCILIATION_REASONS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { RejectBillingPaymentCommand } from "./reject-billing-payment.command.js";

@CommandHandler(RejectBillingPaymentCommand)
export class RejectBillingPaymentHandler implements ICommandHandler<RejectBillingPaymentCommand> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
  ) {}

  async execute(command: RejectBillingPaymentCommand) {
    const input = command.input;
    if (!input.rationale.trim()) throw new Error("RATIONALE_REQUIRED");
    const initial = await this.transactions.runForUser(
      "billing-payment:" + input.paymentId,
      ({ payment }) => payment.findById(input.paymentId),
    );
    if (!initial) throw new Error("PAYMENT_NOT_FOUND");
    return this.transactions.runForUser(
      initial.userId ?? "billing-payment:" + input.paymentId,
      async (repos) => {
        const payment = await repos.payment.findById(input.paymentId);
        if (
          !payment ||
          payment.reconciliationStatus !== input.expectedStatus ||
          payment.reconciliationVersion !== input.expectedVersion ||
          payment.reconciliationStatus ===
            PAYMENT_RECONCILIATION_STATUSES.MATCHED ||
          payment.reconciliationStatus ===
            PAYMENT_RECONCILIATION_STATUSES.DUPLICATE
        )
          throw new Error("RECONCILIATION_VERSION_CONFLICT");
        const rejected = await repos.payment.setStatus(
          payment.id,
          PAYMENT_RECONCILIATION_STATUSES.REJECTED,
          payment.userId ?? undefined,
          payment.billingOrderId ?? undefined,
          PAYMENT_RECONCILIATION_REASONS.RECOVERABLE_EXCEPTION,
          input.expectedVersion,
        );
        await repos.audit.append({
          eventType: BILLING_AUDIT_EVENT_TYPES.reconciliationDecided,
          actorId: input.actorId,
          correlationId: input.correlationId,
          resourceId: payment.id,
          payload: {
            action: BILLING_RECONCILIATION_ACTIONS.REJECT,
            rationale: input.rationale,
            beforePaymentStatus: payment.reconciliationStatus,
            afterPaymentStatus: rejected.reconciliationStatus,
            providerTransactionId: payment.providerTransactionId,
            webhookEventId: payment.webhookEventId,
            billingOrderId: payment.billingOrderId,
            userId: payment.userId,
          },
        });
        return { id: rejected.id, status: rejected.reconciliationStatus };
      },
    );
  }
}
