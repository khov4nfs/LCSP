import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  complianceRuleSetResultSchema,
  type ComplianceRuleSetResult,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { ComplianceRuleSetReadModelLoader } from "../../../infrastructure/persistence/compliance-rule-set-read-model.service.js";
import { GetComplianceRuleSetResultQuery } from "./get-compliance-rule-set-result.query.js";

/**
 * Admin read of one stored Rule Set version, including INVALID, ACTIVE and SUPERSEDED results,
 * with the Legal Source Version it was prepared from. Rows are read, never written.
 */
@QueryHandler(GetComplianceRuleSetResultQuery)
export class GetComplianceRuleSetResultHandler implements IQueryHandler<GetComplianceRuleSetResultQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readModel: ComplianceRuleSetReadModelLoader,
  ) {}

  /**
   * Business purpose: Return the stored Rule Set result with the source version from which it was prepared.
   *
   * Business rules:
   * - The query addresses one stored Rule Set version by ID, including failed INVALID results and later-superseded versions.
   * - Returned Rule Set and Legal Source data must satisfy the shared result contract.
   * - This query reads persisted history and does not change active authority.
   *
   * Execution flow:
   * 1. Load the requested version's Preparation and Legal Source summary.
   * 2. Load its validated Rule Set read model and map source document counts and lifecycle timestamps.
   * 3. Parse and return the complete result against the public schema.
   *
   * Failure cases:
   * - An unknown version returns the Rule Set not-found problem; read-model or contract validation errors propagate.
   *
   * Side effects:
   * - None beyond database reads; no Rule Set, audit, or lifecycle records are written.
   */
  async execute(
    input: GetComplianceRuleSetResultQuery,
  ): Promise<ComplianceRuleSetResult> {
    const row = await this.prisma.complianceRuleSetVersion.findUnique({
      where: { id: input.ruleSetVersionId },
      select: {
        id: true,
        preparationRunId: true,
        createdAt: true,
        supersededAt: true,
        legalSourceVersion: {
          select: {
            id: true,
            version: true,
            documents: {
              orderBy: { documentId: "asc" },
              select: {
                documentId: true,
                title: true,
                sourceEffectStatus: true,
                _count: { select: { chunks: true } },
              },
            },
          },
        },
      },
    });
    if (!row) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.ruleSetNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const ruleSet = await this.readModel.load(
      { id: row.id },
      input.correlationId,
    );
    return complianceRuleSetResultSchema.parse({
      ruleSet,
      preparationRunId: row.preparationRunId,
      createdAt: row.createdAt.toISOString(),
      supersededAt: row.supersededAt?.toISOString() ?? null,
      legalSourceVersion: {
        legalSourceVersionId: row.legalSourceVersion.id,
        version: row.legalSourceVersion.version,
        documents: row.legalSourceVersion.documents.map((document) => ({
          documentId: document.documentId,
          title: document.title,
          sourceEffectStatus: document.sourceEffectStatus,
          chunkCount: document._count.chunks,
        })),
      },
    });
  }
}
