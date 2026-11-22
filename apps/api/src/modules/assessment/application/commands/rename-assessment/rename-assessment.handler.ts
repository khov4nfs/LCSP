import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_NAME_MAX_LENGTH,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import {
  RenameAssessmentCommand,
  type RenameAssessmentDto,
} from "./rename-assessment.command.js";

@CommandHandler(RenameAssessmentCommand)
export class RenameAssessmentHandler implements ICommandHandler<RenameAssessmentCommand> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Renames an assessment and persists the audit trail.
   *
   * Business purpose:
   * Allows the assessment owner to update the human-readable display name of their assessment.
   *
   * Business rules:
   * - Actor must be the owner of the assessment.
   * - Name must be non-empty and not exceed maximum permitted length.
   * - If the new name is identical to the current name, no-op return.
   * - Audit trail must record both previous and new names for traceability.
   *
   * Execution flow:
   * 1. Validate trimmed name is non-empty and within bounds.
   * 2. Find assessment and verify actor is the owner.
   * 3. Return early if name is unchanged.
   * 4. Capture previous name, update assessment entity name.
   * 5. In database transaction: save updated assessment and write audit event with fromName and toName.
   * 6. Return response containing updated name.
   *
   * Failure cases:
   * - Missing or oversized name: throws UNPROCESSABLE_ENTITY with INVALID_REQUEST.
   * - Assessment not found or unauthorized actor: throws NOT_FOUND with ASSESSMENT_NOT_FOUND.
   *
   * Side effects:
   * - Persists updated assessment entity to database.
   * - Writes immutable audit event recording fromName and toName.
   */
  async execute(
    command: RenameAssessmentCommand,
  ): Promise<RenameAssessmentDto> {
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (!name || name.length > ASSESSMENT_NAME_MAX_LENGTH) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const assessment = await this.assessments.findById(command.assessmentId);
    if (!assessment || assessment.ownerId !== command.actorId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    if (assessment.name === name) {
      return { assessment_id: assessment.id, name: assessment.name };
    }

    // Capture previous name before entity mutation for forensic audit trail
    const previousName = assessment.name;
    assessment.rename(name);
    await this.prisma.$transaction(async (tx) => {
      await this.assessments.saveInTx(assessment, tx);
      // Explanatory comment:
      // Audit payload must preserve both previous and new names (fromName, toName) for compliance traceability and forensic auditability.
      await this.auditWriter.writeInTx(
        {
          eventType: ASSESSMENT_EVENT_TYPES.renamed,
          actorId: command.actorId,
          assessmentId: assessment.id,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: assessment.id,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: ASSESSMENT_EVENT_TYPES.renamed,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            assessmentId: assessment.id,
            fromName: previousName,
            toName: name,
          },
        },
        tx,
      );
    });

    return { assessment_id: assessment.id, name: assessment.name };
  }
}
