import { jest } from "@jest/globals";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
} from "@lcsp/contracts/github-integration";
import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_AUDIT_EVENT_TYPES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import {
  RBAC_OUTBOX_EVENT_TYPES,
  RBAC_REASON_CODES,
} from "@lcsp/contracts/rbac";
import { ConflictException, Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

import type { AuditWriterService } from "../audit/audit-writer.service.js";
import { authorizationDecisionKey } from "../rbac/authorization-decision-key.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { OutboxPublisherService } from "./outbox-publisher.service.js";
import type { OutboxRepository } from "./outbox.repository.js";
import type { RabbitMqClient } from "./rabbitmq.client.js";

type WithPendingBatchFn = (
  batchSize: number,
  handler: (
    messages: OutboxMessageEntity[],
    tx: Prisma.TransactionClient,
  ) => Promise<unknown>,
) => Promise<unknown>;
type WithPendingBatchByEventTypeFn = (
  eventType: string,
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
  withPendingBatchByEventType?: ReturnType<
    typeof jest.fn<WithPendingBatchByEventTypeFn>
  >;
  markPublished?: ReturnType<typeof jest.fn<MarkPublishedFn>>;
  markFailure?: ReturnType<typeof jest.fn<MarkFailureFn>>;
}) {
  return {
    withPendingBatch:
      overrides.withPendingBatch ?? jest.fn<WithPendingBatchFn>(),
    withPendingBatchByEventType:
      overrides.withPendingBatchByEventType ??
      jest.fn<WithPendingBatchByEventTypeFn>().mockResolvedValue(null),
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
  writeInTxMock: jest.MockedFunction<AuditWriterService["writeInTx"]>;
};

function makeAuditWriter(): AuditWriterDouble {
  const writeMock = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const writeInTxMock = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  return {
    write: writeMock,
    writeInTx: writeInTxMock,
    writeMock,
    writeInTxMock,
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

  it("always starts the poll timer without any enable flag", () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(globalThis, "setInterval");
    const service = new OutboxPublisherService(
      makeOutboxRepository({}),
      makeRabbitMqClient({}),
      makeConfigService({}),
      makeAuditWriter(),
    );

    service.onModuleInit();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
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

  it("[RED][ASM-RBAC-01] recovers a local authorization audit fallback without publishing it to RabbitMQ", async () => {
    const message = makeMessage({
      aggregateType: OUTBOX_AGGREGATE_TYPES.authUser,
      aggregateId: "user-1",
      eventType: RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback,
      payload: {
        actor_id: "user-1",
        session_id: "session-1",
        resource_type: "HTTP_ROUTE",
        resource_id: "GET /assessments/assessment-1",
        decision: "ALLOW",
        reason_code: "AUTHORIZED",
        correlationId: "corr-rbac-fallback",
        decision_occurrence_id: "occurrence-1",
        idempotencyKey: authorizationDecisionKey(
          {
            actor_id: "user-1",
            session_id: "session-1",
            resource_type: AUDIT_RESOURCE_TYPES.httpRoute,
            resource_id: "GET /assessments/assessment-1",
            decision: AUDIT_DECISIONS.allow,
            reason_code: RBAC_REASON_CODES.authorized,
            correlationId: "corr-rbac-fallback",
          },
          "occurrence-1",
        ),
      },
    });
    const tx = {} as Prisma.TransactionClient;
    const markPublished = jest
      .fn<MarkPublishedFn>()
      .mockResolvedValue(undefined);
    const withPendingBatchByEventType = jest
      .fn<WithPendingBatchByEventTypeFn>()
      .mockImplementation(async (_eventType, _batchSize, handler) =>
        handler([message], tx),
      );
    const publish = jest.fn<PublishFn>().mockResolvedValue(undefined);
    const auditWriter = makeAuditWriter();
    const service = new OutboxPublisherService(
      makeOutboxRepository({ withPendingBatchByEventType, markPublished }),
      makeRabbitMqClient({
        ensureConnected: jest
          .fn<EnsureConnectedFn>()
          .mockRejectedValue(new Error("broker unavailable")),
        publish,
      }),
      makeConfigService(),
      auditWriter,
    );

    const secondPoll = service.poll();
    await jest.advanceTimersByTimeAsync(10);
    await secondPoll;

    expect(auditWriter.writeInTxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "corr-rbac-fallback",
        decision: "ALLOW",
      }),
      tx,
    );
    expect(markPublished).toHaveBeenCalledWith(
      tx,
      message.id,
      expect.any(Date),
    );
    expect(publish).not.toHaveBeenCalled();
    expect(withPendingBatchByEventType).toHaveBeenCalledWith(
      RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback,
      50,
      expect.any(Function),
    );
  });

  it("keeps a failed local authorization recovery in the bounded retry path", async () => {
    const message = makeMessage({
      aggregateType: OUTBOX_AGGREGATE_TYPES.authUser,
      aggregateId: "user-1",
      eventType: RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback,
      payload: {
        actor_id: "user-1",
        session_id: "session-1",
        resource_type: "HTTP_ROUTE",
        resource_id: "GET /assessments/assessment-1",
        decision: "ALLOW",
        reason_code: "AUTHORIZED",
        correlationId: "corr-rbac-retry",
        decision_occurrence_id: "occurrence-2",
        idempotencyKey: authorizationDecisionKey(
          {
            actor_id: "user-1",
            session_id: "session-1",
            resource_type: AUDIT_RESOURCE_TYPES.httpRoute,
            resource_id: "GET /assessments/assessment-1",
            decision: AUDIT_DECISIONS.allow,
            reason_code: RBAC_REASON_CODES.authorized,
            correlationId: "corr-rbac-retry",
          },
          "occurrence-2",
        ),
      },
    });
    const tx = {} as Prisma.TransactionClient;
    const markPublished = jest
      .fn<MarkPublishedFn>()
      .mockResolvedValue(undefined);
    const markFailure = jest.fn<MarkFailureFn>().mockResolvedValue(undefined);
    const withPendingBatchByEventType = jest
      .fn<WithPendingBatchByEventTypeFn>()
      .mockImplementation(async (_eventType, _batchSize, handler) =>
        handler([message], tx),
      );
    const auditWriter = makeAuditWriter();
    auditWriter.writeInTxMock.mockRejectedValueOnce(
      new Error("canonical audit unavailable"),
    );
    const service = new OutboxPublisherService(
      makeOutboxRepository({
        withPendingBatchByEventType,
        markPublished,
        markFailure,
      }),
      makeRabbitMqClient({}),
      makeConfigService(),
      auditWriter,
    );

    await service.poll();

    // Recovery failure must not acknowledge the fallback. The existing
    // outbox retry/DLQ state machine retains it for a later bounded attempt.
    expect(markPublished).not.toHaveBeenCalled();
    expect(markFailure).toHaveBeenCalledWith(
      tx,
      message.id,
      1,
      5,
      "AUTHORIZATION_AUDIT_RECOVERY_FAILED",
      expect.any(Date),
      expect.any(Date),
    );
    expect(JSON.stringify(markFailure.mock.calls)).not.toContain(
      "canonical audit unavailable",
    );
  });

  it("rejects a fallback with a non-canonical RBAC reason into retry handling", async () => {
    const message = makeMessage({
      aggregateType: OUTBOX_AGGREGATE_TYPES.authUser,
      eventType: RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback,
      payload: {
        actor_id: "user-1",
        session_id: null,
        resource_type: "HTTP_ROUTE",
        resource_id: "GET /assessments/assessment-1",
        decision: "ALLOW",
        reason_code: "ALLOW_BY_ADMIN_OVERRIDE",
        correlationId: "corr-invalid-reason",
        decision_occurrence_id: "occurrence-invalid-reason",
        idempotencyKey: "decision-key",
      },
    });
    const tx = {} as Prisma.TransactionClient;
    const markFailure = jest.fn<MarkFailureFn>().mockResolvedValue(undefined);
    const withPendingBatchByEventType = jest
      .fn<WithPendingBatchByEventTypeFn>()
      .mockImplementation(async (_eventType, _batchSize, handler) =>
        handler([message], tx),
      );
    const auditWriter = makeAuditWriter();
    const service = new OutboxPublisherService(
      makeOutboxRepository({ withPendingBatchByEventType, markFailure }),
      makeRabbitMqClient({}),
      makeConfigService(),
      auditWriter,
    );

    await service.poll();

    expect(auditWriter.writeInTxMock).not.toHaveBeenCalled();
    expect(markFailure).toHaveBeenCalledTimes(1);
  });

  it("rejects a fallback whose stored idempotency key does not match its decision tuple", async () => {
    const message = makeMessage({
      aggregateType: OUTBOX_AGGREGATE_TYPES.authUser,
      eventType: RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback,
      payload: {
        actor_id: "user-1",
        session_id: "session-1",
        resource_type: "HTTP_ROUTE",
        resource_id: "GET /assessments/assessment-1",
        decision: "ALLOW",
        reason_code: "AUTHORIZED",
        correlationId: "corr-mismatched-key",
        decision_occurrence_id: "occurrence-mismatch",
        idempotencyKey: "rbac-audit:belongs-to-another-decision",
      },
    });
    const tx = {} as Prisma.TransactionClient;
    const markFailure = jest.fn<MarkFailureFn>().mockResolvedValue(undefined);
    const withPendingBatchByEventType = jest
      .fn<WithPendingBatchByEventTypeFn>()
      .mockImplementation(async (_eventType, _batchSize, handler) =>
        handler([message], tx),
      );
    const auditWriter = makeAuditWriter();
    const service = new OutboxPublisherService(
      makeOutboxRepository({ withPendingBatchByEventType, markFailure }),
      makeRabbitMqClient({}),
      makeConfigService(),
      auditWriter,
    );

    await service.poll();

    expect(auditWriter.writeInTxMock).not.toHaveBeenCalled();
    expect(markFailure).toHaveBeenCalledTimes(1);
  });

  it("auto-chains scan creation before publishing snapshotCreated", async () => {
    const message = makeMessage({
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      payload: {
        snapshotId: "snapshot-1",
        assessmentId: "assessment-1",
        correlationId: "corr-1",
        actor: {
          id: "user-1",
          type: "USER",
        },
        authorizationAction: "scan:trigger",
      },
    });
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockImplementation(async (_batchSize, handler) =>
        handler([message], {} as Prisma.TransactionClient),
      );
    const markPublished = jest
      .fn<MarkPublishedFn>()
      .mockResolvedValue(undefined);
    const outboxRepository = makeOutboxRepository({
      withPendingBatch,
      markPublished,
    });
    const publish = jest.fn<PublishFn>().mockResolvedValue(undefined);
    const service = new OutboxPublisherService(
      outboxRepository,
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
      GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      message.payload,
      {
        user_id: "user-1",
        "x-correlation-id": "corr-1",
      },
    );
  });

  it("logs exception type and problem code when publishing fails", async () => {
    const message = makeMessage({
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
    });
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockImplementation(async (_batchSize, handler) =>
        handler([message], {} as Prisma.TransactionClient),
      );
    const markFailure = jest.fn<MarkFailureFn>().mockResolvedValue(undefined);
    const failure = new ConflictException({
      ok: false,
      problem: {
        code: GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyConflict,
      },
    });

    const service = new OutboxPublisherService(
      makeOutboxRepository({ withPendingBatch, markFailure }),
      makeRabbitMqClient({
        ensureConnected: jest
          .fn<EnsureConnectedFn>()
          .mockResolvedValue(undefined),
        publish: jest.fn<PublishFn>().mockRejectedValue(failure),
      }),
      makeConfigService(),
      makeAuditWriter(),
    );

    await service.poll();

    expect(markFailure).toHaveBeenCalledWith(
      {},
      "outbox-1",
      1,
      5,
      "Conflict Exception",
      expect.any(Date),
      expect.any(Date),
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `error_type=ConflictException error_code=${GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyConflict}`,
      ),
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
        "x-correlation-id": "corr-1",
      },
    );
  });

  it("T04: leaves messages pending and does not crash when RabbitMQ is unavailable", async () => {
    const message = makeMessage();
    const markPublished = jest
      .fn<MarkPublishedFn>()
      .mockResolvedValue(undefined);
    const markFailure = jest.fn<MarkFailureFn>().mockResolvedValue(undefined);
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockImplementation(async (_batchSize, handler) =>
        handler([message], {} as Prisma.TransactionClient),
      );
    const outboxRepository = makeOutboxRepository({
      withPendingBatch,
      markPublished,
      markFailure,
    });

    const rabbitMqClient = makeRabbitMqClient({
      ensureConnected: jest
        .fn<EnsureConnectedFn>()
        .mockRejectedValue(new Error("ECONNREFUSED")),
      publish: jest
        .fn<PublishFn>()
        .mockRejectedValue(new Error("ECONNREFUSED")),
    });

    const service = new OutboxPublisherService(
      outboxRepository,
      rabbitMqClient,
      makeConfigService(),
      makeAuditWriter(),
    );

    await expect(service.poll()).resolves.toBeUndefined();
    // The batch is still inspected so local authorization-audit recovery can
    // proceed without RabbitMQ; broker-bound rows remain pending untouched.
    expect(withPendingBatch).toHaveBeenCalledTimes(1);
    expect(markPublished).not.toHaveBeenCalled();
    expect(markFailure).not.toHaveBeenCalled();
  });

  it("does not overlap polls when one is already in progress", async () => {
    let resolvePendingBatch: () => void = () => undefined;
    const withPendingBatchByEventType = jest.fn<WithPendingBatchByEventTypeFn>(
      () =>
        new Promise<void>((resolve) => {
          resolvePendingBatch = resolve;
        }),
    );
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockResolvedValue(null);
    const outboxRepository = makeOutboxRepository({
      withPendingBatch,
      withPendingBatchByEventType,
    });
    const rabbitMqClient = makeRabbitMqClient({});

    const service = new OutboxPublisherService(
      outboxRepository,
      rabbitMqClient,
      makeConfigService(),
      makeAuditWriter(),
    );

    const firstPoll = service.poll();
    const secondPoll = service.poll();

    // The dedicated local-recovery batch is the first async boundary, ensuring
    // a second poll cannot overlap it or begin broker delivery concurrently.
    expect(withPendingBatchByEventType).toHaveBeenCalledTimes(1);
    expect(withPendingBatch).not.toHaveBeenCalled();

    resolvePendingBatch();
    await Promise.all([firstPoll, secondPoll]);
    expect(withPendingBatchByEventType).toHaveBeenCalledTimes(1);
    expect(withPendingBatch).toHaveBeenCalledTimes(1);
  });

  it("releases the poll latch when broker connection never settles", async () => {
    jest.useFakeTimers();
    const message = makeMessage();
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockImplementation(async (_batchSize, handler) =>
        handler([message], {} as Prisma.TransactionClient),
      );
    const ensureConnected = jest.fn<EnsureConnectedFn>(
      () => new Promise<void>(() => undefined),
    );
    const service = new OutboxPublisherService(
      makeOutboxRepository({ withPendingBatch }),
      makeRabbitMqClient({ ensureConnected }),
      makeConfigService({ "outbox.brokerConnectTimeoutMs": 5 }),
      makeAuditWriter(),
    );

    let settled = false;
    const firstPoll = service.poll().finally(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);

    const secondPoll = service.poll();
    await jest.advanceTimersByTimeAsync(10);
    await secondPoll;
    expect(withPendingBatch).toHaveBeenCalledTimes(2);
    await firstPoll;
    jest.useRealTimers();
  });

  it("releases the poll latch when broker publish confirmation never settles", async () => {
    jest.useFakeTimers();
    const message = makeMessage();
    const withPendingBatch = jest
      .fn<WithPendingBatchFn>()
      .mockImplementation(async (_batchSize, handler) =>
        handler([message], {} as Prisma.TransactionClient),
      );
    const publish = jest
      .fn<PublishFn>()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockResolvedValue(undefined);
    const service = new OutboxPublisherService(
      makeOutboxRepository({
        withPendingBatch,
        markFailure: jest.fn<MarkFailureFn>().mockResolvedValue(undefined),
      }),
      makeRabbitMqClient({
        ensureConnected: jest
          .fn<EnsureConnectedFn>()
          .mockResolvedValue(undefined),
        publish,
      }),
      makeConfigService({ "outbox.brokerPublishTimeoutMs": 5 }),
      makeAuditWriter(),
    );

    const firstPoll = service.poll();
    await jest.advanceTimersByTimeAsync(10);
    await firstPoll;

    await service.poll();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(withPendingBatch).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
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
    expect(withPendingBatch).toHaveBeenCalledTimes(2);
  });
});
