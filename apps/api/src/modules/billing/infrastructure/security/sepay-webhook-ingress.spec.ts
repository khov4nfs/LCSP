import { createHmac } from "node:crypto";
import { jest } from "@jest/globals";

import {
  BILLING_PROVIDER,
  BILLING_RECONCILIATION_EVENT_TYPES,
  SEPAY_HMAC_FIXTURE,
} from "@lcsp/contracts/billing";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  SePayWebhookIngressError,
  SePayWebhookIngressService,
} from "./sepay-webhook-ingress.js";

const secret = "sepay-test-webhook-secret";
const now = new Date("2026-09-16T00:00:00.000Z");

function signedInput(
  body: string,
  overrides: { signature?: string; timestamp?: string } = {},
) {
  const rawBody = Buffer.from(body);
  return {
    rawBody,
    signature:
      overrides.signature ??
      `sha256=${createHmac("sha256", secret)
        .update(
          `${overrides.timestamp ?? String(Math.floor(now.getTime() / 1000))}.${rawBody.toString("utf8")}`,
        )
        .digest("hex")}`,
    timestamp: overrides.timestamp ?? String(Math.floor(now.getTime() / 1000)),
    now,
  };
}

function createSubject(
  overrides: {
    existing?: unknown;
    create?: () => Promise<unknown>;
    enqueue?: () => Promise<unknown>;
    webhookSecret?: string;
  } = {},
) {
  const findUnique = jest.fn(() => Promise.resolve(overrides.existing ?? null));
  const create = jest.fn(
    overrides.create ?? (() => Promise.resolve({ id: "event-1" })),
  );
  const tx = { sePayWebhookEvent: { findUnique, create } };
  const transaction = jest.fn(
    (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const enqueue = jest.fn(
    overrides.enqueue ?? (() => Promise.resolve("outbox-1")),
  );
  const config = {
    get: (key: string, fallback?: unknown) => {
      if (key === "sepay.webhookSecret")
        return overrides.webhookSecret ?? secret;
      if (key === "sepay.timestampSkewSeconds") return 300;
      return fallback;
    },
  };
  const service = new SePayWebhookIngressService(
    { $transaction: transaction } as unknown as PrismaService,
    { enqueue } as unknown as OutboxRepository,
    config as ConfigService,
  );
  return { service, findUnique, create, transaction, enqueue };
}

describe("SePayWebhookIngressService", () => {
  const payload =
    '{ "id":"TX-1", "transferAmount":"100000", "transferType":"in", "code":"LCSPABC" }';

  it("verifies the received bytes, persists safe fields, and queues a reconciliation intent", async () => {
    const { service, create, enqueue } = createSubject();

    await expect(service.accept(signedInput(payload))).resolves.toEqual({
      duplicate: false,
    });

    expect(create).toHaveBeenCalledWith({
      // Jest asymmetric matchers intentionally return `any`.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        provider: BILLING_PROVIDER.sepay,
        providerTransactionId: "TX-1",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        integrityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        securityAcceptedAt: now,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        sanitizedPayload: expect.objectContaining({
          providerTransactionId: "TX-1",
          amountMinorUnits: "100000",
          transferDirection: "IN",
        }),
      }),
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: BILLING_RECONCILIATION_EVENT_TYPES.sepayWebhookAccepted,
        aggregateId: "event-1",
        idempotencyKey: "sepay-webhook:TX-1",
      }),
      expect.any(Object),
    );
  });

  it("matches the governed SePay HMAC interoperability fixture", async () => {
    const { service, create } = createSubject({
      webhookSecret: SEPAY_HMAC_FIXTURE.secret,
    });
    const fixtureNow = new Date(Number(SEPAY_HMAC_FIXTURE.timestamp) * 1000);
    const result = await service.accept({
      rawBody: Buffer.from(SEPAY_HMAC_FIXTURE.rawBody, "utf8"),
      signature: SEPAY_HMAC_FIXTURE.signature,
      timestamp: SEPAY_HMAC_FIXTURE.timestamp,
      now: fixtureNow,
    });

    expect(result).toEqual({ duplicate: false });
    expect(create).toHaveBeenCalled();
  });

  it("rejects a signature made for re-stringified JSON rather than the received bytes", async () => {
    const { service, transaction } = createSubject();
    const reserialized = JSON.stringify(JSON.parse(payload));
    const signature = createHmac("sha256", secret)
      .update(reserialized)
      .digest("hex");

    await expect(
      service.accept(signedInput(payload, { signature })),
    ).rejects.toMatchObject({
      reason: "SIGNATURE",
    } satisfies Partial<SePayWebhookIngressError>);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures, stale timestamps, and malformed authenticated JSON before persistence", async () => {
    const { service, transaction } = createSubject();

    await expect(
      service.accept(signedInput(payload, { signature: "not-a-valid-hmac" })),
    ).rejects.toMatchObject({ reason: "SIGNATURE" });
    await expect(
      service.accept(signedInput(payload, { timestamp: "0" })),
    ).rejects.toMatchObject({ reason: "TIMESTAMP" });
    await expect(service.accept(signedInput("{"))).rejects.toMatchObject({
      reason: "BODY",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns duplicate success only after security checks and creates no second outbox intent", async () => {
    const { service, create, enqueue } = createSubject({
      existing: { id: "event-1" },
    });

    await expect(service.accept(signedInput(payload))).resolves.toEqual({
      duplicate: true,
    });

    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("treats only the webhook event unique race as a safe duplicate", async () => {
    const { service, enqueue } = createSubject({
      create: () =>
        Promise.reject(Object.assign(new Error("unique"), { code: "P2002" })),
    });

    await expect(service.accept(signedInput(payload))).resolves.toEqual({
      duplicate: true,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("propagates outbox failure so the enclosing transaction can roll back the event", async () => {
    const failure = new Error("outbox unavailable");
    const { service } = createSubject({
      enqueue: () => Promise.reject(failure),
    });

    await expect(service.accept(signedInput(payload))).rejects.toBe(failure);
  });
});
