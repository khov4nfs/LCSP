import { Inject, Injectable } from "@nestjs/common";
import { BillingAccountingKernel } from "./billing-accounting.kernel.js";
import { BillingIdempotencyConflictError } from "../../domain/billing.errors.js";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import {
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_RECONCILIATION_ACTIONS,
  BILLING_ORDER_STATUSES,
  PAYMENT_RECONCILIATION_REASONS,
  PAYMENT_RECONCILIATION_STATUSES,
  PREPAID_BILLING_CONFIG,
} from "@lcsp/contracts/billing";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
  type OrderRecord,
} from "../../domain/repositories/billing-transaction.port.js";

@Injectable()
export class BillingPaymentKernel {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly accounting: BillingAccountingKernel,
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
    transferDirection?: "IN" | "OUT" | "UNKNOWN";
    paymentCodes?: string[];
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
        if (i.transferDirection !== undefined && i.transferDirection !== "IN")
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
            reconciliationReason:
              PAYMENT_RECONCILIATION_REASONS.INBOUND_REQUIRED,
            webhookEventId: webhook.id,
          });
        const paymentCodes = [
          ...(i.paymentCodes ?? []),
          ...(i.paymentCode ? [i.paymentCode] : []),
        ].filter((code, index, values) => values.indexOf(code) === index);
        const candidates = await repos.order.findByPaymentCodes(paymentCodes);
        if (candidates.length === 0)
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
            reconciliationReason:
              PAYMENT_RECONCILIATION_REASONS.UNMATCHED_PAYMENT_CODE,
            webhookEventId: webhook.id,
          });
        if (candidates.length !== 1)
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
            reconciliationReason:
              PAYMENT_RECONCILIATION_REASONS.AMBIGUOUS_ORDER_MATCH,
            webhookEventId: webhook.id,
          });
        const order = candidates[0];
        await repos.lockUserAccount(order.userId);
        const lockedOrder = await repos.order.findByPaymentCode(
          order.paymentCode,
        );
        if (!lockedOrder)
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
            reconciliationReason:
              PAYMENT_RECONCILIATION_REASONS.UNMATCHED_PAYMENT_CODE,
            webhookEventId: webhook.id,
          });
        if (
          lockedOrder.status === BILLING_ORDER_STATUSES.PENDING_PAYMENT &&
          lockedOrder.expiresAt !== null &&
          lockedOrder.expiresAt <= new Date()
        ) {
          const expired = await repos.order.transition(
            lockedOrder.id,
            BILLING_ORDER_STATUSES.PENDING_PAYMENT,
            BILLING_ORDER_STATUSES.EXPIRED,
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
                previousStatus: BILLING_ORDER_STATUSES.PENDING_PAYMENT,
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
            reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
            reconciliationReason: PAYMENT_RECONCILIATION_REASONS.EXPIRED_ORDER,
            webhookEventId: webhook.id,
          });
        }
        if (lockedOrder.status !== BILLING_ORDER_STATUSES.PENDING_PAYMENT)
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            userId: lockedOrder.userId,
            billingOrderId: lockedOrder.id,
            reconciliationStatus:
              lockedOrder.status === BILLING_ORDER_STATUSES.CREDITED
                ? PAYMENT_RECONCILIATION_STATUSES.DUPLICATE
                : PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
            reconciliationReason:
              lockedOrder.status === BILLING_ORDER_STATUSES.CREDITED
                ? PAYMENT_RECONCILIATION_REASONS.DUPLICATE_PROVIDER_TRANSACTION
                : PAYMENT_RECONCILIATION_REASONS.RECOVERABLE_EXCEPTION,
            webhookEventId: webhook.id,
          });
        if (lockedOrder.amountMinorUnits !== i.amountMinorUnits) {
          await repos.order.transition(
            lockedOrder.id,
            BILLING_ORDER_STATUSES.PENDING_PAYMENT,
            BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
          );
          return repos.payment.create({
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            amountMinorUnits: i.amountMinorUnits,
            userId: lockedOrder.userId,
            billingOrderId: lockedOrder.id,
            reconciliationStatus:
              PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
            reconciliationReason:
              i.amountMinorUnits < lockedOrder.amountMinorUnits
                ? PAYMENT_RECONCILIATION_REASONS.UNDERPAYMENT
                : PAYMENT_RECONCILIATION_REASONS.OVERPAYMENT,
            webhookEventId: webhook.id,
          });
        }
        const claimed = await repos.order.transition(
          lockedOrder.id,
          BILLING_ORDER_STATUSES.PENDING_PAYMENT,
          BILLING_ORDER_STATUSES.CREDITED,
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
              current?.status === BILLING_ORDER_STATUSES.CREDITED
                ? PAYMENT_RECONCILIATION_STATUSES.DUPLICATE
                : PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
            reconciliationReason:
              current?.status === BILLING_ORDER_STATUSES.CREDITED
                ? PAYMENT_RECONCILIATION_REASONS.DUPLICATE_PROVIDER_TRANSACTION
                : PAYMENT_RECONCILIATION_REASONS.RECOVERABLE_EXCEPTION,
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
        const correlationId =
          i.correlationId ??
          `billing-reconcile:${i.provider}:${i.providerTransactionId}`;
        const reconciledAt = new Date();
        const payment = await repos.payment.create({
          provider: i.provider,
          providerTransactionId: i.providerTransactionId,
          amountMinorUnits: i.amountMinorUnits,
          userId: lockedOrder.userId,
          billingOrderId: lockedOrder.id,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
          reconciledAt,
          webhookEventId: webhook.id,
        });
        await repos.audit.append({
          eventType: BILLING_AUDIT_EVENT_TYPES.reconciliationSettled,
          actorId: i.actorId ?? null,
          sessionId: i.sessionId,
          correlationId,
          resourceId: payment.id,
          payload: {
            action: BILLING_RECONCILIATION_ACTIONS.SETTLE,
            beforePaymentStatus: null,
            afterPaymentStatus: payment.reconciliationStatus,
            beforeOrderStatus: BILLING_ORDER_STATUSES.PENDING_PAYMENT,
            afterOrderStatus: BILLING_ORDER_STATUSES.CREDITED,
            provider: i.provider,
            providerTransactionId: i.providerTransactionId,
            webhookEventId: webhook.id,
            billingOrderId: lockedOrder.id,
            userId: lockedOrder.userId,
            reconciledAt: reconciledAt.toISOString(),
          },
        });
        return payment;
      },
    );
  }

  /** Processes an accepted SePay work item. The caller is an asynchronous outbox consumer. */
  async reconcileAcceptedWebhook(eventId: string) {
    const event = await this.transactions.runForUser(
      `sepay-event:${eventId}`,
      async (repos) => {
        const row = await repos.webhook.findAcceptedById(eventId);
        if (!row || !row.securityAcceptedAt) return null;
        return row;
      },
    );
    if (!event) return null;
    const result = await this.reconcilePayment({
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      paymentCode: event.paymentCode ?? "",
      paymentCodes: event.paymentCodes,
      amountMinorUnits: event.amountMinorUnits,
      transferDirection: event.transferDirection,
      sanitizedPayload: event.sanitizedPayload,
    });
    await this.transactions.runForUser(
      `sepay-event:${eventId}`,
      async (repos) => {
        await repos.webhook.markProcessed(eventId, new Date());
      },
    );
    return result;
  }
}
