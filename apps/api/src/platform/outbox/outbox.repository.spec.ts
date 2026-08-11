import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import {
  OUTBOX_STATUSES,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";

import { OutboxRepository } from "./outbox.repository.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";

type UpdateFn = (args: unknown) => Promise<unknown>;
type CreateFn = (args: unknown) => Promise<unknown>;

function makeTx() {
  const update = jest.fn<UpdateFn>().mockResolvedValue(undefined);
  return {
    tx: {
      outboxMessage: { update },
    } as unknown as Prisma.TransactionClient,
    update,
  };
}

function makePrismaWithCreate() {
  const create = jest.fn<CreateFn>().mockResolvedValue(undefined);
  return {
    prisma: { outboxMessage: { create } } as unknown as PrismaService,
    create,
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
    it("creates a pending OutboxMessage row with the given aggregate/event/payload", async () => {
      const { prisma, create } = makePrismaWithCreate();
      const repository = new OutboxRepository(prisma);

      await repository.enqueue({
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: "assessment-1",
        eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
        payload: { assessmentId: "assessment-1" },
      });

      expect(create).toHaveBeenCalledTimes(1);
      const call = create.mock.calls[0][0] as {
        data: {
          id: string;
          aggregateType: string;
          aggregateId: string;
          eventType: string;
          payload: unknown;
          status: string;
          attempts: number;
        };
      };
      expect(call.data.aggregateType).toBe(OUTBOX_AGGREGATE_TYPES.assessment);
      expect(call.data.aggregateId).toBe("assessment-1");
      expect(call.data.eventType).toBe(ASSESSMENT_EVENT_TYPES.createdOutbox);
      expect(call.data.payload).toEqual({ assessmentId: "assessment-1" });
      expect(call.data.status).toBe(OUTBOX_STATUSES.pending);
      expect(call.data.attempts).toBe(0);
      expect(call.data.id).toBeTruthy();
    });

    it("writes within the given transaction client when provided", async () => {
      const create = jest.fn<CreateFn>().mockResolvedValue(undefined);
      const tx = {
        outboxMessage: { create },
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

      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
