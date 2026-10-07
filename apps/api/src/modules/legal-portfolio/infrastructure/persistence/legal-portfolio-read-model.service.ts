import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  legalPortfolioReadModelSchema,
  type LegalPortfolioReadModel,
} from "@lcsp/contracts/legal-portfolio";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { contractChunkIds } from "./legal-portfolio.mappers.js";

/** Builds the validated read model of one stored portfolio version. */
@Injectable()
export class LegalPortfolioReadModelLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    where: Prisma.LegalPortfolioVersionWhereInput,
    correlationId: string,
  ): Promise<LegalPortfolioReadModel> {
    const active = await this.prisma.legalPortfolioVersion.findFirst({
      where,
      include: {
        rules: {
          orderBy: { ordinal: "asc" },
          include: { provenance: { orderBy: { ordinal: "asc" } } },
        },
        engineeringRules: {
          orderBy: { ordinal: "asc" },
          include: {
            legalRuleLinks: {
              include: { legalRule: { select: { legalRuleId: true } } },
            },
          },
        },
        contextRelations: {
          orderBy: { ordinal: "asc" },
          include: {
            toChunk: {
              select: { documentId: true, locator: true, contentSha256: true },
            },
          },
        },
      },
    });
    if (!active) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.activePortfolioNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const ruleKeyById = new Map(
      active.rules.map((rule) => [rule.id, rule.legalRuleId]),
    );
    const engineeringChunkIds = [
      ...new Set(
        active.engineeringRules.flatMap((rule) =>
          contractChunkIds(rule.contract),
        ),
      ),
    ];
    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: {
        id: { in: engineeringChunkIds },
        legalCorpusVersionId: active.legalCorpusVersionId,
      },
      select: {
        id: true,
        documentId: true,
        locator: true,
        contentSha256: true,
        sourceDocument: { select: { sourceEffectStatus: true } },
      },
    });
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    return legalPortfolioReadModelSchema.parse({
      portfolioVersionId: active.id,
      version: active.version,
      legalCorpusVersionId: active.legalCorpusVersionId,
      portfolioDigest: active.portfolioDigest,
      lifecycleState: active.lifecycleState,
      activatedAt: active.activatedAt?.toISOString() ?? null,
      legalRules: active.rules.map((rule) => ({
        legalRuleId: rule.legalRuleId,
        title: rule.title,
        proposition: rule.proposition,
        applicabilityConditions: rule.applicabilityConditions,
        qualifiers: rule.qualifiers,
        exceptions: rule.exceptions,
        nonRepositoryDuty: rule.nonRepositoryDuty,
        coverage: {
          state: rule.coverageState,
          nonAssessableReason: rule.nonAssessableReason,
        },
        sources: rule.provenance.map((p) => ({
          chunkId: p.chunkId,
          documentId: p.documentId,
          locator: p.locator,
          contentSha256: p.contentSha256,
          sourceEffectStatus: p.sourceEffectStatus,
        })),
      })),
      engineeringRules: active.engineeringRules.map((rule) => {
        const { sourceChunkIds: _ids, ...contract } = rule.contract as Record<
          string,
          unknown
        >;
        void _ids;
        return {
          ...contract,
          engineeringRuleId: rule.engineeringRuleId,
          engineeringRuleVersion: rule.engineeringRuleVersion,
          legalRuleIds: rule.legalRuleLinks
            .map((link) => link.legalRule.legalRuleId)
            .sort(),
          concept: rule.concept,
          legalIntent: rule.legalIntent,
          applicabilityGuidance: rule.applicabilityGuidance,
          criteria: rule.criteria,
          sourceFingerprint: rule.sourceFingerprint,
          sources: contractChunkIds(rule.contract).flatMap((id) => {
            const chunk = chunkById.get(id);
            return chunk
              ? [
                  {
                    chunkId: chunk.id,
                    documentId: chunk.documentId,
                    locator: chunk.locator,
                    contentSha256: chunk.contentSha256,
                    sourceEffectStatus: chunk.sourceDocument.sourceEffectStatus,
                  },
                ]
              : [];
          }),
        };
      }),
      contextRelations: active.contextRelations.map((relation) => ({
        relationId: relation.relationId,
        kind: relation.kind,
        fromLegalRuleId: ruleKeyById.get(relation.fromRuleId) ?? "",
        toLegalRuleId: relation.toRuleId
          ? (ruleKeyById.get(relation.toRuleId) ?? null)
          : null,
        toSourceRef: relation.toChunk
          ? {
              documentId: relation.toChunk.documentId,
              locator: relation.toChunk.locator,
              contentSha256: relation.toChunk.contentSha256,
            }
          : null,
      })),
    });
  }
}
