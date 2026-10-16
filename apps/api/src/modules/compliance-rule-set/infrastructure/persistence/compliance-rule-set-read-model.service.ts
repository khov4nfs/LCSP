import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  complianceRuleSetReadModelSchema,
  type ComplianceRuleSetReadModel,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { contractChunkIds } from "./compliance-rule-set.mappers.js";

/** Builds the validated read model of one stored rule set version. */
@Injectable()
export class ComplianceRuleSetReadModelLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    where: Prisma.ComplianceRuleSetVersionWhereInput,
    correlationId: string,
  ): Promise<ComplianceRuleSetReadModel> {
    const active = await this.prisma.complianceRuleSetVersion.findFirst({
      where,
      include: {
        rules: {
          orderBy: { ordinal: "asc" },
          include: { provenance: { orderBy: { ordinal: "asc" } } },
        },
        assessmentRules: {
          orderBy: { ordinal: "asc" },
          include: {
            legalRequirementLinks: {
              include: {
                legalRequirement: { select: { legalRequirementId: true } },
              },
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
        COMPLIANCE_RULE_SET_ERROR_CODES.activeRuleSetNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const ruleKeyById = new Map(
      active.rules.map((rule) => [rule.id, rule.legalRequirementId]),
    );
    const engineeringChunkIds = [
      ...new Set(
        active.assessmentRules.flatMap((rule) =>
          contractChunkIds(rule.contract),
        ),
      ),
    ];
    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: {
        id: { in: engineeringChunkIds },
        legalSourceVersionId: active.legalSourceVersionId,
      },
      select: {
        id: true,
        documentId: true,
        locator: true,
        contentSha256: true,
        legalEffectStatus: true,
        legalStatusSourceRef: true,
        sourceDocument: { select: { sourceEffectStatus: true } },
      },
    });
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    return complianceRuleSetReadModelSchema.parse({
      ruleSetVersionId: active.id,
      version: active.version,
      legalSourceVersionId: active.legalSourceVersionId,
      ruleSetDigest: active.ruleSetDigest,
      lifecycleState: active.lifecycleState,
      activatedAt: active.activatedAt?.toISOString() ?? null,
      legalRequirements: active.rules.map((rule) => ({
        legalRequirementId: rule.legalRequirementId,
        title: rule.title,
        proposition: rule.proposition,
        ...(rule.operativePropositions != null
          ? { operativePropositions: rule.operativePropositions }
          : {}),
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
          legalEffectStatus: p.legalEffectStatus,
          legalStatusSourceRef: p.legalStatusSourceRef,
        })),
      })),
      assessmentRules: active.assessmentRules.map((rule) => {
        const { sourceChunkIds: _ids, ...contract } = rule.contract as Record<
          string,
          unknown
        >;
        void _ids;
        return {
          ...contract,
          assessmentRuleId: rule.assessmentRuleId,
          assessmentRuleVersion: rule.assessmentRuleVersion,
          legalRequirementIds: rule.legalRequirementLinks
            .map((link) => link.legalRequirement.legalRequirementId)
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
                    legalEffectStatus: chunk.legalEffectStatus,
                    legalStatusSourceRef: chunk.legalStatusSourceRef,
                  },
                ]
              : [];
          }),
        };
      }),
      contextRelations: active.contextRelations.map((relation) => ({
        relationId: relation.relationId,
        kind: relation.kind,
        fromLegalRequirementId: ruleKeyById.get(relation.fromRuleId) ?? "",
        toLegalRequirementId: relation.toRuleId
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
