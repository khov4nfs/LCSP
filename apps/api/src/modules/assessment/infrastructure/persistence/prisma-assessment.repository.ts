import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  AssessmentListCriteria,
  AssessmentListResult,
  AssessmentRepository,
} from "../../application/ports/persistence/assessment.repository.js";
import {
  AssessmentRevisionConflictError,
  AssessmentUpdateTargetNotFoundError,
} from "../../application/ports/persistence/assessment.repository.js";
import { Assessment } from "../../domain/entities/assessment.entity.js";

type AssessmentRecord = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Implements assessment persistence with Prisma and translates persistence enums/records to domain aggregates.
 */
@Injectable()
export class PrismaAssessmentRepository implements AssessmentRepository {
  /**
   * Creates the repository with the application Prisma client.
   *
   * @param prisma - Prisma service used for assessment persistence and queries.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an assessment using the default Prisma client.
   *
   * @param assessment - Assessment aggregate to create or update.
   * @returns A promise that resolves after persistence completes.
   */
  async save(assessment: Assessment): Promise<void> {
    await this.saveWithClient(this.prisma, assessment);
    // The default client write has completed when saveWithClient resolves, so
    // the aggregate may now advance its in-memory persistence baseline.
    assessment.markPersisted();
  }

  /**
   * Persists an assessment within an existing transaction.
   *
   * @param assessment - Assessment aggregate to create or update.
   * @param tx - Prisma transaction that must include the assessment write.
   * @returns A promise that resolves after persistence completes.
   */
  async saveInTx(
    assessment: Assessment,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.saveWithClient(tx, assessment);
  }

  /**
   * Persists the assessment aggregate by creating new records or performing an optimistic CAS update.
   *
   * Business purpose:
   * Persists assessment aggregate state while strictly preventing resurrection and lost updates.
   *
   * Business rules:
   * - New aggregates (isNew === true) must use create; update-only operations must never use upsert.
   * - Updates must enforce owner-scoped compare-and-set (CAS) optimistic concurrency based on expectedUpdatedAt.
   * - Stale concurrent writes and missing update targets must surface as typed persistence errors.
   * - Transaction-scoped writes must not mutate the aggregate persistence baseline before the caller's transaction commits.
   *
   * Execution flow:
   * 1. If aggregate isNew, execute create path inserting initial record.
   * 2. If aggregate is existing, execute CAS updateMany scoping id, ownerId, and expectedUpdatedAt.
   * 3. If updateMany affected 0 rows, distinguish a missing/foreign target from a stale revision.
   * 4. Return without changing in-memory commit state; the transaction owner marks it only after commit.
   *
   * Failure cases:
   * - Concurrent write: throws AssessmentRevisionConflictError.
   * - Missing or foreign-owner row: throws AssessmentUpdateTargetNotFoundError.
   *
   * Side effects:
   * - Inserts or updates the Assessment database row without mutating in-memory commit tracking.
   *
   * @param client - Prisma service or active transaction client used for the write.
   * @param assessment - Assessment aggregate to persist.
   * @returns A promise that resolves after persistence completes.
   */
  private async saveWithClient(
    client: Prisma.TransactionClient,
    assessment: Assessment,
  ): Promise<void> {
    // Explanatory comment (ASM-12 / ASM-RENAME-02):
    // Rationale (Why): Eliminate upsert resurrection. When an assessment is deleted while an update
    // is in-flight, upsert would erroneously recreate the record and bypass creation workflows.
    // Mechanism (How): Explicitly branch on assessment.isNew. New entities use client.assessment.create,
    // while existing entities exclusively use update-only logic.
    // Invariants: Deleted assessments are NEVER resurrected by rename or update commands.
    if (assessment.isNew) {
      await client.assessment.create({
        data: {
          id: assessment.id,
          ownerId: assessment.ownerId,
          name: assessment.name,
          description: assessment.description,
          createdAt: assessment.createdAt,
          updatedAt: assessment.updatedAt,
        },
      });
      return;
    }

    // Explanatory comment (ASM-11 / ASM-RENAME-01 & ASM-13 / ASM-RENAME-03):
    // Rationale (Why): Prevent lost updates between concurrent rename operations and persist mutated updatedAt.
    // Mechanism (How): Execute owner-scoped CAS via updateMany matching id, ownerId, and expectedUpdatedAt.
    // If count === 0, another writer committed first, so reject with 409 Conflict.
    // The same updateMany statement persists the descriptive fields and revision;
    // a second unscoped update would reopen the lost-update race for non-transactional callers.
    // Invariants: Strictly owner-scoped; a strictly advancing revision guarantees exactly one winner.
    const result = await client.assessment.updateMany({
      where: {
        id: assessment.id,
        ownerId: assessment.ownerId,
        // A durable deletion claim makes the aggregate non-mutable while
        // destructive cleanup is in progress, preventing success-then-vanish renames.
        deletionFence: { is: null },
        ...(assessment.expectedUpdatedAt
          ? { updatedAt: assessment.expectedUpdatedAt }
          : {}),
      },
      data: {
        name: assessment.name,
        description: assessment.description,
        updatedAt: assessment.updatedAt,
      },
    });

    if (result.count === 0) {
      // A second owner-scoped read occurs only on the failed CAS path. It lets
      // the application preserve masked 404 semantics without treating every
      // stale revision as a missing resource.
      const target = await client.assessment.findFirst({
        where: { id: assessment.id, ownerId: assessment.ownerId },
        select: { id: true },
      });
      if (!target) throw new AssessmentUpdateTargetNotFoundError();
      throw new AssessmentRevisionConflictError();
    }
  }

  /**
   * Finds one assessment aggregate by identifier.
   *
   * @param id - Assessment identifier to look up.
   * @returns The rehydrated assessment aggregate, or null when no row exists.
   */
  async findById(id: string): Promise<Assessment | null> {
    const record = await this.prisma.assessment.findUnique({ where: { id } });

    return record ? this.toDomain(record) : null;
  }

  /**
   * Business purpose: Load an assessment only when it belongs to the authenticated owner.
   *
   * Business rules:
   * - Both assessment identifier and owner identifier are mandatory query predicates.
   * - Missing and foreign-owner rows are intentionally indistinguishable to callers.
   *
   * Execution flow:
   * 1. Query one assessment using the combined identifier and owner scope.
   * 2. Rehydrate the aggregate when a matching row exists; otherwise return null.
   *
   * Failure cases:
   * - Database failures propagate to the application boundary.
   * - A non-matching owner returns null rather than exposing row existence.
   *
   * Side effects:
   * - Read-only database query; no persistence state is changed.
   *
   * @param id - Assessment identifier requested by the actor.
   * @param ownerId - Authenticated owner identifier that scopes visibility.
   * @returns The owner-scoped aggregate or null when no authorized row exists.
   */
  async findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<Assessment | null> {
    // Scoping the very first read prevents cross-owner data from entering the
    // application layer even though later mutation locks also revalidate owner.
    const record = await this.prisma.assessment.findFirst({
      where: { id, ownerId },
    });

    return record ? this.toDomain(record) : null;
  }

  /**
   * Retrieves a paginated assessment page using owner/scope and status criteria.
   *
   * @param criteria - Visibility, status, and pagination filters.
   * @returns Rehydrated assessment items plus the total matching row count.
   */
  async findMany(
    criteria: AssessmentListCriteria,
  ): Promise<AssessmentListResult> {
    const where: Prisma.AssessmentWhereInput = {
      ...(criteria.ownerId ? { ownerId: criteria.ownerId } : {}),
      ...(criteria.assessmentId ? { id: criteria.assessmentId } : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.assessment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.assessment.count({ where }),
    ]);

    return {
      items: records.map((record) => this.toDomain(record)),
      total,
    };
  }

  /**
   * Converts a Prisma assessment record into the domain aggregate representation.
   *
   * @param record - Persisted assessment record with Prisma enum values.
   * @returns A rehydrated assessment aggregate.
   */
  private toDomain(record: AssessmentRecord): Assessment {
    return Assessment.rehydrate({
      id: record.id,
      ownerId: record.ownerId,
      name: record.name,
      description: record.description,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
