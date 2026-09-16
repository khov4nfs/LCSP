import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ORDER_STATUSES,
  BILLING_RECONCILIATION_ACTIONS,
  PAYMENT_RECONCILIATION_REASONS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";

import { BillingAccountingService } from "./billing-accounting.service.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../domain/repositories/billing-transaction.port.js";

@Injectable()
export class BillingAdminReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly accounting: BillingAccountingService,
  ) {}

  async list(input: { status?: string; page?: number; take?: number }) {
    const page = Math.max(input.page ?? 1, 1);
    const take = Math.min(Math.max(input.take ?? 50, 1), 100);
    const where: Prisma.PaymentTransactionWhereInput = input.status
      ? { reconciliationStatus: input.status as never }
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

  async get(paymentId: string) {
    const row = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
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

  async resolve(input: {
    paymentId: string;
    billingOrderId: string;
    expectedVersion: number;
    rationale: string;
    actorId: string;
    correlationId: string;
  }) {
    this.assertRationale(input.rationale);
    const initial = await this.loadPayment(input.paymentId);
    if (!initial) throw new Error("PAYMENT_NOT_FOUND");

    return this.transactions.runForUser(
      initial.userId ?? `billing-payment:${input.paymentId}`,
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
        const eligibleOrderStatuses = [
          BILLING_ORDER_STATUSES.PENDING_PAYMENT,
          BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
          BILLING_ORDER_STATUSES.EXPIRED,
        ] as const;
        if (!eligibleOrderStatuses.includes(order.status as never))
          throw new Error("BILLING_ORDER_NOT_ELIGIBLE");
        if (payment.amountMinorUnits !== order.amountMinorUnits)
          throw new Error("BILLING_AMOUNT_MISMATCH");

        const from = order.status as (typeof eligibleOrderStatuses)[number];
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

  async reject(input: {
    paymentId: string;
    expectedStatus: string;
    expectedVersion: number;
    rationale: string;
    actorId: string;
    correlationId: string;
  }) {
    this.assertRationale(input.rationale);
    const initial = await this.loadPayment(input.paymentId);
    if (!initial) throw new Error("PAYMENT_NOT_FOUND");

    return this.transactions.runForUser(
      initial.userId ?? `billing-payment:${input.paymentId}`,
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

  private loadPayment(paymentId: string) {
    return this.transactions.runForUser(
      `billing-payment:${paymentId}`,
      ({ payment }) => payment.findById(paymentId),
    );
  }

  private assertRationale(rationale: string): void {
    if (!rationale.trim()) throw new Error("RATIONALE_REQUIRED");
  }
}
