import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  BILLING_PROVIDER,
  BILLING_RECONCILIATION_EVENT_TYPES,
  BILLING_RECONCILIATION_RESULTS,
  OUTBOX_AGGREGATE_TYPES,
  buildOutboxMessageInput,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";

export class SePayWebhookIngressError extends Error {
  constructor(readonly reason: "SIGNATURE" | "TIMESTAMP" | "BODY" | "PAYLOAD") {
    super(`SePay webhook ${reason.toLowerCase()} rejected`);
  }
}

@Injectable()
export class SePayWebhookIngressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly config: ConfigService,
  ) {}

  async accept(input: {
    rawBody: Buffer;
    signature?: string;
    timestamp?: string;
    now?: Date;
  }): Promise<{ duplicate: boolean }> {
    const now = input.now ?? new Date();
    this.verifyTimestamp(input.timestamp, now);
    this.verifySignature(input.rawBody, input.timestamp, input.signature);

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(input.rawBody.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("object required");
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new SePayWebhookIngressError("BODY");
    }

    const normalized = normalizePayload(payload);
    const integrityHash = createHash("sha256")
      .update(input.rawBody)
      .digest("hex");
    const safePayload = {
      providerTransactionId: normalized.providerTransactionId,
      paymentCode: normalized.paymentCode,
      amountMinorUnits: normalized.amountMinorUnits.toString(),
      transferDirection: normalized.transferDirection,
      referenceCode: normalized.referenceCode,
      transactionDate: normalized.transactionDate,
      integrityHash,
    };

    return this.prisma.$transaction(async (tx) => {
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
        const created: unknown = await tx.sePayWebhookEvent.create({
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
      const message = buildOutboxMessageInput({
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
      });
      await this.outbox.enqueue(message, tx);
      return { duplicate: false };
    });
  }

  private verifyTimestamp(value: string | undefined, now: Date): void {
    const seconds = Number(value);
    const skew = this.config.get<number>("sepay.timestampSkewSeconds", 300);
    if (
      !Number.isSafeInteger(seconds) ||
      Math.abs(now.getTime() / 1000 - seconds) > skew
    )
      throw new SePayWebhookIngressError("TIMESTAMP");
  }

  private verifySignature(
    rawBody: Buffer,
    timestamp: string | undefined,
    supplied: string | undefined,
  ): void {
    const secret = this.config.get<string>("sepay.webhookSecret", "");
    if (!secret) throw new SePayWebhookIngressError("SIGNATURE");
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
      throw new SePayWebhookIngressError("SIGNATURE");
  }
}

function normalizePayload(payload: Record<string, unknown>) {
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
    throw new SePayWebhookIngressError("PAYLOAD");
  const direction = payload.transferType;
  return {
    providerTransactionId,
    paymentCode:
      typeof payload.code === "string" ? payload.code.trim() || null : null,
    amountMinorUnits: BigInt(String(amount)),
    transferDirection:
      direction === "in" ? "IN" : direction === "out" ? "OUT" : "UNKNOWN",
    referenceCode:
      typeof payload.referenceCode === "string" ? payload.referenceCode : null,
    transactionDate:
      typeof payload.transactionDate === "string"
        ? payload.transactionDate
        : null,
  } as const;
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function readEventId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    throw new Error("SEPAY_WEBHOOK_EVENT_CREATE_INVALID");
  }
  return value.id;
}
