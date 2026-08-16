import { NotFoundException } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { EvidenceAcceptanceStatus } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { DocumentGenerationContextDto } from "../../contracts/document/document-generation-context.contract.js";
import { GetDocumentGenerationContextQuery } from "./get-document-generation-context.query.js";

/**
 * Resolves version-pinned document-generation inputs without performing report,
 * gap, remediation, or dossier processing in NestJS.
 */
@QueryHandler(GetDocumentGenerationContextQuery)
export class GetDocumentGenerationContextHandler implements IQueryHandler<GetDocumentGenerationContextQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: GetDocumentGenerationContextQuery,
  ): Promise<DocumentGenerationContextDto> {
    const documentRequest = await this.prisma.documentRequest.findUnique({
      where: { id: query.documentRequestId },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
        classificationResultId: true,
        documentType: true,
      },
    });
    if (!documentRequest) this.notFound("DocumentRequest");

    const [assessment, classification] = await Promise.all([
      this.prisma.assessment.findFirst({
        where: {
          id: documentRequest.assessmentId,
          organizationId: documentRequest.organizationId,
        },
        select: { id: true, name: true, description: true },
      }),
      this.prisma.classificationResult.findFirst({
        where: {
          id: documentRequest.classificationResultId,
          assessmentId: documentRequest.assessmentId,
          organizationId: documentRequest.organizationId,
          status: EvidenceAcceptanceStatus.ACCEPTED,
        },
        select: {
          id: true,
          verifiedProfileId: true,
          legalRuleMatchId: true,
          classificationData: true,
          guardrailStatus: true,
        },
      }),
    ]);
    if (!assessment) this.notFound("Assessment");
    if (
      !classification?.verifiedProfileId ||
      !classification.legalRuleMatchId
    ) {
      this.notFound("ClassificationResult");
    }

    const [verifiedProfile, legalRuleMatch] = await Promise.all([
      this.prisma.verifiedProfile.findFirst({
        where: {
          id: classification.verifiedProfileId,
          assessmentId: documentRequest.assessmentId,
          organizationId: documentRequest.organizationId,
        },
        select: {
          id: true,
          version: true,
          aiUsageFlowId: true,
          wizardProfileId: true,
          technicalEvidenceReportId: true,
          profileData: true,
        },
      }),
      this.prisma.legalRuleMatch.findFirst({
        where: {
          id: classification.legalRuleMatchId,
          assessmentId: documentRequest.assessmentId,
          organizationId: documentRequest.organizationId,
          status: EvidenceAcceptanceStatus.ACCEPTED,
        },
        select: {
          id: true,
          corpusVersionId: true,
          legalRuleCatalogVersionId: true,
          matches: true,
          citationAllowlist: true,
          overallCoverageStatus: true,
        },
      }),
    ]);
    if (!verifiedProfile) this.notFound("VerifiedProfile");
    if (!legalRuleMatch) this.notFound("LegalRuleMatch");

    const aiUsageFlow = await this.prisma.aIUsageFlow.findFirst({
      where: {
        id: verifiedProfile.aiUsageFlowId,
        assessmentId: documentRequest.assessmentId,
        organizationId: documentRequest.organizationId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: {
        id: true,
        technicalProfileId: true,
        claims: true,
        unknownUsages: true,
      },
    });
    if (!aiUsageFlow) this.notFound("AIUsageFlow");

    const technicalProfile = await this.prisma.technicalProfile.findFirst({
      where: {
        id: aiUsageFlow.technicalProfileId,
        assessmentId: documentRequest.assessmentId,
        organizationId: documentRequest.organizationId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: { id: true, evidenceReportId: true, profileData: true },
    });
    if (!technicalProfile) this.notFound("TechnicalProfile");

    const evidenceReportId =
      verifiedProfile.technicalEvidenceReportId ??
      technicalProfile.evidenceReportId;
    const technicalEvidenceReport =
      await this.prisma.technicalEvidenceReport.findFirst({
        where: {
          id: evidenceReportId,
          assessmentId: documentRequest.assessmentId,
          organizationId: documentRequest.organizationId,
          status: EvidenceAcceptanceStatus.ACCEPTED,
        },
        select: {
          id: true,
          snapshotId: true,
          schemaVersion: true,
          evidencePayload: true,
        },
      });
    if (!technicalEvidenceReport) this.notFound("TechnicalEvidenceReport");

    const repositorySnapshot = await this.prisma.repositorySnapshot.findFirst({
      where: {
        id: technicalEvidenceReport.snapshotId,
        assessmentId: documentRequest.assessmentId,
        organizationId: documentRequest.organizationId,
      },
      select: { id: true, commitSha: true },
    });
    if (!repositorySnapshot) this.notFound("RepositorySnapshot");

    const wizardProfile = verifiedProfile.wizardProfileId
      ? await this.prisma.wizardProfile.findFirst({
          where: {
            id: verifiedProfile.wizardProfileId,
            assessmentId: documentRequest.assessmentId,
            organizationId: documentRequest.organizationId,
          },
          select: { id: true, version: true, answers: true },
        })
      : await this.prisma.wizardProfile.findUnique({
          where: { assessmentId: documentRequest.assessmentId },
          select: { id: true, version: true, answers: true },
        });

    const conflicts = await this.prisma.conflictRecord.findMany({
      where: {
        aiUsageFlowId: aiUsageFlow.id,
        assessmentId: documentRequest.assessmentId,
        organizationId: documentRequest.organizationId,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        conflictType: true,
        conflictScore: true,
        evidenceRefs: true,
        status: true,
        resolvedAt: true,
      },
    });

    return {
      document_request: {
        id: documentRequest.id,
        assessment_id: documentRequest.assessmentId,
        organization_id: documentRequest.organizationId,
        classification_result_id: documentRequest.classificationResultId,
        document_type: String(documentRequest.documentType),
      },
      assessment: {
        id: assessment.id,
        name: assessment.name,
        description: assessment.description,
      },
      classification_result: {
        id: classification.id,
        verified_profile_id: classification.verifiedProfileId,
        legal_rule_match_id: classification.legalRuleMatchId,
        classification_data: classification.classificationData,
        guardrail_status: String(classification.guardrailStatus),
      },
      verified_profile: {
        id: verifiedProfile.id,
        version: verifiedProfile.version,
        ai_usage_flow_id: verifiedProfile.aiUsageFlowId,
        wizard_profile_id:
          verifiedProfile.wizardProfileId ?? wizardProfile?.id ?? null,
        technical_evidence_report_id: evidenceReportId,
        profile_data: verifiedProfile.profileData,
      },
      ai_usage_flow: {
        id: aiUsageFlow.id,
        technical_profile_id: aiUsageFlow.technicalProfileId,
        claims: aiUsageFlow.claims,
        unknown_usages: aiUsageFlow.unknownUsages,
      },
      technical_profile: {
        id: technicalProfile.id,
        evidence_report_id: technicalProfile.evidenceReportId,
        profile_data: technicalProfile.profileData,
      },
      technical_evidence_report: {
        id: technicalEvidenceReport.id,
        snapshot_id: technicalEvidenceReport.snapshotId,
        schema_version: technicalEvidenceReport.schemaVersion,
        evidence_payload: technicalEvidenceReport.evidencePayload,
      },
      repository_snapshot: {
        id: repositorySnapshot.id,
        commit_sha: repositorySnapshot.commitSha,
      },
      wizard_profile: wizardProfile
        ? {
            id: wizardProfile.id,
            version: wizardProfile.version,
            answers: wizardProfile.answers,
          }
        : null,
      legal_rule_match: {
        id: legalRuleMatch.id,
        corpus_version_id: legalRuleMatch.corpusVersionId,
        legal_rule_catalog_version_id: legalRuleMatch.legalRuleCatalogVersionId,
        matches: legalRuleMatch.matches,
        citation_allowlist: legalRuleMatch.citationAllowlist,
        overall_coverage_status: String(legalRuleMatch.overallCoverageStatus),
      },
      conflicts: conflicts.map((conflict) => ({
        id: conflict.id,
        conflict_type: conflict.conflictType,
        conflict_score: conflict.conflictScore,
        evidence_refs: conflict.evidenceRefs,
        status: String(conflict.status),
        resolved_at: conflict.resolvedAt?.toISOString() ?? null,
      })),
      matrix_ref: `matrix:${classification.id}`,
    };
  }

  private notFound(artifact: string): never {
    throw new NotFoundException(`${artifact} generation context not found`);
  }
}
