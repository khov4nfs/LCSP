import { readFileSync } from "node:fs";
const eventPolicy = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../tests/fixtures/outbox-event-policy.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { retired: string[]; retained: string[] };
import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_ROOT_COMMAND_TYPES } from "@lcsp/contracts/assessment-domain";
import {
  OUTBOX_STATUSES,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { jest } from "@jest/globals";
import { Prisma } from "@prisma/client";

import { OutboxRepository } from "./outbox.repository.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";

type UpdateFn = (args: unknown) => Promise<unknown>;
type CreateFn = (args: unknown) => Promise<unknown>;

function makeTx() {
  const update = jest.fn<UpdateFn>().mockResolvedValue(undefined);
  const updateMany = jest.fn<UpdateFn>().mockResolvedValue({ count: 1 });
  const findUnique = jest.fn<UpdateFn>();
  const count = jest.fn<UpdateFn>();
  const checkpointUpdateMany = jest
    .fn<UpdateFn>()
    .mockResolvedValue({ count: 1 });
  const $executeRaw = jest.fn<UpdateFn>().mockResolvedValue(undefined);
  return {
    tx: {
      outboxMessage: { update },
      targetedReanalysisRequest: { updateMany, findUnique, count },
      targetedReanalysisCheckpoint: { updateMany: checkpointUpdateMany },
      $executeRaw,
    } as unknown as Prisma.TransactionClient,
    update,
    updateMany,
    findUnique,
    count,
    checkpointUpdateMany,
    $executeRaw,
  };
}

function makePrismaWithCreate() {
  const upsert = jest.fn<CreateFn>().mockResolvedValue({ createdAt: new Date("2026-10-29T12:00:00Z") });
  const admission = jest.fn<CreateFn>().mockResolvedValue({});
  const tx = { outboxMessage: { upsert }, assessmentRootAdmissionRequest: { upsert: admission } };
  return {
    prisma: { ...tx, $transaction: (work: (client: unknown) => unknown) => work(tx) } as unknown as PrismaService,
    upsert,
    admission,
  };
}

describe("OutboxRepository", () => {
  it("markPublished sets status=published with the given publishedAt", async () => {
    const repository = new OutboxRepository({} as PrismaService);
    const { tx, update } = makeTx();
    const publishedAt = new Date("2026-01-01T00:00:00Z");

    await repository.markPublished(tx, "outbox-1", publishedAt);

    expect(update).toHaveBeenCalledWith({
      where: { id: "outbox-1" },
      data: { status: OUTBOX_STATUSES.published, publishedAt },
    });
  });

  it("T02: markFailure sets status=failed while attempts < maxAttempts", async () => {
    const repository = new OutboxRepository({} as PrismaService);
    const { tx, update } = makeTx();
    const now = new Date("2026-01-01T00:00:00Z");

    const nextAttemptAt = new Date("2026-01-01T00:00:04.000Z");
    await repository.markFailure(
      tx,
      "outbox-1",
      3,
      5,
      "boom",
      now,
      nextAttemptAt,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "outbox-1" },
      data: {
        status: OUTBOX_STATUSES.failed,
        attempts: 3,
        lastAttemptAt: now,
        nextAttemptAt,
        errorMessage: "boom",
      },
    });
  });

  it("T03: markFailure sets status=dlq once attempts reaches maxAttempts", async () => {
    const repository = new OutboxRepository({} as PrismaService);
    const { tx, update } = makeTx();
    const now = new Date("2026-01-01T00:00:00Z");

    await repository.markFailure(tx, "outbox-1", 5, 5, "boom", now, null);

    expect(update).toHaveBeenCalledWith({
      where: { id: "outbox-1" },
      data: {
        status: OUTBOX_STATUSES.dlq,
        attempts: 5,
        lastAttemptAt: now,
        nextAttemptAt: null,
        errorMessage: "boom",
      },
    });
  });

  it("truncates errorMessage to 500 characters", async () => {
    const repository = new OutboxRepository({} as PrismaService);
    const { tx, update } = makeTx();
    const longMessage = "x".repeat(600);

    await repository.markFailure(
      tx,
      "outbox-1",
      1,
      5,
      longMessage,
      new Date(),
      new Date(),
    );

    const call = update.mock.calls[0][0] as {
      data: { errorMessage: string };
    };
    expect(call.data.errorMessage).toHaveLength(500);
  });

  describe("enqueue", () => {
    it("atomically records Root demand and preserves its original age on duplicate enqueue", async () => {
      const { prisma, upsert, admission } = makePrismaWithCreate();
      const repository = new OutboxRepository(prisma);
      const input = { aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: "assessment-1", eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
        idempotencyKey: "root:assessment-1", payload: { assessmentId: "assessment-1" } };
      const id = await repository.enqueue(input);
      expect(await repository.enqueue(input)).toBe(id);
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(admission).toHaveBeenCalledTimes(2);
      expect(admission).toHaveBeenLastCalledWith({ where: { commandId: id }, update: {},
        create: { commandId: id, assessmentId: "assessment-1", requestedAt: new Date("2026-10-29T12:00:00Z") } });
    });

    it("creates a pending OutboxMessage row with the given aggregate/event/payload", async () => {
      const { prisma, upsert } = makePrismaWithCreate();
      const repository = new OutboxRepository(prisma);

      await repository.enqueue({
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: "assessment-1",
        eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
        payload: { assessmentId: "assessment-1" },
      });

      expect(upsert).toHaveBeenCalledTimes(1);
      const call = upsert.mock.calls[0][0] as {
        create: {
          id: string;
          aggregateType: string;
          aggregateId: string;
          eventType: string;
          payload: unknown;
          status: string;
          attempts: number;
        };
      };
      expect(call.create.aggregateType).toBe(OUTBOX_AGGREGATE_TYPES.assessment);
      expect(call.create.aggregateId).toBe("assessment-1");
      expect(call.create.eventType).toBe(ASSESSMENT_EVENT_TYPES.createdOutbox);
      expect(call.create.payload).toEqual({ assessmentId: "assessment-1" });
      expect(call.create.status).toBe(OUTBOX_STATUSES.pending);
      expect(call.create.attempts).toBe(0);
      expect(call.create.id).toBeTruthy();
    });

    it.each(eventPolicy.retired)(
      "refuses to enqueue the retired V1 event %s",
      async (eventType) => {
        const { prisma, upsert } = makePrismaWithCreate();
        const repository = new OutboxRepository(prisma);

        await expect(
          repository.enqueue({
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: "assessment-1",
            eventType,
            payload: {},
          }),
        ).rejects.toThrow("OUTBOX_EVENT_TYPE_RETIRED");
        expect(upsert).not.toHaveBeenCalled();
      },
    );

    it.each([...eventPolicy.retained])(
      "still enqueues the live event %s",
      async (eventType) => {
        const { prisma, upsert } = makePrismaWithCreate();
        const repository = new OutboxRepository(prisma);

        await repository.enqueue({
          aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
          aggregateId: "assessment-1",
          eventType,
          payload: {},
        });
        expect(upsert).toHaveBeenCalledTimes(1);
      },
    );

    it("writes within the given transaction client when provided", async () => {
      const upsert = jest.fn<CreateFn>().mockResolvedValue(undefined);
      const tx = {
        outboxMessage: { upsert },
      } as unknown as Prisma.TransactionClient;
      const repository = new OutboxRepository({} as PrismaService);

      await repository.enqueue(
        {
          aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
          aggregateId: "assessment-1",
          eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
          payload: {},
        },
        tx,
      );

      expect(upsert).toHaveBeenCalledTimes(1);
    });

    it("treats duplicate idempotent outbox inserts as successful replays", async () => {
      // Upsert-on-id means a duplicate never raises: catching a P2002 after the
      // fact would leave the surrounding interactive transaction aborted.
      const upsert = jest.fn<CreateFn>().mockResolvedValue(undefined);
      const tx = {
        outboxMessage: { upsert },
      } as unknown as Prisma.TransactionClient;
      const repository = new OutboxRepository({} as PrismaService);

      await expect(
        repository.enqueue(
          {
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: "assessment-1",
            eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
            idempotencyKey: "assessment-1:created",
            payload: { assessmentId: "assessment-1" },
          },
          tx,
        ),
      ).resolves.toMatch(/^outbox:/);

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          where: { id: expect.stringMatching(/^outbox:/u) },
          update: {},
        }),
      );
    });
  });
});
