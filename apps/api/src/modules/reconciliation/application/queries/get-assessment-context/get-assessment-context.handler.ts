import {
  ASSESSMENT_ERROR_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  type AssessmentContextAnswerField,
  type AssessmentContextResponse,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import type { WizardAnswer } from "@lcsp/contracts/wizard";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaWizardStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetAssessmentContextQuery } from "./get-assessment-context.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:wizard-context-v1";
const LIMITATION_CODES = {
  profileNotSubmitted: "PROFILE_NOT_SUBMITTED",
  targetIdsUnavailable: "TARGET_IDS_UNAVAILABLE",
  answerFieldUnavailable: "ANSWER_FIELD_UNAVAILABLE",
} as const;

const ANSWER_FIELD_TO_QUESTION_ID: Record<
  AssessmentContextAnswerField,
  string | null
> = {
  [ASSESSMENT_CONTEXT_ANSWER_FIELDS.systemPurpose]: "businessProcess",
  [ASSESSMENT_CONTEXT_ANSWER_FIELDS.aiUsageType]: "externalLlmUsage",
  [ASSESSMENT_CONTEXT_ANSWER_FIELDS.providerDeclaration]: null,
  [ASSESSMENT_CONTEXT_ANSWER_FIELDS.humanReviewDeclaration]: "humanReview",
  [ASSESSMENT_CONTEXT_ANSWER_FIELDS.deploymentDeclaration]: "deploymentContext",
};

@QueryHandler(GetAssessmentContextQuery)
export class GetAssessmentContextHandler implements IQueryHandler<
  GetAssessmentContextQuery,
  AssessmentContextResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetAssessmentContextQuery,
  ): Promise<AssessmentContextResponse> {
    const profile = await this.prisma.wizardProfile.findFirst({
      where: {
        id: query.wizardProfileId,
        assessmentId: query.assessmentId,
        organizationId: query.organizationId,
      },
      select: {
        id: true,
        assessmentId: true,
        version: true,
        status: true,
        submittedAt: true,
        answers: true,
      },
    });

    if (!profile) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const status = fromPrismaWizardStatus(profile.status);
    if (status !== WIZARD_STATUS_CODES.submitted) {
      return this.writeAndReturn(
        query,
        profile.id,
        this.buildResponse(
          query,
          profile,
          status,
          AGENTIC_TOOL_STATUSES.needsInput,
          AGENTIC_TOOL_COVERAGE_STATES.unavailable,
          [LIMITATION_CODES.profileNotSubmitted],
          undefined,
          undefined,
        ),
      );
    }

    const includePinnedArtifacts = query.includes.includes(
      ASSESSMENT_CONTEXT_INCLUDES.pinnedArtifacts,
    );
    const includeSubmittedAnswers = query.includes.includes(
      ASSESSMENT_CONTEXT_INCLUDES.submittedAnswers,
    );
    const includeTargetIds = query.includes.includes(
      ASSESSMENT_CONTEXT_INCLUDES.targetIds,
    );

    const acceptedEvidenceReport = includePinnedArtifacts
      ? await this.prisma.technicalEvidenceReport.findFirst({
          where: {
            assessmentId: query.assessmentId,
            organizationId: query.organizationId,
            status: toPrismaEvidenceAcceptanceStatus(
              TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
            ),
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : null;

    const limitations: string[] = [];
    const answers = includeSubmittedAnswers
      ? mapAnswers(profile.answers, query.answerFields, limitations)
      : undefined;

    if (includeTargetIds) {
      limitations.push(LIMITATION_CODES.targetIdsUnavailable);
    }

    const unresolvedRequestedContext =
      includeTargetIds ||
      limitations.some(
        (limitation) =>
          limitation === LIMITATION_CODES.targetIdsUnavailable ||
          limitation.startsWith(`${LIMITATION_CODES.answerFieldUnavailable}:`),
      );

    const response = this.buildResponse(
      query,
      profile,
      status,
      unresolvedRequestedContext
        ? AGENTIC_TOOL_STATUSES.outOfCoverage
        : AGENTIC_TOOL_STATUSES.ready,
      limitations.length > 0
        ? AGENTIC_TOOL_COVERAGE_STATES.partial
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      limitations,
      answers,
      includePinnedArtifacts && acceptedEvidenceReport
        ? { technical_evidence_report_id: acceptedEvidenceReport.id }
        : includePinnedArtifacts
          ? {}
          : undefined,
    );

    return this.writeAndReturn(query, profile.id, response);
  }

  private buildResponse(
    query: GetAssessmentContextQuery,
    profile: {
      id: string;
      assessmentId: string;
      version: number;
      submittedAt: Date | null;
    },
    wizardStatus: string,
    status: AssessmentContextResponse["status"],
    coverageState: AssessmentContextResponse["coverage_state"],
    limitations: string[],
    answers?: Partial<Record<AssessmentContextAnswerField, string | boolean>>,
    artifactVersions?: { technical_evidence_report_id?: string },
  ): AssessmentContextResponse {
    return {
      status,
      tool_name: AGENTIC_TOOL_NAMES.getAssessmentContext,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlationId: query.correlationId,
      artifact_versions: {
        wizard_profile_id: profile.id,
        ...(artifactVersions ?? {}),
      },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: coverageState,
      evidence_refs: [`wizard:${profile.id}`],
      limitations,
      result: {
        wizard: {
          assessment_id: profile.assessmentId,
          profile_ref: `wizard:${profile.id}`,
          version: String(profile.version),
          status: wizardStatus,
          submitted_at: profile.submittedAt?.toISOString() ?? null,
          ...(answers ? { answers } : {}),
        },
        ...(artifactVersions ? { artifact_versions: artifactVersions } : {}),
      },
    };
  }

  private async writeAndReturn(
    query: GetAssessmentContextQuery,
    profileId: string,
    response: AssessmentContextResponse,
  ): Promise<AssessmentContextResponse> {
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.assessmentContextRead,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.wizardProfile,
      resourceId: profileId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        include: query.includes,
        answerFields: query.answerFields,
      },
    });

    return response;
  }
}

function mapAnswers(
  answers: unknown,
  fields: AssessmentContextAnswerField[],
  limitations: string[],
): Partial<Record<AssessmentContextAnswerField, string | boolean>> {
  const typedAnswers = Array.isArray(answers)
    ? answers.filter(isWizardAnswer)
    : [];
  const byQuestionId = new Map(
    typedAnswers.map((answer) => [answer.questionId, answer.value]),
  );
  const mapped: Partial<
    Record<AssessmentContextAnswerField, string | boolean>
  > = {};

  for (const field of fields) {
    const questionId = ANSWER_FIELD_TO_QUESTION_ID[field];
    if (!questionId) {
      limitations.push(`${LIMITATION_CODES.answerFieldUnavailable}:${field}`);
      continue;
    }
    const value = byQuestionId.get(questionId);
    const sanitized = sanitizeAnswerValue(value);
    if (sanitized === null) {
      continue;
    }
    mapped[field] = sanitized;
  }

  return mapped;
}

function isWizardAnswer(value: unknown): value is WizardAnswer {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return typeof Reflect.get(value, "questionId") === "string";
}

function sanitizeAnswerValue(value: unknown): string | boolean | null {
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || typeof item === "number")
  ) {
    return value.map((item) => String(item)).join(",");
  }
  return null;
}
