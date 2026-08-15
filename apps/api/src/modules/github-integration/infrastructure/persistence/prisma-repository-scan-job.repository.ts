import { Injectable } from "@nestjs/common";

import type { OutboxMessageInput } from "@lcsp/contracts/outbox";

import {
  fromPrismaRepositoryScanJobStatus,
  fromPrismaRepositoryScanTriggerSource,
  toPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanTriggerSource,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { RepositoryScanJobRepository } from "../../application/ports/persistence/repository-scan-job.repository.js";
import { RepositoryScanJob } from "../../domain/entities/repository-scan-job.entity.js";

/**
 * Implements repository scan-job persistence with Prisma and coordinates scan creation with transactional outbox delivery.
 */
@Injectable()
export class PrismaRepositoryScanJobRepository implements RepositoryScanJobRepository {
  /**
   * Creates the repository with database and transactional outbox dependencies.
   *
   * @param prisma - Prisma service used for scan-job persistence and idempotency lookup.
   * @param outbox - Outbox repository used to enqueue scan-trigger events in the same transaction as job creation.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Finds a scan job by its globally unique idempotency key.
   *
   * @param key - Trigger idempotency key to look up.
   * @returns Rehydrated scan-job aggregate, or null when no matching row exists.
   */
  async findByIdempotencyKey(key: string): Promise<RepositoryScanJob | null> {
    const record = await this.prisma.repositoryScanJob.findUnique({
      where: { idempotencyKey: key },
    });
    if (!record) return null;
    return RepositoryScanJob.rehydrate({
      ...record,
      triggerSource: fromPrismaRepositoryScanTriggerSource(
        record.triggerSource,
      ),
      status: fromPrismaRepositoryScanJobStatus(record.status),
    });
  }

  /**
   * Atomically persists a scan job and its corresponding triggered outbox event.
   *
   * @param job - Repository scan-job aggregate to persist.
   * @param event - Outbox event describing the triggered scan.
   * @returns A promise that resolves after both writes commit successfully.
   */
  async saveWithTriggeredEvent(
    job: RepositoryScanJob,
    event: OutboxMessageInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.repositoryScanJob.create({ data: toPersistence(job) });
      await this.outbox.enqueue(event, tx);
    });
  }

  /**
   * Persists a scan job without emitting an outbox event.
   *
   * @param job - Repository scan-job aggregate to create.
   * @returns A promise that resolves after the scan-job row is persisted.
   */
  async save(job: RepositoryScanJob): Promise<void> {
    await this.prisma.repositoryScanJob.create({
      data: toPersistence(job),
    });
  }
}

/**
 * Converts a scan-job aggregate into Prisma persistence fields with explicit enum mapping.
 *
 * @param job - Domain scan-job aggregate to serialize.
 * @returns Prisma-compatible scan-job create data.
 */
function toPersistence(job: RepositoryScanJob) {
  return {
    id: job.id,
    assessmentId: job.assessmentId,
    snapshotId: job.snapshotId,
    organizationId: job.organizationId,
    idempotencyKey: job.idempotencyKey,
    triggerSource: toPrismaRepositoryScanTriggerSource(job.triggerSource),
    status: toPrismaRepositoryScanJobStatus(job.status),
    attemptCount: job.attemptCount,
    correlationId: job.correlationId,
    blockedReason: job.blockedReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
