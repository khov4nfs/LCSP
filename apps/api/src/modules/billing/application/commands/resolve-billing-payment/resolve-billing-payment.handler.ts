import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ORDER_STATUSES,
  BILLING_RECONCILIATION_ACTIONS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import { BillingAccountingKernel } from "../../shared/billing-accounting.kernel.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { ResolveBillingPaymentCommand } from "./resolve-billing-payment.command.js";

@CommandHandler(ResolveBillingPaymentCommand)
export class ResolveBillingPaymentHandler implements ICommandHandler<ResolveBillingPaymentCommand> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly accounting: BillingAccountingKernel,
  ) {}

  async execute(command: ResolveBillingPaymentCommand) {
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
        if (!payment) throw new Error("PAYMENT_NOT_FOUND");
        if (
          payment.reconciliationVersion !== input.expectedVersion ||
          payment.reconciliationStatus ===
            PAYMENT_RECONCILIATION_STATUSES.MATCHED ||
          payment.reconciliationStatus ===
            PAYMENT_RECONCILIATION_STATUSES.DUPLICATE
        )
          throw new Error("RECONCILIATION_VERSION_CONFLICT");
        const order = await repos.order.findById(input.billingOrderId);
        if (!order) throw new Error("BILLING_ORDER_NOT_FOUND");
        if (
          (payment.billingOrderId && payment.billingOrderId !== order.id) ||
          (payment.userId && payment.userId !== order.userId)
        )
          throw new Error("BILLING_RECONCILIATION_OWNERSHIP_CONFLICT");
        const eligible = [
          BILLING_ORDER_STATUSES.PENDING_PAYMENT,
          BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
          BILLING_ORDER_STATUSES.EXPIRED,
        ] as const;
        if (!eligible.includes(order.status as never))
          throw new Error("BILLING_ORDER_NOT_ELIGIBLE");
        if (payment.amountMinorUnits !== order.amountMinorUnits)
          throw new Error("BILLING_AMOUNT_MISMATCH");
        const from = order.status as (typeof eligible)[number];
        if (
          !(await repos.order.transition(
            order.id,
            from,
            BILLING_ORDER_STATUSES.CREDITED,
          ))
        )
          throw new Error("BILLING_ORDER_STATE_CONFLICT");
        const wallet = await repos.wallet.getOrCreateForUser(order.userId);
        await this.accounting.creditOrderInTransaction(repos, {
          userId: order.userId,
          walletId: wallet.id,
          orderId: order.id,
          creditUnits: order.creditUnits,
        });
        const settled = await repos.payment.setStatus(
          payment.id,
          PAYMENT_RECONCILIATION_STATUSES.MATCHED,
          order.userId,
          order.id,
          null,
          input.expectedVersion,
        );
        await repos.audit.append({
          eventType: BILLING_AUDIT_EVENT_TYPES.reconciliationSettled,
          actorId: input.actorId,
          correlationId: input.correlationId,
          resourceId: payment.id,
          payload: {
            action: BILLING_RECONCILIATION_ACTIONS.SETTLE,
            rationale: input.rationale,
            beforePaymentStatus: payment.reconciliationStatus,
            afterPaymentStatus: settled.reconciliationStatus,
            beforeOrderStatus: from,
            afterOrderStatus: BILLING_ORDER_STATUSES.CREDITED,
            providerTransactionId: payment.providerTransactionId,
            webhookEventId: payment.webhookEventId,
            billingOrderId: order.id,
            userId: order.userId,
          },
        });
        return { id: settled.id, status: settled.reconciliationStatus };
      },
    );
  }
}
