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
   * Atomically persists an immutable repository snapshot and its corresponding creation event.
   *
   * @param snapshot - Resolved snapshot aggregate containing exact repository revision metadata.
   * @param event - Outbox event announcing the newly created snapshot.
   * @returns A promise that resolves after both writes commit successfully.
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
