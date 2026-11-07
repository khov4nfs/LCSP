import { Injectable } from "@nestjs/common";

import type { OutboxMessageInput } from "@lcsp/contracts/outbox";

import { toPrismaRepositorySnapshotStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { RepositorySnapshotRepository } from "../../application/ports/persistence/repository-snapshot.repository.js";
import type { RepositorySnapshot } from "../../domain/entities/repository-snapshot.entity.js";

/**
 * Persists immutable repository snapshots with Prisma and atomically emits their creation event through the outbox.
 */
@Injectable()
export class PrismaRepositorySnapshotRepository implements RepositorySnapshotRepository {
  /**
   * Creates the repository with database and transactional outbox dependencies.
   *
   * @param prisma - Prisma service used to persist immutable snapshot metadata.
   * @param outbox - Outbox repository used to enqueue the snapshot-created event in the same transaction.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Business purpose: Persist the exact assessment repository revision and source boundary together with its creation event.
   *
   * Business rules:
   * - Source scope belongs to the immutable snapshot; null preserves an explicitly unscoped legacy snapshot.
   * - The snapshot and outbox event must commit together.
   *
   * Execution flow:
   * 1. Insert the snapshot identity, commit, source prefix and provider metadata.
   * 2. Enqueue its creation event in the same transaction.
   *
   * Failure cases:
   * - Database validation, immutable-scope constraints or outbox failure roll back both writes.
   *
   * Side effects:
   * - Creates one snapshot and one transactional outbox message.
   */
  async saveWithCreatedEvent(
    snapshot: RepositorySnapshot,
    event: OutboxMessageInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.repositorySnapshot.create({
        data: {
          id: snapshot.id,
          assessmentId: snapshot.assessmentId,
          connectionId: snapshot.connectionId,
          repositoryId: snapshot.repositoryId,
          repositoryFullName: snapshot.repositoryFullName,
          branch: snapshot.branch,
          ref: snapshot.ref,
          commitSha: snapshot.commitSha,
          sourcePathPrefix: snapshot.sourcePathPrefix,
          providerMetadata: snapshot.providerMetadata,
          actorId: snapshot.actorId,
          status: toPrismaRepositorySnapshotStatus(snapshot.status),
          createdAt: snapshot.createdAt,
        },
      });
      await this.outbox.enqueue(event, tx);
    });
  }
}
