import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import { provesAiAbsence } from "./ai-absence-evidence.js";
import {
  MarkAiNotDetectedCommand,
  type MarkAiNotDetectedDto,
} from "./mark-ai-not-detected.command.js";

/**
 * Ends an assessment as "AI not detected" when its latest accepted evidence proves absence.
 */
@CommandHandler(MarkAiNotDetectedCommand)
export class MarkAiNotDetectedHandler implements ICommandHandler<MarkAiNotDetectedCommand> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Validates the worker's evidence reference server side, then records the terminal status.
   *
   * @param command - Assessment, evidence report reference, and correlation identifier.
   * @returns The assessment identifier, terminal status, and evidence report identifier.
   * @throws When the request is malformed, the assessment is missing, the report is not the
   * latest accepted absence proof, or the assessment lifecycle cannot end this way.
   */
  async execute(
    command: MarkAiNotDetectedCommand,
  ): Promise<MarkAiNotDetectedDto> {
    const reportId =
      typeof command.technicalEvidenceReportId === "string"
        ? command.technicalEvidenceReportId.trim()
        : "";
    if (!reportId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        command.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        },
      );
    }

    const assessment = await this.assessments.findById(command.assessmentId);
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }
    const result = {
      assessment_id: assessment.id,
      status: ASSESSMENT_STATUS_CODES.aiNotDetected,
      technical_evidence_report_id: reportId,
    };
    if (assessment.status === ASSESSMENT_STATUS_CODES.aiNotDetected) {
      return result;
    }

    // Only the latest accepted report may end the assessment; a stale or foreign
    // report must not override newer evidence.
    const latest = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        assessmentId: assessment.id,
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, evidencePayload: true },
    });
    if (
      !latest ||
      latest.id !== reportId ||
      !provesAiAbsence(latest.evidencePayload)
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.aiAbsenceNotProven,
        command.correlationId,
        {
          status: HttpStatus.CONFLICT,
        },
      );
    }

    try {
      assessment.markAiNotDetected();
    } catch {
      throw problemException(
        ASSESSMENT_ERROR_CODES.aiNotDetectedStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.assessments.saveInTx(assessment, tx);
      await this.auditWriter.writeInTx(
        {
          eventType: ASSESSMENT_EVENT_TYPES.aiNotDetected,
          actorId: null,
          assessmentId: assessment.id,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: assessment.id,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: ASSESSMENT_EVENT_TYPES.aiNotDetected,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            assessmentId: assessment.id,
            technicalEvidenceReportId: reportId,
          },
        },
        tx,
      );
    });
    return result;
  }
}
