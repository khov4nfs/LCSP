import { HttpStatus, Inject } from "@nestjs/common";
import { QueryHandler } from "@nestjs/cqrs";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import type { IQueryHandler } from "@nestjs/cqrs";

import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LOCK_REASONS,
  ASSESSMENT_MISSING_EVIDENCE_CODES,
  ASSESSMENT_NEXT_ACTION_KEYS,
  WIZARD_STATUS_CODES,
  type AssessmentNextActionKey,
} from "@lcsp/contracts/assessment";
import {
  CLASSIFICATION_RESULT_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_STATUSES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
} from "@lcsp/contracts/scan";
import {
  fromPrismaClassificationGuardrailStatus,
  fromPrismaVerifiedProfileStatus,
  fromPrismaWizardStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import type {
  AssessmentDetailDto,
  ClassificationResultSummaryDto,
  ReadinessState,
  VerifiedProfileReviewDto,
  WizardStatus,
} from "../../contracts/assessment/assessment-detail.contract.js";
import { GetAssessmentQuery } from "./get-assessment.query.js";

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
        select: { id: true },
      });

    const readinessState: ReadinessState = acceptedEvidenceReport
      ? {
          classification_locked: false,
          lock_reason: null,
          missing_evidence: [],
        }
      : {
          classification_locked: true,
          lock_reason: ASSESSMENT_LOCK_REASONS.evidenceRequired,
          missing_evidence: [
            ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
          ],
        };

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

    const verifiedProfileReview =
      query.subjectRole === SUBJECT_ROLES.manager
        ? await this.prisma.verifiedProfile.findFirst({
            where: {
              assessmentId: assessment.id,
              organizationId: assessment.organizationId,
            },
            select: {
              id: true,
              status: true,
              providerVersion: true,
              profileData: true,
              gatesPassedAt: true,
              createdAt: true,
              approvedAt: true,
              approvedById: true,
            },
            orderBy: { createdAt: "desc" },
          })
        : null;

    const rerunnableLegalRuleMatch =
      acceptedEvidenceReport && !classificationResult
        ? await this.prisma.legalRuleMatch.findFirst({
            where: {
              assessmentId: assessment.id,
              organizationId: assessment.organizationId,
              status: toPrismaEvidenceAcceptanceStatus(
                LEGAL_RULE_MATCH_STATUSES.accepted,
              ),
              guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
            },
            select: { id: true },
            orderBy: { createdAt: "desc" },
          })
        : null;

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
        ? toClassificationResultSummary(classificationResult.classificationData)
        : null,
      verified_profile_review: verifiedProfileReview
        ? toVerifiedProfileReview(verifiedProfileReview)
        : null,
      can_rerun_classification: rerunnableLegalRuleMatch !== null,
      next_action: nextActionFor(wizardStatus),
      created_at: assessment.createdAt.toISOString(),
      updated_at: assessment.updatedAt.toISOString(),
      correlation_id: query.correlationId,
    };
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

function toClassificationResultSummary(
  value: unknown,
): ClassificationResultSummaryDto {
  if (!isRecord(value)) {
    return {
      risk_level: null,
      applicability_assessment: null,
      citation_basis: [],
      rationale: null,
    };
  }

  return {
    risk_level: cleanString(value.risk_level),
    applicability_assessment: cleanString(value.applicability_assessment),
    citation_basis: stringArray(value.citation_basis),
    rationale: cleanString(value.rationale),
  };
}

function toVerifiedProfileReview(profile: {
  id: string;
  status: Parameters<typeof fromPrismaVerifiedProfileStatus>[0];
  providerVersion: string;
  profileData: unknown;
  gatesPassedAt: unknown;
  createdAt: Date;
  approvedAt: Date | null;
  approvedById: string | null;
}): VerifiedProfileReviewDto {
  const data = isRecord(profile.profileData) ? profile.profileData : {};
  return {
    verified_profile_id: profile.id,
    status: fromPrismaVerifiedProfileStatus(profile.status),
    provider_version: profile.providerVersion,
    verified_claims: recordArray(data.verified_claims),
    verification_source: cleanString(data.verification_source),
    wizard_context: isRecord(data.wizard_context) ? data.wizard_context : null,
    conflict_resolutions: recordArray(data.conflict_resolutions),
    gates_passed_at: isRecord(profile.gatesPassedAt)
      ? profile.gatesPassedAt
      : isRecord(data.gates_passed_at)
        ? data.gates_passed_at
        : {},
    evidence_chain_integrity:
      typeof data.evidence_chain_integrity === "boolean"
        ? data.evidence_chain_integrity
        : null,
    created_at: profile.createdAt.toISOString(),
    approved_at: profile.approvedAt?.toISOString() ?? null,
    approved_by_id: profile.approvedById,
  };
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
