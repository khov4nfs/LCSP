import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import {
  OUTBOX_STATUSES,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/outbox";
import { jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import type { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";

import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { OutboxPublisherService } from "./outbox-publisher.service.js";
import type { OutboxRepository } from "./outbox.repository.js";
import type { RabbitMqClient } from "./rabbitmq.client.js";
import type { AuditWriterService } from "../audit/audit-writer.service.js";

type WithPendingBatchFn = (
  batchSize: number,
  handler: (
    messages: OutboxMessageEntity[],
    tx: Prisma.TransactionClient,
  ) => Promise<unknown>,
) => Promise<unknown>;
type MarkPublishedFn = (
  tx: Prisma.TransactionClient,
  id: string,
  publishedAt: Date,
) => Promise<void>;
type MarkFailureFn = (
  tx: Prisma.TransactionClient,
  id: string,
  attempts: number,
  maxAttempts: number,
  errorMessage: string,
  now: Date,
  nextAttemptAt: Date | null,
) => Promise<void>;
type EnsureConnectedFn = () => Promise<void>;
type PublishFn = (
  exchange: string,
  routingKey: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
) => Promise<void>;

function makeConfigService(
  overrides: Record<string, unknown> = {},
): ConfigService {
  const values: Record<string, unknown> = {
    "outbox.pollIntervalMs": 1000,
    "outbox.batchSize": 50,
    "outbox.maxAttempts": 5,
    "rabbitmq.exchange": "lcsp.events",
    ...overrides,
  };

  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function makeOutboxRepository(overrides: {
  withPendingBatch?: ReturnType<typeof jest.fn<WithPendingBatchFn>>;
  markPublished?: ReturnType<typeof jest.fn<MarkPublishedFn>>;
  markFailure?: ReturnType<typeof jest.fn<MarkFailureFn>>;
}) {
  return {
    withPendingBatch:
      overrides.withPendingBatch ?? jest.fn<WithPendingBatchFn>(),
    markPublished: overrides.markPublished ?? jest.fn<MarkPublishedFn>(),
    markFailure: overrides.markFailure ?? jest.fn<MarkFailureFn>(),
  } as unknown as OutboxRepository;
}

function makeRabbitMqClient(overrides: {
  ensureConnected?: ReturnType<typeof jest.fn<EnsureConnectedFn>>;
  publish?: ReturnType<typeof jest.fn<PublishFn>>;
}) {
  return {
    ensureConnected: overrides.ensureConnected ?? jest.fn<EnsureConnectedFn>(),
    publish: overrides.publish ?? jest.fn<PublishFn>(),
  } as unknown as RabbitMqClient;
}

type AuditWriterDouble = AuditWriterService & {
  writeMock: jest.MockedFunction<AuditWriterService["write"]>;
};

function makeAuditWriter(): AuditWriterDouble {
  const writeMock = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    write: writeMock,
    writeMock,
  } as unknown as AuditWriterDouble;
}

function makeMessage(
  overrides: Partial<
    Parameters<typeof OutboxMessageEntity.fromPersistence>[0]
  > = {},
) {
  return OutboxMessageEntity.fromPersistence({
    id: "outbox-1",
    aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
    aggregateId: "assessment-1",
    eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
    payload: { foo: "bar" },
    status: OUTBOX_STATUSES.pending,
    attempts: 0,
    lastAttemptAt: null,
    publishedAt: null,
    errorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  });
}

describe("OutboxPublisherService", () => {
  let loggerErrorSpy: jest.SpiedFunction<typeof Logger.prototype.error>;

  beforeEach(() => {
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it("does not start the poll timer when outbox publishing is disabled", () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    const service = new OutboxPublisherService(
      makeOutboxRepository({}),
      makeRabbitMqClient({}),
      makeConfigService({ "outbox.enabled": false }),
      makeAuditWriter(),
    );

    service.onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("T01: publishes a pending message and marks it published", async () => {
    const message = makeMessage();
    const markPublished = jest
      .fn<MarkPublishedFn>()
      .mockResolvedValue(undefined);
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockImplementation(async (_batchSize, handler) =>
        handler([message], {} as Prisma.TransactionClient),
      );
    const outboxRepository = makeOutboxRepository({
      withPendingBatch,
      markPublished,
    });

    const publish = jest.fn<PublishFn>().mockResolvedValue(undefined);
    const rabbitMqClient = makeRabbitMqClient({
      ensureConnected: jest
        .fn<EnsureConnectedFn>()
        .mockResolvedValue(undefined),
      publish,
    });

    const service = new OutboxPublisherService(
      outboxRepository,
      rabbitMqClient,
      makeConfigService(),
      makeAuditWriter(),
    );

    await service.poll();

    expect(publish).toHaveBeenCalledWith(
      "lcsp.events",
      ASSESSMENT_EVENT_TYPES.createdOutbox,
      {
        foo: "bar",
      },
    );
    expect(markPublished).toHaveBeenCalledWith(
      {},
      "outbox-1",
      expect.any(Date),
    );
  });

  it("T02: on publish failure below MAX_ATTEMPTS, records the failure with incremented attempts", async () => {
    const message = makeMessage({ attempts: 2 });
    const markFailure = jest.fn<MarkFailureFn>().mockResolvedValue(undefined);
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockImplementation(async (_batchSize, handler) =>
        handler([message], {} as Prisma.TransactionClient),
      );
    const outboxRepository = makeOutboxRepository({
      withPendingBatch,
      markFailure,
    });

    const rabbitMqClient = makeRabbitMqClient({
      ensureConnected: jest
        .fn<EnsureConnectedFn>()
        .mockResolvedValue(undefined),
      publish: jest
        .fn<PublishFn>()
        .mockRejectedValue(new Error("broker refused")),
    });
    const auditWriter = makeAuditWriter();

    const service = new OutboxPublisherService(
      outboxRepository,
      rabbitMqClient,
      makeConfigService({ "outbox.maxAttempts": 5 }),
      auditWriter,
    );

    await service.poll();

    expect(markFailure).toHaveBeenCalledWith(
      {},
      "outbox-1",
      3,
      5,
      "broker refused",
      expect.any(Date),
      expect.any(Date),
    );
    expect(auditWriter.writeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: OUTBOX_AUDIT_EVENT_TYPES.retryScheduled,
        correlationId: "outbox:outbox-1",
      }),
    );
  });

  it("publishes worker authorization metadata as AMQP headers", async () => {
    const message = makeMessage({
      payload: {
        actor: { id: "user-1", type: "USER" },
        organizationId: "org-1",
        authorizationAction: "scan:trigger",
        correlationId: "corr-1",
      },
    });
    const publish = jest.fn<PublishFn>().mockResolvedValue(undefined);
    const service = new OutboxPublisherService(
      makeOutboxRepository({
        withPendingBatch: jest
          .fn<WithPendingBatchFn>()
          .mockImplementation(async (_batchSize, handler) =>
            handler([message], {} as Prisma.TransactionClient),
          ),
        markPublished: jest.fn<MarkPublishedFn>().mockResolvedValue(undefined),
      }),
      makeRabbitMqClient({
        ensureConnected: jest
          .fn<EnsureConnectedFn>()
          .mockResolvedValue(undefined),
        publish,
      }),
      makeConfigService(),
      makeAuditWriter(),
    );

    await service.poll();

    expect(publish).toHaveBeenCalledWith(
      "lcsp.events",
      ASSESSMENT_EVENT_TYPES.createdOutbox,
      message.payload,
      {
        user_id: "user-1",
        organization_id: "org-1",
        action: "scan:trigger",
        "x-correlation-id": "corr-1",
      },
    );
  });

  it("T04: skips the poll and does not crash when RabbitMQ is unavailable", async () => {
    const withPendingBatch = jest.fn<WithPendingBatchFn>();
    const outboxRepository = makeOutboxRepository({ withPendingBatch });

    const rabbitMqClient = makeRabbitMqClient({
      ensureConnected: jest
        .fn<EnsureConnectedFn>()
        .mockRejectedValue(new Error("ECONNREFUSED")),
    });

    const service = new OutboxPublisherService(
      outboxRepository,
      rabbitMqClient,
      makeConfigService(),
      makeAuditWriter(),
    );

    await expect(service.poll()).resolves.toBeUndefined();
    expect(withPendingBatch).not.toHaveBeenCalled();
  });

  it("does not overlap polls when one is already in progress", async () => {
    let resolveEnsureConnected: () => void = () => undefined;
    const ensureConnected = jest.fn<EnsureConnectedFn>(
      () =>
        new Promise<void>((resolve) => {
          resolveEnsureConnected = resolve;
        }),
    );
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockResolvedValue(null);
    const outboxRepository = makeOutboxRepository({ withPendingBatch });
    const rabbitMqClient = makeRabbitMqClient({ ensureConnected });

    const service = new OutboxPublisherService(
      outboxRepository,
      rabbitMqClient,
      makeConfigService(),
      makeAuditWriter(),
    );

    const firstPoll = service.poll();
    const secondPoll = service.poll();

    expect(ensureConnected).toHaveBeenCalledTimes(1);

    resolveEnsureConnected();
    await Promise.all([firstPoll, secondPoll]);
  });

  it("T08: onModuleDestroy stops the poller so no further polls fire", async () => {
    jest.useFakeTimers();

    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockResolvedValue(null);
    const outboxRepository = makeOutboxRepository({ withPendingBatch });
    const ensureConnected = jest
      .fn<EnsureConnectedFn>()
      .mockResolvedValue(undefined);
    const rabbitMqClient = makeRabbitMqClient({ ensureConnected });

    const service = new OutboxPublisherService(
      outboxRepository,
      rabbitMqClient,
      makeConfigService({ "outbox.pollIntervalMs": 100 }),
      makeAuditWriter(),
    );

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(250);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(1000);

    // Two ticks fired before destroy (at 100ms and 200ms); none after.
    expect(ensureConnected).toHaveBeenCalledTimes(2);
  });
});
