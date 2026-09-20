import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import {
  AUDIT_REDACTION_STATUSES,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
  BILLING_PROVIDER,
  BILLING_RECONCILIATION_ACTIONS,
  BILLING_RECONCILIATION_EVENT_TYPES,
  BILLING_RECONCILIATION_RESULTS,
  OUTBOX_AGGREGATE_TYPES,
  PAYMENT_RECONCILIATION_REASONS,
  PAYMENT_RECONCILIATION_STATUSES,
  buildOutboxMessageInput,
} from "@lcsp/contracts";
import type {
  BillingOrderStatus,
  BillingOrderView,
  PrepaidEstimate,
} from "@lcsp/contracts/billing";
import { PREPAID_BILLING_CONFIG } from "@lcsp/contracts/billing";
import { InvalidBillingInputError } from "../../domain/billing.errors.js";
import type {
  BillingTransactionPort,
  OrderRecord,
} from "../../domain/repositories/billing-transaction.port.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { BillingAccountingKernel } from "./billing-accounting.kernel.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingAdminRejectInput,
  BillingAdminResolveInput,
  SePayWebhookInput,
} from "../commands/billing-usage.types.js";
import type { AppConfig } from "../../../../config/config.types.js";

export function estimatePrepaid(amountVnd: bigint): PrepaidEstimate {
  const minimumAmountVnd = BigInt(PREPAID_BILLING_CONFIG.minimumAmountVnd);
  const maximumAmountVnd = BigInt(PREPAID_BILLING_CONFIG.maximumAmountVnd);
  const amountStepVnd = BigInt(PREPAID_BILLING_CONFIG.amountStepVnd);
  const creditUnitsPerVnd = BigInt(PREPAID_BILLING_CONFIG.creditUnitsPerVnd);
  if (
    amountVnd < minimumAmountVnd ||
    amountVnd > maximumAmountVnd ||
    amountVnd % amountStepVnd !== 0n
  )
    throw new InvalidBillingInputError("Invalid prepaid amount");
  return {
    currency: PREPAID_BILLING_CONFIG.currency,
    amountVnd: amountVnd.toString(),
    creditUnits: (amountVnd * creditUnitsPerVnd).toString(),
    expiresInHours: PREPAID_BILLING_CONFIG.orderExpiryHours,
  };
}

export function toOrderView(
  order: OrderRecord,
  config: ConfigService<AppConfig, true>,
): BillingOrderView {
  const amountVnd = order.amountMinorUnits.toString();
  const payment = config.getOrThrow<AppConfig["billing"]>("billing");
  return {
    id: order.id,
    amountVnd,
    creditUnits: order.creditUnits.toString(),
    paymentCode: order.paymentCode,
    status: toBillingOrderStatus(order.status),
    expiresAt: order.expiresAt?.toISOString() ?? null,
    creditedAt: order.creditedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    paymentInstructions: {
      provider: BILLING_PAYMENT_PROVIDERS.sepay,
      currency: "VND",
      paymentCode: order.paymentCode,
      amountVnd,
      bankName: payment.sePayBankName,
      bankAccountNumber: payment.sePayBankAccountNumber,
      accountHolder: payment.sePayAccountHolder,
      transferContent: order.paymentCode,
      qrCodeUrl: payment.sePayQrUrlTemplate
        .replaceAll("{amountVnd}", encodeURIComponent(amountVnd))
        .replaceAll("{paymentCode}", encodeURIComponent(order.paymentCode)),
    },
  };
}

function toBillingOrderStatus(status: string): BillingOrderStatus {
  if (
    Object.values(BILLING_ORDER_STATUSES).includes(status as BillingOrderStatus)
  ) {
    return status as BillingOrderStatus;
  }
  throw new Error("Unsupported persisted billing order status");
}

export async function expireOrder(
  transactions: BillingTransactionPort,
  userId: string,
  order: OrderRecord,
  audit: { correlationId: string; sessionId?: string },
): Promise<OrderRecord> {
  if (
    order.status !== BILLING_ORDER_STATUSES.PENDING_PAYMENT ||
    !order.expiresAt ||
    order.expiresAt > new Date()
  )
    return order;
  await transactions.runForUser(userId, async (r) => {
    const claimed = await r.order.transition(
      order.id,
      BILLING_ORDER_STATUSES.PENDING_PAYMENT,
      BILLING_ORDER_STATUSES.EXPIRED,
    );
    if (claimed) {
      await r.audit.append({
        eventType: BILLING_AUDIT_EVENT_TYPES.orderExpired,
        actorId: userId,
        sessionId: audit.sessionId,
        correlationId: audit.correlationId,
        resourceId: order.id,
        payload: { previousStatus: BILLING_ORDER_STATUSES.PENDING_PAYMENT },
      });
    }
  });
  return (
    (await transactions.runForUser(userId, (r) =>
      r.order.findForUser(userId, order.id),
    )) ?? order
  );
}

export async function listReconciliation(
  prisma: PrismaService,
  input: { status?: string; page?: number; take?: number },
) {
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
    prisma.paymentTransaction.findMany({
      where,
      include: { billingOrder: true, user: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
    }),
    prisma.paymentTransaction.count({ where }),
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

export async function getReconciliation(
  prisma: PrismaService,
  paymentId: string,
) {
  const row = await prisma.paymentTransaction.findUnique({
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

export async function resolvePayment(
  input: BillingAdminResolveInput,
  prisma: PrismaService,
  transactions: BillingTransactionPort,
  accounting: BillingAccountingKernel,
) {
  assertRationale(input.rationale);
  const initial = await transactions.runForUser(
    `billing-payment:${input.paymentId}`,
    ({ payment }) => payment.findById(input.paymentId),
  );
  if (!initial) throw new Error("PAYMENT_NOT_FOUND");
  return transactions.runForUser(
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
      await accounting.creditOrderInTransaction(repos, {
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

export async function rejectPayment(
  input: BillingAdminRejectInput,
  transactions: BillingTransactionPort,
) {
  assertRationale(input.rationale);
  const initial = await transactions.runForUser(
    `billing-payment:${input.paymentId}`,
    ({ payment }) => payment.findById(input.paymentId),
  );
  if (!initial) throw new Error("PAYMENT_NOT_FOUND");
  return transactions.runForUser(
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

export function assertRationale(rationale: string): void {
  if (!rationale.trim()) throw new Error("RATIONALE_REQUIRED");
}

export async function acceptSePayWebhook(
  input: SePayWebhookInput,
  prisma: PrismaService,
  outbox: OutboxRepository,
  config: ConfigService,
): Promise<{ duplicate: boolean }> {
  const now = input.now ?? new Date();
  verifyWebhookTimestamp(input.timestamp, now, config);
  verifyWebhookSignature(
    input.rawBody,
    input.timestamp,
    input.signature,
    config,
  );
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.rawBody.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    payload = parsed as Record<string, unknown>;
  } catch {
    throw new Error("SePay webhook body rejected");
  }
  const normalized = normalizeWebhookPayload(payload);
  const integrityHash = createHash("sha256")
    .update(input.rawBody)
    .digest("hex");
  const safePayload = {
    ...normalized,
    amountMinorUnits: normalized.amountMinorUnits.toString(),
    integrityHash,
  };
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sePayWebhookEvent.findUnique({
      where: {
        provider_providerTransactionId: {
          provider: BILLING_PROVIDER.sepay,
          providerTransactionId: normalized.providerTransactionId,
        },
      },
    });
    if (existing) return { duplicate: true };
    let eventId: string;
    try {
      const created = await tx.sePayWebhookEvent.create({
        data: {
          provider: BILLING_PROVIDER.sepay,
          providerTransactionId: normalized.providerTransactionId,
          sanitizedPayload: safePayload,
          integrityHash,
          securityAcceptedAt: now,
        },
      });
      eventId = readEventId(created);
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) throw error;
      return { duplicate: true };
    }
    await outbox.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.billingPayment,
        aggregateId: eventId,
        eventType: BILLING_RECONCILIATION_EVENT_TYPES.sepayWebhookAccepted,
        correlationId: `sepay:${normalized.providerTransactionId}`,
        causationId: eventId,
        actor: { type: "SYSTEM", id: "sepay" },
        result: BILLING_RECONCILIATION_RESULTS.accepted,
        redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
        idempotencyKey: `sepay-webhook:${normalized.providerTransactionId}`,
        payload: { ...safePayload, webhookEventId: eventId },
      }),
      tx,
    );
    return { duplicate: false };
  });
}

export function verifyWebhookTimestamp(
  value: string | undefined,
  now: Date,
  config: ConfigService,
): void {
  const seconds = Number(value);
  const skew = config.get<number>("sepay.timestampSkewSeconds", 300);
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(now.getTime() / 1000 - seconds) > skew
  )
    throw new Error("SePay webhook timestamp rejected");
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  timestamp: string | undefined,
  supplied: string | undefined,
  config: ConfigService,
): void {
  const secret = config.get<string>("sepay.webhookSecret", "");
  if (!secret) throw new Error("SePay webhook signature rejected");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const actual = (supplied ?? "")
    .replace(/^sha256=/i, "")
    .trim()
    .toLowerCase();
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new Error("SePay webhook signature rejected");
}

export function normalizeWebhookPayload(payload: Record<string, unknown>) {
  const id = payload.id;
  const amount = payload.transferAmount;
  const providerTransactionId =
    typeof id === "string" || typeof id === "number" ? String(id).trim() : "";
  if (
    !providerTransactionId ||
    providerTransactionId.length > 128 ||
    (typeof amount !== "string" && typeof amount !== "number") ||
    !/^\d+$/.test(String(amount))
  )
    throw new Error("SePay webhook payload rejected");
  const content = [payload.code, payload.referenceCode, payload.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const paymentCodes = [
    ...(typeof payload.code === "string" ? [payload.code.trim()] : []),
    ...[...content.matchAll(/\bLCSP[A-Za-z0-9]{4,}(?=$|[^A-Za-z0-9])/g)].map(
      (match) => match[0],
    ),
  ].filter(Boolean);
  return {
    providerTransactionId,
    paymentCode:
      typeof payload.code === "string" ? payload.code.trim() || null : null,
    paymentCodes: [...new Set(paymentCodes)],
    amountMinorUnits: BigInt(String(amount)),
    transferDirection:
      payload.transferType === "in"
        ? "IN"
        : payload.transferType === "out"
          ? "OUT"
          : "UNKNOWN",
    referenceCode:
      typeof payload.referenceCode === "string" ? payload.referenceCode : null,
    transactionDate:
      typeof payload.transactionDate === "string"
        ? payload.transactionDate
        : null,
  } as const;
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export function readEventId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id.length === 0
  )
    throw new Error("SEPAY_WEBHOOK_EVENT_CREATE_INVALID");
  return value.id;
}
