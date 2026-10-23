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
 * Admin read of one stored rule set version of any lifecycle that was ever published (ACTIVE or
 * SUPERSEDED), with the Legal Source Version it was prepared from. Rows are read, never written.
 */
@QueryHandler(GetComplianceRuleSetResultQuery)
export class GetComplianceRuleSetResultHandler implements IQueryHandler<GetComplianceRuleSetResultQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readModel: ComplianceRuleSetReadModelLoader,
  ) {}

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
