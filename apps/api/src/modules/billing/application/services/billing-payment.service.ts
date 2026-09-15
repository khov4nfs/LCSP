import { Inject, Injectable } from "@nestjs/common";
import { BillingAccountingService } from "./billing-accounting.service.js";
import { BillingIdempotencyConflictError } from "../../domain/billing.errors.js";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import {
  BILLING_AUDIT_EVENT_TYPES,
  PREPAID_BILLING_CONFIG,
} from "@lcsp/contracts/billing";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
  type OrderRecord,
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
    /** Internal fixture compatibility only; customer HTTP never supplies this. */
    paymentCode?: string;
    idempotencyKey: string;
    amountMinorUnits: bigint;
    creditUnits: bigint;
    expiresAt?: Date;
    actorId?: string;
    sessionId?: string;
    correlationId?: string;
  }) {
    const requestFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          ...(i.paymentCode ? { paymentCode: i.paymentCode } : {}),
          amountMinorUnits: i.amountMinorUnits.toString(),
          creditUnits: i.creditUnits.toString(),
        }),
      )
      .digest("hex");
    return this.transactions.runForUser(i.userId, async ({ order, audit }) => {
      const old = await order.findByIdempotencyKey(i.userId, i.idempotencyKey);
      if (old) {
        if (old.requestFingerprint !== requestFingerprint)
          throw new BillingIdempotencyConflictError("Order replay differs");
        return old;
      }
      const paymentCode =
        i.paymentCode ?? (await this.generatePaymentCode(order));
      const { actorId, sessionId, correlationId, ...orderInput } = i;
      const created = await order.createPending({
        ...orderInput,
        paymentCode,
        requestFingerprint,
        expiresAt:
          i.expiresAt ??
          new Date(
            Date.now() +
              PREPAID_BILLING_CONFIG.orderExpiryHours * 60 * 60 * 1000,
          ),
      });
      if (correlationId) {
        await audit.append({
          eventType: BILLING_AUDIT_EVENT_TYPES.orderCreated,
          actorId: actorId ?? i.userId,
          sessionId,
          correlationId,
          resourceId: created.id,
          payload: {
            amountMinorUnits: created.amountMinorUnits.toString(),
            creditUnits: created.creditUnits.toString(),
            status: created.status,
          },
        });
      }
      return created;
    });
  }

  private async generatePaymentCode(order: {
    findByPaymentCode(paymentCode: string): Promise<OrderRecord | null>;
  }): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = randomBytes(8)
        .toString("base64url")
        .replaceAll("-", "A")
        .replaceAll("_", "B");
      const code = `${PREPAID_BILLING_CONFIG.paymentCodePrefix}${suffix}`;
      if (!(await order.findByPaymentCode(code))) return code;
    }
    throw new BillingIdempotencyConflictError(
      "Unable to allocate payment code",
    );
  }
  reconcilePayment(i: {
    provider: string;
    providerTransactionId: string;
    paymentCode: string;
    amountMinorUnits: bigint;
    sanitizedPayload?: unknown;
    actorId?: string | null;
    sessionId?: string;
    correlationId?: string;
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
        if (
          lockedOrder.status === "PENDING_PAYMENT" &&
          lockedOrder.expiresAt !== null &&
          lockedOrder.expiresAt <= new Date()
        ) {
          const expired = await repos.order.transition(
            lockedOrder.id,
            "PENDING_PAYMENT",
            "EXPIRED",
          );
          if (expired) {
            await repos.audit.append({
              eventType: BILLING_AUDIT_EVENT_TYPES.orderExpired,
              actorId: i.actorId ?? null,
              sessionId: i.sessionId,
              correlationId:
                i.correlationId ??
                `billing-reconcile:${i.providerTransactionId}`,
              resourceId: lockedOrder.id,
              payload: {
                previousStatus: "PENDING_PAYMENT",
                source: "AUTHORITATIVE_SETTLEMENT",
              },
            });
          }
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            userId: lockedOrder.userId,
            billingOrderId: lockedOrder.id,
            reconciliationStatus: "NEEDS_REVIEW",
            webhookEventId: webhook.id,
          });
        }
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
