import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
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
  DeleteAssessmentCommand,
  type DeleteAssessmentDto,
} from "./delete-assessment.command.js";

@CommandHandler(DeleteAssessmentCommand)
export class DeleteAssessmentHandler implements ICommandHandler<DeleteAssessmentCommand> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: DeleteAssessmentCommand,
  ): Promise<DeleteAssessmentDto> {
    const assessment = await this.assessments.findById(command.assessmentId);
    if (!assessment || assessment.ownerId !== command.actorId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.auditWriter.writeInTx(
        {
          eventType: ASSESSMENT_EVENT_TYPES.deleted,
          actorId: command.actorId,
          assessmentId: assessment.id,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: assessment.id,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: ASSESSMENT_EVENT_TYPES.deleted,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: { assessmentId: assessment.id },
        },
        tx,
      );
      await tx.assessment.delete({ where: { id: assessment.id } });
    });

    return { assessment_id: assessment.id, deleted: true };
  }
}
