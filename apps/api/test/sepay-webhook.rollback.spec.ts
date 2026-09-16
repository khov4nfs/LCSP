import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { SePayWebhookIngressService } from "../src/modules/billing/application/services/sepay-webhook-ingress.service.js";
import type { OutboxMessageInput } from "@lcsp/contracts/outbox";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

const secret = "sepay-rollback-test-secret";

function signedInput(providerTransactionId: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from(
    JSON.stringify({
      id: providerTransactionId,
      transferAmount: "100000",
      transferType: "in",
      code: "LCSPROLLBACK",
    }),
  );
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex")}`;
  return {
    rawBody,
    signature,
    timestamp,
    now: new Date(Number(timestamp) * 1000),
  };
}

function config() {
  return {
    get: (key: string, fallback?: unknown) => {
      if (key === "sepay.webhookSecret") return secret;
      if (key === "sepay.timestampSkewSeconds") return 300;
      return fallback;
    },
  } as ConfigService;
}

describe("SePay webhook transaction rollback (integration)", () => {
  let prisma: PrismaClient;
  let prismaService: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    prismaService = new PrismaService();
    await prisma.$connect();
    await prismaService.$connect();
  });

  afterAll(async () => {
    await prismaService?.$disconnect();
    await prisma?.$disconnect();
  });

  it("rolls back both event and outbox intent when enqueue fails after insert", async () => {
    const providerTransactionId = `TX-OUTBOX-ROLLBACK-${randomUUID()}`;
    const outboxBefore = await prisma.outboxMessage.count();
    const realOutbox = new OutboxRepository(prismaService);
    const enqueue = jest.fn(
      async (input: OutboxMessageInput, tx?: Prisma.TransactionClient) => {
        await realOutbox.enqueue(input, tx);
        throw new Error("TEST_INJECTED_OUTBOX_FAILURE");
      },
    );
    const service = new SePayWebhookIngressService(
      prismaService,
      { enqueue } as unknown as OutboxRepository,
      config(),
    );

    await expect(
      service.accept(signedInput(providerTransactionId)),
    ).rejects.toThrow("TEST_INJECTED_OUTBOX_FAILURE");
    expect(enqueue).toHaveBeenCalled();
    expect(
      await prisma.sePayWebhookEvent.count({
        where: { providerTransactionId },
      }),
    ).toBe(0);
    expect(await prisma.outboxMessage.count()).toBe(outboxBefore);
  });

  it("creates no outbox intent when event persistence fails inside a real transaction", async () => {
    const providerTransactionId = `TX-PERSISTENCE-FAIL-${randomUUID()}`;
    const outboxBefore = await prisma.outboxMessage.count();
    const enqueue = jest.fn(() => Promise.resolve("never-written"));
    const failingPrisma = {
      $transaction: <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ) =>
        prismaService.$transaction((tx) => {
          const findWebhookEvent = tx.sePayWebhookEvent.findUnique.bind(
            tx.sePayWebhookEvent,
          ) as unknown as Prisma.TransactionClient["sePayWebhookEvent"]["findUnique"];
          const transactionClient = {
            sePayWebhookEvent: {
              findUnique: findWebhookEvent,
              create: () =>
                Promise.reject(new Error("TEST_INJECTED_PERSISTENCE_FAILURE")),
            },
          } as unknown as Prisma.TransactionClient;
          return callback(transactionClient);
        }),
    } as unknown as PrismaService;
    const service = new SePayWebhookIngressService(
      failingPrisma,
      { enqueue } as unknown as OutboxRepository,
      config(),
    );

    await expect(
      service.accept(signedInput(providerTransactionId)),
    ).rejects.toThrow("TEST_INJECTED_PERSISTENCE_FAILURE");
    expect(enqueue).not.toHaveBeenCalled();
    expect(
      await prisma.sePayWebhookEvent.count({
        where: { providerTransactionId },
      }),
    ).toBe(0);
    expect(await prisma.outboxMessage.count()).toBe(outboxBefore);
  });
});
