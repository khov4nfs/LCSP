import { describe, expect, it, jest } from "@jest/globals";

import {
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  REPOSITORY_SCAN_JOB_STATUSES,
} from "@lcsp/contracts/github-integration";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { RepositoryScanJob } from "../../domain/entities/repository-scan-job.entity.js";
import { PrismaRepositoryScanJobRepository } from "./prisma-repository-scan-job.repository.js";

describe("PrismaRepositoryScanJobRepository", () => {
  it("persists the scan job and outbox command in one transaction", async () => {
    const create = jest
      .fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>()
      .mockResolvedValue({});
    const tx = { repositoryScanJob: { create } };
    const transaction = jest
      .fn<(callback: (client: typeof tx) => Promise<void>) => Promise<void>>()
      .mockImplementation((callback) => callback(tx));
    const enqueue = jest
      .fn<OutboxRepository["enqueue"]>()
      .mockResolvedValue("outbox-message-1");
    const repository = new PrismaRepositoryScanJobRepository(
      { $transaction: transaction } as unknown as PrismaService,
      { enqueue } as unknown as OutboxRepository,
    );
    const job = RepositoryScanJob.create({
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "scan-request:assessment-1:snapshot-1:1",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      correlationId: "corr-1",
    });
    const event = {
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
      aggregateId: job.id,
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered,
      payload: { scanJobId: job.id },
    };

    await repository.saveWithTriggeredEvent(job, event);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: job.id,
        status: REPOSITORY_SCAN_JOB_STATUSES.queued,
        idempotencyKey: job.idempotencyKey,
        correlationId: "corr-1",
      }),
    });
    expect(enqueue.mock.calls[0]?.[0]).toEqual(event);
    expect(enqueue.mock.calls[0]?.[1]).toBe(tx);
  });

  it("rehydrates an existing job by idempotency key", async () => {
    const record = {
      id: "scan-job-1",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "key-1",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
      attemptCount: 1,
      correlationId: "corr-1",
      blockedReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const findUnique = jest.fn<() => Promise<typeof record | null>>();
    findUnique.mockResolvedValue(record);
    const repository = new PrismaRepositoryScanJobRepository(
      {
        repositoryScanJob: { findUnique },
      } as unknown as PrismaService,
      {} as OutboxRepository,
    );

    const result = await repository.findByIdempotencyKey("key-1");

    expect(result?.id).toBe("scan-job-1");
    expect(result?.status).toBe(REPOSITORY_SCAN_JOB_STATUSES.running);
  });

  it("persists a controlled-state job without enqueueing an outbox command", async () => {
    const create = jest
      .fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>()
      .mockResolvedValue({});
    const enqueue = jest
      .fn<OutboxRepository["enqueue"]>()
      .mockResolvedValue("outbox-message-1");
    const repository = new PrismaRepositoryScanJobRepository(
      {
        repositoryScanJob: { create },
      } as unknown as PrismaService,
      { enqueue } as unknown as OutboxRepository,
    );
    const job = RepositoryScanJob.createWithStatus({
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "scan-request:assessment-1:snapshot-1:mapping",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      correlationId: "corr-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.pendingMapping,
      blockedReason: "SCAN_BLOCKED_MAPPING",
    });

    await repository.save(job);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: job.id,
        status: REPOSITORY_SCAN_JOB_STATUSES.pendingMapping,
        blockedReason: "SCAN_BLOCKED_MAPPING",
      }),
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
