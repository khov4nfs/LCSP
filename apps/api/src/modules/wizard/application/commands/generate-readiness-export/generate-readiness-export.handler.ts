import * as crypto from "node:crypto";

import { WIZARD_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import {
  READINESS_CLASSIFICATION_STATUSES,
  READINESS_EXPORT_ARTIFACT_TYPES,
  READINESS_EXPORT_ERROR_CODES,
  READINESS_EXPORT_STATUSES,
  WIZARD_EVENT_TYPES,
  type WizardAnswer,
} from "@lcsp/contracts/wizard";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import {
  fromPrismaWizardStatus,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaReadinessExportStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AssessmentNotFoundException } from "../../../domain/exceptions/wizard.exceptions.js";
import type {
  ReadinessExportContent,
  ReadinessExportResponse,
} from "../../contracts/wizard/readiness-export.contract.js";
import { ReadinessEvaluatorService } from "../../services/wizard/readiness-evaluator.service.js";
import { ReadinessExportGuardrailService } from "../../services/wizard/readiness-export-guardrail.service.js";
import { GenerateReadinessExportCommand } from "./generate-readiness-export.command.js";

const READINESS_EXPORT_LABEL = "Wizard Readiness Export";

@CommandHandler(GenerateReadinessExportCommand)
export class GenerateReadinessExportHandler implements ICommandHandler<
  GenerateReadinessExportCommand,
  ReadinessExportResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly readinessEvaluator: ReadinessEvaluatorService,
    private readonly guardrail: ReadinessExportGuardrailService,
  ) {}

  async execute(
    command: GenerateReadinessExportCommand,
  ): Promise<ReadinessExportResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: command.assessmentId,
        ownerId: command.ownerId,
      },
      select: {
        id: true,
        ownerId: true,
        name: true,
        description: true,
      },
    });
    if (!assessment) {
      throw new AssessmentNotFoundException(command.correlationId);
    }

    const [
      wizardProfile,
      repositorySnapshot,
      technicalEvidence,
      latest,
      owner,
    ] = await Promise.all([
      this.prisma.wizardProfile.findUnique({
        where: { assessmentId: command.assessmentId },
        select: {
          id: true,
          version: true,
          status: true,
          answers: true,
        },
      }),
      this.prisma.repositorySnapshot.findFirst({
        where: { assessmentId: command.assessmentId },
        select: { id: true },
      }),
      this.prisma.technicalEvidenceReport.findFirst({
        where: {
          assessmentId: command.assessmentId,
          status: toPrismaEvidenceAcceptanceStatus(
            TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
          ),
        },
        select: { id: true },
      }),
      this.prisma.readinessExport.findFirst({
        where: { assessmentId: command.assessmentId },
        orderBy: { version: "desc" },
        select: { version: true },
      }),
      this.prisma.user.findUnique({
        where: { id: command.ownerId },
        select: { displayName: true, email: true },
      }),
    ]);

    if (!wizardProfile) {
      throw problemException(
        READINESS_EXPORT_ERROR_CODES.wizardNotSubmitted,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const wizardStatus = fromPrismaWizardStatus(wizardProfile.status);
    if (wizardStatus !== WIZARD_STATUS_CODES.submitted) {
      throw problemException(
        READINESS_EXPORT_ERROR_CODES.wizardNotSubmitted,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    if (technicalEvidence) {
      throw problemException(
        READINESS_EXPORT_ERROR_CODES.requiresLockedClassification,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const version = (latest?.version ?? 0) + 1;
    const generatedAt = new Date();
    const readiness = this.readinessEvaluator.evaluate({
      hasRepositoryConnection: !!repositorySnapshot,
      hasAcceptedTechnicalEvidence: false,
      wizardStatus,
      wizardAnswers: Array.isArray(wizardProfile.answers)
        ? (wizardProfile.answers as WizardAnswer[])
        : [],
    });
    const wizardAnswers = Array.isArray(wizardProfile.answers)
      ? (wizardProfile.answers as WizardAnswer[])
      : [];
    const content = this.buildContent(
      command,
      wizardProfile.version,
      version,
      generatedAt,
      wizardAnswers,
      readiness.missing_evidence,
      readiness.unresolved_unknown_items.map((item) => item.label),
      readiness.next_action,
      assessment.name,
      assessment.description,
      undefined,
      owner?.displayName ?? owner?.email,
    );
    const guardrailResult = this.guardrail.check(content);
    const status = guardrailResult.passed
      ? READINESS_EXPORT_STATUSES.generated
      : READINESS_EXPORT_STATUSES.blocked;
    const exportId = crypto.randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.readinessExport.create({
        data: {
          id: exportId,
          assessmentId: command.assessmentId,
          ownerId: command.ownerId,
          version,
          status: toPrismaReadinessExportStatus(status),
          contentJson: guardrailResult.passed
            ? (content as unknown as Prisma.InputJsonValue)
            : undefined,
          blockedReason: guardrailResult.blockedReason,
          generatedAt,
        },
      });

      await this.auditWriter.writeInTx(
        {
          eventType: guardrailResult.passed
            ? WIZARD_EVENT_TYPES.readinessExportGenerated
            : WIZARD_EVENT_TYPES.readinessExportBlocked,
          actorId: command.ownerId,
          resourceType: AUDIT_RESOURCE_TYPES.readinessExport,
          resourceId: exportId,
          assessmentId: command.assessmentId,
          decision: guardrailResult.passed
            ? AUDIT_DECISIONS.allow
            : AUDIT_DECISIONS.deny,
          reasonCode: guardrailResult.blockedReason,
          correlationId: command.correlationId,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            exportId,
            assessmentId: command.assessmentId,
            status,
            version,
            correlationId: command.correlationId,
            ...(guardrailResult.blockedReason
              ? { blockedReason: guardrailResult.blockedReason }
              : {}),
          },
        },
        tx,
      );
    });

    return {
      export_id: exportId,
      assessment_id: command.assessmentId,
      owner_id: command.ownerId,
      status,
      label: READINESS_EXPORT_LABEL,
      artifact_type: READINESS_EXPORT_ARTIFACT_TYPES.wizardReadinessExport,
      readiness_only: true,
      classification_status:
        READINESS_CLASSIFICATION_STATUSES.lockedEvidenceRequired,
      classification_locked: true,
      generated_at: generatedAt.toISOString(),
      version,
      correlationId: command.correlationId,
      ...(guardrailResult.passed
        ? {
            missing_evidence: content.missing_evidence,
            unresolved_unknowns: content.unresolved_unknowns,
            preparation_guidance: content.preparation_guidance,
            media_type: "application/pdf" as const,
            file_name: `wizard-readiness-export-v${version}.pdf`,
            download_url: `/assessments/${command.assessmentId}/wizard/readiness-exports/${exportId}/download`,
          }
        : {}),
      ...(guardrailResult.blockedReason
        ? { blocked_reason: guardrailResult.blockedReason }
        : {}),
    };
  }

  private buildContent(
    command: GenerateReadinessExportCommand,
    wizardProfileVersion: number,
    version: number,
    generatedAt: Date,
    wizardAnswers: WizardAnswer[],
    missingEvidence: ReadinessExportContent["missing_evidence"],
    unresolvedUnknowns: string[],
    nextAction: string,
    assessmentName: string,
    assessmentDescription: string | null,
    organizationName: string | undefined,
    ownerDisplayName: string | undefined,
  ): ReadinessExportContent {
    return {
      label: READINESS_EXPORT_LABEL,
      badge: "READINESS_ONLY",
      title: READINESS_EXPORT_LABEL,
      preview:
        "Readiness-only preparation summary for evidence collection and next steps.",
      metadata: {
        artifact_type: READINESS_EXPORT_ARTIFACT_TYPES.wizardReadinessExport,
        label: READINESS_EXPORT_LABEL,
        readiness_only: true,
        classification_status:
          READINESS_CLASSIFICATION_STATUSES.lockedEvidenceRequired,
        assessment_id: command.assessmentId,
        assessment_name: assessmentName,
        ...(assessmentDescription
          ? { assessment_description: assessmentDescription }
          : {}),
        ...(organizationName ? { organization_name: organizationName } : {}),
        ...(ownerDisplayName ? { owner_display_name: ownerDisplayName } : {}),
        wizard_profile_version: wizardProfileVersion,
        owner_id: command.ownerId,
        generated_by: command.ownerId,
        version,
        generated_at: generatedAt.toISOString(),
      },
      missing_evidence: missingEvidence,
      unresolved_unknowns: unresolvedUnknowns,
      wizard_profile: {
        sections: buildWizardProfileSections(wizardAnswers),
      },
      preparation_guidance: [
        "Keep the wizard answers current while technical evidence is collected.",
        "Resolve unknown items before requesting downstream evaluation.",
        nextAction,
      ],
      next_steps: [
        "Connect the repository if it is not connected.",
        "Run the technical evidence scan when repository access is ready.",
        "Review unresolved unknown items with the assessment owner.",
      ],
    };
  }
}

type WizardSectionDefinition = {
  title: string;
  fields: Array<readonly [questionId: string, label: string]>;
};

const WIZARD_SECTION_DEFINITIONS: WizardSectionDefinition[] = [
  {
    title: "Pre-screen",
    fields: [
      ["ps_001_ai_scope", "AI system scope"],
      ["ps_002_affected_people", "Affected people"],
      ["ps_003_personal_or_sensitive_data", "Personal or sensitive data"],
      ["ps_004_decision_importance", "Decision importance"],
    ],
  },
  {
    title: "Purpose and context",
    fields: [
      ["businessProcess", "Business process"],
      ["aiPurpose", "AI purpose"],
      ["purpose", "Purpose"],
      ["sector", "Sector"],
    ],
  },
  {
    title: "Data and affected groups",
    fields: [
      ["dataTypes", "Data types"],
      ["affectedSubjects", "Affected subjects"],
      ["userImpact", "User impact"],
    ],
  },
  {
    title: "Decision support and oversight",
    fields: [
      ["decisionRole", "Decision support role"],
      ["humanReview", "Human review"],
    ],
  },
  {
    title: "Provider and deployment",
    fields: [
      ["externalLlmUsage", "External provider usage"],
      ["deploymentContext", "Deployment context"],
    ],
  },
  {
    title: "Signal review",
    fields: [
      ["specialCategoryData", "Special-category data"],
      ["biometricData", "Biometric data"],
      ["highImpactIndicators", "Impact indicators"],
      ["transparencyIndicators", "Transparency indicators"],
      ["prohibitedRiskSignals", "Prohibited signals"],
    ],
  },
];

const VALUE_LABELS = new Map<string, string>([
  ["yes", "Yes"],
  ["no", "No"],
  ["unknown", "Unknown"],
  ["UNKNOWN", "Unknown"],
  ["UNCLEAR", "Unclear"],
  ["GENERAL_BUSINESS", "General business"],
  ["EMPLOYMENT_HR", "Employment and HR"],
  ["FINANCE_CREDIT", "Finance and credit"],
  ["EDUCATION", "Education"],
  ["HEALTHCARE", "Healthcare"],
  ["PUBLIC_SERVICES", "Public services"],
  ["CUSTOMERS", "Customers"],
  ["EMPLOYEES", "Employees"],
  ["APPLICANTS", "Applicants"],
  ["STUDENTS", "Students"],
  ["PATIENTS", "Patients"],
  ["LOW", "Limited impact"],
  ["MODERATE", "Moderate impact"],
  ["SIGNIFICANT", "Significant impact"],
  ["NO_DECISION_SUPPORT", "No decision support"],
  ["ASSISTS_DECISION", "Assists a decision"],
  ["INFORMS_DECISION", "Informs a decision"],
  ["RECOMMENDS_OUTCOME", "Recommends an outcome"],
  ["DIRECTLY_DRIVES_OUTCOME", "Directly drives an outcome"],
  ["PRESENT", "Present"],
  ["LIMITED", "Limited"],
  ["ABSENT", "Absent"],
  ["NOT_APPLICABLE", "Not applicable"],
  ["NONE", "None"],
  ["POSSIBLE", "Possible"],
  ["CONFIRMED", "Confirmed"],
]);

function buildWizardProfileSections(
  answers: WizardAnswer[],
): ReadinessExportContent["wizard_profile"]["sections"] {
  const answerByQuestionId = new Map<string, WizardAnswer>(
    answers.map((answer) => [answer.questionId, answer]),
  );

  const knownQuestionIds = new Set<string>();
  const sections: ReadinessExportContent["wizard_profile"]["sections"] =
    WIZARD_SECTION_DEFINITIONS.map((section) => {
      const renderedAnswers = section.fields.map((field) => {
        const [questionId, label] = field;
        knownQuestionIds.add(questionId);
        const answer = answerByQuestionId.get(questionId);
        return renderWizardAnswer(questionId, label, answer);
      });

      return {
        title: section.title,
        answers: renderedAnswers,
      };
    });

  const additionalAnswers = answers
    .filter((answer) => !knownQuestionIds.has(answer.questionId))
    .map((answer) =>
      renderWizardAnswer(
        answer.questionId,
        humanizeQuestionId(answer.questionId),
        answer,
      ),
    );

  if (additionalAnswers.length > 0) {
    sections.push({
      title: "Additional wizard answers",
      answers: additionalAnswers,
    });
  }

  return sections;
}

function renderWizardAnswer(
  questionId: string,
  label: string,
  answer: WizardAnswer | undefined,
): ReadinessExportContent["wizard_profile"]["sections"][number]["answers"][number] {
  return {
    question_id: questionId,
    label,
    value: answer ? formatAnswerValue(answer.value) : "Not answered",
    answer_state: answer?.answerState ?? "NOT_ANSWERED",
    selected_values: answer ? formatAnswerValues(answer.value) : [],
    updated_at: answer?.updatedAt ?? "",
  };
}

function formatAnswerValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(formatAnswerValue);
  }
  if (value === null || value === undefined || value === "") {
    return [];
  }
  return [formatAnswerValue(value)];
}

function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(formatAnswerValue).join(", ") : "None";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return VALUE_LABELS.get(value) ?? value;
  }

  return JSON.stringify(value);
}

function humanizeQuestionId(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
