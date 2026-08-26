import { NotFoundException } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { EvidenceAcceptanceStatus } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { DocumentGenerationContextDto } from "../../contracts/document/document-generation-context.contract.js";
import { GetDocumentGenerationContextQuery } from "./get-document-generation-context.query.js";

/**
 * Resolve direct EngineeringRule assessment inputs for document generation.
 *
 * The canonical chain is ClassificationResult -> TechnicalEvidenceReport ->
 * RepositorySnapshot. Legacy TechnicalProfile, AIUsageFlow, VerifiedProfile and
 * LegalRuleMatch artifacts are intentionally not read here.
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
        classificationResultId: true,
        documentType: true,
      },
    });
    if (!documentRequest) this.notFound("DocumentRequest");

    const [assessment, classification] = await Promise.all([
      this.prisma.assessment.findFirst({
        where: {
          id: documentRequest.assessmentId,
        },
        select: { id: true, name: true, description: true },
      }),
      this.prisma.classificationResult.findFirst({
        where: {
          id: documentRequest.classificationResultId,
          assessmentId: documentRequest.assessmentId,
          status: EvidenceAcceptanceStatus.ACCEPTED,
        },
        select: {
          id: true,
          classificationData: true,
          guardrailStatus: true,
        },
      }),
    ]);
    if (!assessment) this.notFound("Assessment");
    if (!classification) this.notFound("ClassificationResult");

    const classificationData = isRecord(classification.classificationData)
      ? classification.classificationData
      : {};
    const evidenceReportId = cleanString(
      classificationData.technical_evidence_report_id,
    );
    if (!evidenceReportId) this.notFound("TechnicalEvidenceReport");

    const technicalEvidenceReport =
      await this.prisma.technicalEvidenceReport.findFirst({
        where: {
          id: evidenceReportId,
          assessmentId: documentRequest.assessmentId,
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

    const [repositorySnapshot, wizardProfile] = await Promise.all([
      this.prisma.repositorySnapshot.findFirst({
        where: {
          id: technicalEvidenceReport.snapshotId,
          assessmentId: documentRequest.assessmentId,
        },
        select: { id: true, commitSha: true },
      }),
      this.prisma.wizardProfile.findUnique({
        where: { assessmentId: documentRequest.assessmentId },
        select: { id: true, version: true, answers: true },
      }),
    ]);
    if (!repositorySnapshot) this.notFound("RepositorySnapshot");

    return {
      document_request: {
        id: documentRequest.id,
        assessment_id: documentRequest.assessmentId,
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
        technical_evidence_report_id: technicalEvidenceReport.id,
        classification_data: classification.classificationData,
        guardrail_status: String(classification.guardrailStatus),
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
      matrix_ref: `engineering-matrix:${classification.id}`,
    };
  }

  private notFound(artifact: string): never {
    throw new NotFoundException(`${artifact} generation context not found`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
