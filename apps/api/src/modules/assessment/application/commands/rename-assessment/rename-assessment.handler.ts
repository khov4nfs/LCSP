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
import { problemException } from "../../../../../platform/problems/problem-factory.js";
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

    assessment.rename(name);
    await this.prisma.$transaction(async (tx) => {
      await this.assessments.saveInTx(assessment, tx);
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
          payload: { assessmentId: assessment.id },
        },
        tx,
      );
    });

    return { assessment_id: assessment.id, name: assessment.name };
  }
}
