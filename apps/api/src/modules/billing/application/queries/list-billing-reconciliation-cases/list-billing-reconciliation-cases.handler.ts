/**
 * Rationale ("Why"): Enables Admin queue visualization of unresolved or in-review reconciliation cases.
 * Mechanism ("How"): Reads BillingReconciliationCase rows with linked BillableInvocationAdmission details.
 * Invariants & Constraints: Read-only query; strictly maps Prisma rows to canonical contract schemas.
 */

import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { Injectable } from "@nestjs/common";
import type {
  BillingReconciliationCaseItem,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { ListBillingReconciliationCasesQuery } from "./list-billing-reconciliation-cases.query.js";

@Injectable()
@QueryHandler(ListBillingReconciliationCasesQuery)
export class ListBillingReconciliationCasesHandler
  implements
    IQueryHandler<
      ListBillingReconciliationCasesQuery,
      { items: BillingReconciliationCaseItem[]; total: number; page: number; pageSize: number }
    >
{
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Retrieve a paginated list of BillingReconciliationCase records for Admin review.
   *
   * Business rules:
   * - Caller must be an authenticated administrator.
   * - Supports filtering by reconciliation state and provider.
   * - Default page is 1, default pageSize is 20 (max 100).
   * - Results are ordered by createdAt descending (most recent first).
   *
   * Execution flow:
   * 1. Build Prisma where clause based on optional state and provider filters.
   * 2. Query total count matching filter.
   * 3. Query paginated records including linked BillableInvocationAdmission.
   * 4. Map records to canonical BillingReconciliationCaseItem contracts.
   * 5. Return paginated result envelope.
   *
   * Failure cases:
   * - Throws if database query fails.
   *
   * Side effects:
   * - Pure read query; no database state mutations.
   */
  async execute(
    query: ListBillingReconciliationCasesQuery,
  ): Promise<{ items: BillingReconciliationCaseItem[]; total: number; page: number; pageSize: number }> {
    const { state, provider, page = 1, pageSize = 20 } = query.query;

    const where: Record<string, unknown> = {};
    if (state) {
      where.state = state;
    }
    if (provider) {
      where.provider = provider;
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [total, records] = await Promise.all([
      this.prisma.billingReconciliationCase.count({ where }),
      this.prisma.billingReconciliationCase.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          admission: {
            select: {
              walletId: true,
              userId: true,
              maximumExposureMicrocredits: true,
              state: true,
              admittedAt: true,
              consumedAt: true,
              expiresAt: true,
            },
          },
        },
      }),
    ]);

    const items: BillingReconciliationCaseItem[] = records.map((r) => ({
      caseId: r.caseId,
      invocationId: r.invocationId,
      admissionId: r.admissionId,
      state: r.state,
      provider: r.provider,
      providerCorrelationId: r.providerCorrelationId,
      providerLogArtifactId: r.providerLogArtifactId,
      coverageStart: r.coverageStart?.toISOString() ?? null,
      coverageEnd: r.coverageEnd?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedBy,
      auditRationale: r.auditRationale,
      conflictDetectedAt: r.conflictDetectedAt?.toISOString() ?? null,
      hasConflictingPayload: r.conflictingPayload !== null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      admission: {
        walletId: r.admission.walletId,
        userId: r.admission.userId,
        maximumExposureMicrocredits: r.admission.maximumExposureMicrocredits.toString(),
        state: r.admission.state,
        admittedAt: r.admission.admittedAt.toISOString(),
        consumedAt: r.admission.consumedAt?.toISOString() ?? null,
        expiresAt: r.admission.expiresAt.toISOString(),
      },
    }));

    return { items, total, page, pageSize };
  }
}
