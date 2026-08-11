import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

describe("OutboxRepository (e2e, real Postgres)", () => {
  let prisma: PrismaService;
  let repository: OutboxRepository;

  beforeAll(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaService();
    repository = new OutboxRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.outboxMessage.deleteMany();
  });

  function seed(
    overrides: Partial<
      Parameters<typeof prisma.outboxMessage.create>[0]["data"]
    > = {},
  ) {
    return prisma.outboxMessage.create({
      data: {
        id: randomUUID(),
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: randomUUID(),
        eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
        payload: { foo: "bar" },
        ...overrides,
      },
    });
  }

  it("T07: excludes dlq, published, and not-yet-due failed rows from the pending batch", async () => {
    const pending = await seed();
    await seed({ status: OUTBOX_STATUSES.dlq });
    await seed({ status: OUTBOX_STATUSES.published, publishedAt: new Date() });
    await seed({
      status: OUTBOX_STATUSES.failed,
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    const ids = await repository.withPendingBatch(10, (messages) =>
      Promise.resolve(messages.map((m) => m.id)),
    );

    expect(ids).toEqual([pending.id]);
  });

  it("retries a failed row once its scheduled retry time is due", async () => {
    const dueRetry = await seed({
      status: OUTBOX_STATUSES.failed,
      attempts: 1,
      lastAttemptAt: new Date(Date.now() - 2_000),
      nextAttemptAt: new Date(Date.now() - 1_000),
    });

    const ids = await repository.withPendingBatch(10, (messages) =>
      Promise.resolve(messages.map((message) => message.id)),
    );

    expect(ids).toEqual([dueRetry.id]);
  });

  it("orders pending rows by createdAt ascending", async () => {
    const older = await seed({ createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = await seed({ createdAt: new Date("2026-01-02T00:00:00Z") });

    const ids = await repository.withPendingBatch(10, (messages) =>
      Promise.resolve(messages.map((m) => m.id)),
    );

    expect(ids).toEqual([older.id, newer.id]);
  });

  it("T05: SKIP LOCKED prevents two concurrent batches from claiming the same row", async () => {
    const message = await seed();

    let lockAcquired!: () => void;
    const lockAcquiredPromise = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });

    const claimAndHold = (delayMs: number, onAcquired?: () => void) =>
      repository.withPendingBatch(1, async (messages) => {
        if (onAcquired) onAcquired();
        const claimedIds = messages.map((m) => m.id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return claimedIds;
      });

    const firstPromise = claimAndHold(300, lockAcquired);

    // Wait until the first transaction has definitively acquired the row lock
    await lockAcquiredPromise;

    const secondPromise = claimAndHold(0);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    const claimedByFirst = first ?? [];
    const claimedBySecond = second ?? [];

    // Exactly one of the two concurrent transactions should have claimed the row;
    // the other must see it as locked (skip) and get nothing.
    const totalClaims = claimedByFirst.length + claimedBySecond.length;
    expect(totalClaims).toBe(1);
    expect([...claimedByFirst, ...claimedBySecond]).toEqual([message.id]);
  });
});
