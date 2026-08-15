import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AssessmentStatus as PrismaAssessmentStatus } from "@prisma/client";

import {
  fromPrismaAssessmentStatus,
  toPrismaAssessmentStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  AssessmentListCriteria,
  AssessmentListResult,
  AssessmentRepository,
} from "../../application/ports/persistence/assessment.repository.js";
import { Assessment } from "../../domain/entities/assessment.entity.js";

type AssessmentRecord = {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  description: string | null;
  status: PrismaAssessmentStatus;
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
   * Upserts the assessment with the supplied Prisma-compatible client.
   *
   * @param client - Prisma service or active transaction client used for the write.
   * @param assessment - Assessment aggregate to persist.
   * @returns A promise that resolves after the upsert completes.
   */
  private async saveWithClient(
    client: Prisma.TransactionClient,
    assessment: Assessment,
  ): Promise<void> {
    await client.assessment.upsert({
      where: { id: assessment.id },
      create: {
        id: assessment.id,
        organizationId: assessment.organizationId,
        ownerId: assessment.ownerId,
        name: assessment.name,
        description: assessment.description,
        status: toPrismaAssessmentStatus(assessment.status),
        createdAt: assessment.createdAt,
        updatedAt: assessment.updatedAt,
      },
      update: {
        name: assessment.name,
        description: assessment.description,
        status: toPrismaAssessmentStatus(assessment.status),
      },
    });
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
   * Retrieves a paginated assessment page using organization, owner/scope, and status criteria.
   *
   * @param criteria - Tenant, visibility, status, and pagination filters.
   * @returns Rehydrated assessment items plus the total matching row count.
   */
  async findMany(
    criteria: AssessmentListCriteria,
  ): Promise<AssessmentListResult> {
    const where: Prisma.AssessmentWhereInput = {
      organizationId: criteria.organizationId,
      ...(criteria.ownerId ? { ownerId: criteria.ownerId } : {}),
      ...(criteria.assessmentId ? { id: criteria.assessmentId } : {}),
      ...(criteria.status
        ? { status: toPrismaAssessmentStatus(criteria.status) }
        : {}),
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
      organizationId: record.organizationId,
      ownerId: record.ownerId,
      name: record.name,
      description: record.description,
      status: fromPrismaAssessmentStatus(record.status),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
