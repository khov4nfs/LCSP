import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LOCK_REASONS,
  ASSESSMENT_MISSING_EVIDENCE_CODES,
  ASSESSMENT_NEXT_ACTION_KEYS,
  WIZARD_STATUS_CODES,
  type AssessmentNextActionKey,
} from "@lcsp/contracts/assessment";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  CLASSIFICATION_RESULT_STATUSES,
  ENGINEERING_RULE_EVALUATION_STATUSES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  type EngineeringRuleEvaluationStatus,
} from "@lcsp/contracts/scan";
import { HttpStatus, Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaClassificationGuardrailStatus,
  fromPrismaWizardStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  AssessmentDetailDto,
  ClassificationResultSummaryDto,
  EngineeringRuleEvaluationDto,
  ReadinessState,
  WizardStatus,
} from "../../contracts/assessment/assessment-detail.contract.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import { resolveLegalProvisionDisplays } from "../../services/legal-provision-display.js";
import { resolveTechnicalEvidenceDisplays } from "../../services/technical-evidence-display.js";
import { GetAssessmentQuery } from "./get-assessment.query.js";

/**
 * Build the canonical direct assessment read model.
 *
 * Runtime state is now RepositoryScan -> TechnicalEvidenceReport ->
 * EngineeringRule evaluation -> ClassificationResult. Historical profile,
 * reconciliation and LegalRuleMatch artifacts are deliberately excluded.
 */
@QueryHandler(GetAssessmentQuery)
export class GetAssessmentHandler implements IQueryHandler<GetAssessmentQuery> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessmentRepository: AssessmentRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(query: GetAssessmentQuery): Promise<AssessmentDetailDto> {
    const assessment = await this.assessmentRepository.findById(
      query.assessmentId,
    );

    if (!assessment || assessment.organizationId !== query.organizationId) {
      this.throwNotFound(query.correlationId);
    }
    if (
      query.subjectRole === SUBJECT_ROLES.manager &&
      assessment.ownerId !== query.sessionUserId
    ) {
      this.throwNotFound(query.correlationId);
    }

    const wizardProfile = await this.prisma.wizardProfile.findUnique({
      where: { assessmentId: assessment.id },
    });
    const wizardStatus: WizardStatus = wizardProfile
      ? fromPrismaWizardStatus(wizardProfile.status)
      : WIZARD_STATUS_CODES.notStarted;

    const acceptedEvidenceReport =
      await this.prisma.technicalEvidenceReport.findFirst({
        where: {
          assessmentId: assessment.id,
          organizationId: assessment.organizationId,
          status: toPrismaEvidenceAcceptanceStatus(
            TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
          ),
        },
        select: { id: true, evidencePayload: true },
        orderBy: { createdAt: "desc" },
      });

    const classificationResult = acceptedEvidenceReport
      ? await this.prisma.classificationResult.findFirst({
          where: {
            assessmentId: assessment.id,
            organizationId: assessment.organizationId,
            status: toPrismaEvidenceAcceptanceStatus(
              CLASSIFICATION_RESULT_STATUSES.accepted,
            ),
          },
          select: {
            guardrailStatus: true,
            classificationData: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : null;

    const legalChunks = classificationResult
      ? await this.loadLegalChunks(classificationResult.classificationData)
      : [];

    const readinessState: ReadinessState = !acceptedEvidenceReport
      ? {
          classification_locked: true,
          lock_reason: ASSESSMENT_LOCK_REASONS.evidenceRequired,
          missing_evidence: [
            ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
          ],
        }
      : {
          classification_locked: false,
          lock_reason: null,
          missing_evidence: [],
        };

    return {
      assessment_id: assessment.id,
      name: assessment.name,
      status: assessment.status,
      owner_id: assessment.ownerId,
      organization_id: assessment.organizationId,
      wizard_status: wizardStatus,
      readiness_state: readinessState,
      guardrail_status: classificationResult
        ? fromPrismaClassificationGuardrailStatus(
            classificationResult.guardrailStatus,
          )
        : null,
      classification_result: classificationResult
        ? toClassificationResultSummary(
            classificationResult.classificationData,
            acceptedEvidenceReport?.evidencePayload,
            legalChunks,
          )
        : null,
      legal_rule_match_guardrail_status: null,
      legal_rule_match_diagnostics: null,
      verified_profile_review: null,
      can_rerun_classification: acceptedEvidenceReport !== null,
      next_action: nextActionFor(wizardStatus),
      created_at: assessment.createdAt.toISOString(),
      updated_at: assessment.updatedAt.toISOString(),
      correlationId: query.correlationId,
    };
  }

  private async loadLegalChunks(classificationData: unknown) {
    const data = isRecord(classificationData) ? classificationData : {};
    const corpusVersionId = cleanString(data.legal_corpus_version_id);
    const sourceChunkIds = collectSourceChunkIds(data.evaluations);
    if (!corpusVersionId || sourceChunkIds.length === 0) return [];

    return this.prisma.legalDocumentChunk.findMany({
      where: {
        legalCorpusVersionId: corpusVersionId,
        id: { in: sourceChunkIds },
      },
      select: {
        id: true,
        documentId: true,
        locator: true,
        content: true,
        hierarchy: true,
      },
    });
  }

  private throwNotFound(correlationId: string): never {
    throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
}

function nextActionFor(wizardStatus: WizardStatus): AssessmentNextActionKey {
  switch (wizardStatus) {
    case WIZARD_STATUS_CODES.notStarted:
      return ASSESSMENT_NEXT_ACTION_KEYS.wizardNotStarted;
    case WIZARD_STATUS_CODES.inProgress:
      return ASSESSMENT_NEXT_ACTION_KEYS.wizardInProgress;
    case WIZARD_STATUS_CODES.submitted:
      return ASSESSMENT_NEXT_ACTION_KEYS.wizardSubmitted;
    default:
      return ASSESSMENT_NEXT_ACTION_KEYS.wizardInProgress;
  }
}

type LegalChunkDisplaySource = {
  id: string;
  documentId: string;
  locator: string;
  content: string;
  hierarchy: unknown;
};

function toClassificationResultSummary(
  value: unknown,
  evidencePayload: unknown,
  legalChunks: LegalChunkDisplaySource[],
): ClassificationResultSummaryDto {
  const data = isRecord(value) ? value : {};
  const summary = isRecord(data.summary) ? data.summary : {};
  return {
    mode: cleanString(data.mode),
    status: cleanString(data.status),
    engineering_summary: {
      compliant: nonNegativeInteger(summary.compliant) ?? 0,
      non_compliant: nonNegativeInteger(summary.non_compliant) ?? 0,
      unknown: nonNegativeInteger(summary.unknown) ?? 0,
      total: nonNegativeInteger(summary.total) ?? 0,
    },
    evaluations: recordArray(data.evaluations)
      .map((item) =>
        toEngineeringRuleEvaluation(item, evidencePayload, legalChunks),
      )
      .filter((item): item is EngineeringRuleEvaluationDto => item !== null),
    limitations: stringArray(data.limitations),
    legal_rule_catalog_version_id: cleanString(
      data.legal_rule_catalog_version_id,
    ),
    legal_corpus_version_id: cleanString(data.legal_corpus_version_id),
    technical_evidence_report_id: cleanString(
      data.technical_evidence_report_id,
    ),
    snapshot_id: cleanString(data.snapshot_id),
    risk_level: null,
    applicability_assessment: null,
    citation_basis: [],
    rationale: null,
  };
}

function toEngineeringRuleEvaluation(
  value: Record<string, unknown>,
  evidencePayload: unknown,
  legalChunks: LegalChunkDisplaySource[],
): EngineeringRuleEvaluationDto | null {
  const status = cleanString(value.status)?.toUpperCase();
  if (
    !status ||
    !Object.values(ENGINEERING_RULE_EVALUATION_STATUSES).includes(
      status as EngineeringRuleEvaluationStatus,
    )
  ) {
    return null;
  }
  const engineeringRuleId = cleanString(value.engineering_rule_id);
  if (!engineeringRuleId) return null;

  const evidenceRefs = stringArray(value.evidence_refs);
  const sourceChunkIds = stringArray(value.source_chunk_ids);
  return {
    engineering_rule_id: engineeringRuleId,
    legal_rule_id: cleanString(value.legal_rule_id) ?? "",
    concept: cleanString(value.concept) ?? "UNKNOWN",
    status: status as EngineeringRuleEvaluationStatus,
    reason: cleanString(value.reason) ?? "",
    evidence_refs: evidenceRefs,
    technical_evidence: resolveTechnicalEvidenceDisplays(
      evidencePayload,
      evidenceRefs,
      value.technical_evidence,
    ),
    source_chunk_ids: sourceChunkIds,
    source_locators: stringArray(value.source_locators),
    legal_provisions: resolveLegalProvisionDisplays(
      sourceChunkIds,
      legalChunks,
    ),
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : 0,
    limitations: stringArray(value.limitations),
  };
}

function collectSourceChunkIds(value: unknown): string[] {
  const ids = new Set<string>();
  for (const evaluation of recordArray(value)) {
    for (const id of stringArray(evaluation.source_chunk_ids)) ids.add(id);
  }
  return Array.from(ids);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
