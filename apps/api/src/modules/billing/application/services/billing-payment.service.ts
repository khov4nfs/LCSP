import { Inject, Injectable } from "@nestjs/common";
import { BillingAccountingService } from "./billing-accounting.service.js";
import { BillingIdempotencyConflictError } from "../../domain/billing.errors.js";
import { createHash } from "node:crypto";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../domain/repositories/billing-transaction.port.js";

@Injectable()
export class BillingPaymentService {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly accounting: BillingAccountingService,
  ) {}
  async createOrder(i: {
    userId: string;
    paymentCode: string;
    idempotencyKey: string;
    amountMinorUnits: bigint;
    creditUnits: bigint;
    requestFingerprint?: string;
  }) {
    const requestFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          paymentCode: i.paymentCode,
          amountMinorUnits: i.amountMinorUnits.toString(),
          creditUnits: i.creditUnits.toString(),
        }),
      )
      .digest("hex");
    return this.transactions.runForUser(i.userId, async ({ order }) => {
      const old = await order.findByIdempotencyKey(i.userId, i.idempotencyKey);
      if (old) {
        if (old.requestFingerprint !== requestFingerprint)
          throw new BillingIdempotencyConflictError("Order replay differs");
        return old;
      }
      return order.createPending({ ...i, requestFingerprint });
    });
  }
  reconcilePayment(i: {
    provider: string;
    providerTransactionId: string;
    paymentCode: string;
    amountMinorUnits: bigint;
    sanitizedPayload?: unknown;
  }) {
    return this.transactions.runForUser(
      `payment:${i.provider}:${i.providerTransactionId}`,
      async (repos) => {
        const webhook = await repos.webhook.recordReceived({
          provider: i.provider,
          providerTransactionId: i.providerTransactionId,
          sanitizedPayload: i.sanitizedPayload,
        });
        const prior = await repos.payment.findByProviderTransaction(
          i.provider,
          i.providerTransactionId,
        );
        if (prior) return prior;
        const order = await repos.order.findByPaymentCode(i.paymentCode);
        if (!order)
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            reconciliationStatus: "UNMATCHED",
            webhookEventId: webhook.id,
          });
        await repos.lockUserAccount(order.userId);
        const lockedOrder = await repos.order.findByPaymentCode(i.paymentCode);
        if (!lockedOrder)
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            reconciliationStatus: "UNMATCHED",
            webhookEventId: webhook.id,
          });
        if (lockedOrder.status !== "PENDING_PAYMENT")
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            userId: lockedOrder.userId,
            billingOrderId: lockedOrder.id,
            reconciliationStatus:
              lockedOrder.status === "CREDITED" ? "DUPLICATE" : "NEEDS_REVIEW",
            webhookEventId: webhook.id,
          });
        if (lockedOrder.amountMinorUnits !== i.amountMinorUnits) {
          await repos.order.transition(
            lockedOrder.id,
            "PENDING_PAYMENT",
            "PENDING_RECONCILIATION",
          );
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            userId: lockedOrder.userId,
            billingOrderId: lockedOrder.id,
            reconciliationStatus: "AMOUNT_MISMATCH",
            webhookEventId: webhook.id,
          });
        }
        const claimed = await repos.order.transition(
          lockedOrder.id,
          "PENDING_PAYMENT",
          "CREDITED",
        );
        if (!claimed) {
          const current = await repos.order.findByPaymentCode(i.paymentCode);
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            userId: current?.userId ?? lockedOrder.userId,
            billingOrderId: current?.id ?? lockedOrder.id,
            reconciliationStatus:
              current?.status === "CREDITED" ? "DUPLICATE" : "NEEDS_REVIEW",
            webhookEventId: webhook.id,
          });
        }
        const wallet = await repos.wallet.getOrCreateForUser(
          lockedOrder.userId,
        );
        await this.accounting.creditOrderInTransaction(repos, {
          userId: lockedOrder.userId,
          walletId: wallet.id,
          orderId: lockedOrder.id,
          creditUnits: lockedOrder.creditUnits,
        });
        return repos.payment.create({
          provider: i.provider,
          providerTransactionId: i.providerTransactionId,
          amountMinorUnits: i.amountMinorUnits,
          userId: lockedOrder.userId,
          billingOrderId: lockedOrder.id,
          reconciliationStatus: "MATCHED",
          webhookEventId: webhook.id,
        });
      },
    );
  }
}
