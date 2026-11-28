import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AuditEventInput } from "@lcsp/contracts/audit";
import type { OutboxMessageInput } from "@lcsp/contracts/outbox";
import {
  CREDENTIAL_AUTHORIZATION_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";

import { toPrismaRepositorySnapshotStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import {
  RepositorySnapshotAuthorityChangedError,
  type RepositorySnapshotRepository,
} from "../../application/ports/persistence/repository-snapshot.repository.js";
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
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Business purpose: Persist the exact assessment repository revision and source boundary together with its creation event.
   *
   * Business rules:
   * - Source scope belongs to the immutable snapshot; null preserves an explicitly unscoped legacy snapshot.
   * - The snapshot, outbox and audit must commit together after locking current owner and connection authority.
   *
   * Execution flow:
   * 1. Lock and revalidate assessment ownership and the active connection after provider I/O.
   * 2. Insert the snapshot identity, commit, source prefix and provider metadata.
   * 3. Enqueue its creation event and audit in the same transaction.
   *
   * Failure cases:
   * - Stale authority, database validation, outbox or audit failure rolls back all writes.
   *
   * Side effects:
   * - Creates one snapshot, one outbox message and one audit event atomically.
   */
  async saveWithCreatedEvent(
    snapshot: RepositorySnapshot,
    event: OutboxMessageInput,
    audit: AuditEventInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Why: Lock the authoritative rows before publication so a concurrent
      // assessment deletion or connection revocation cannot race the commit.
      const assessment = await tx.$queryRaw<
        Array<{ id: string; ownerId: string }>
      >(
        Prisma.sql`SELECT "id", "ownerId" FROM "Assessment" WHERE "id" = ${snapshot.assessmentId} FOR SHARE`,
      );
      const connection = await tx.$queryRaw<
        Array<{
          id: string;
          userId: string;
          assessmentId: string | null;
          status: string;
          credentialAuthorizationStatus: string;
        }>
      >(
        Prisma.sql`SELECT "id", "userId", "assessmentId", "status", "credentialAuthorizationStatus" FROM "RepositoryConnection" WHERE "id" = ${snapshot.connectionId} FOR SHARE`,
      );
      const linked = connection[0];
      if (
        assessment[0]?.ownerId !== snapshot.actorId ||
        !linked ||
        linked.userId !== snapshot.actorId ||
        (linked.assessmentId !== null &&
          linked.assessmentId !== snapshot.assessmentId) ||
        linked.status !== REPOSITORY_CONNECTION_STATUSES.active ||
        linked.credentialAuthorizationStatus !==
          CREDENTIAL_AUTHORIZATION_STATUSES.active
      ) {
        throw new RepositorySnapshotAuthorityChangedError();
      }
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
      await this.auditWriter.writeInTx(audit, tx);
    });
  }
}
