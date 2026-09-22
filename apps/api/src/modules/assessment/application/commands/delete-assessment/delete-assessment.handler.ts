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
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  ASSESSMENT_BILLING_RETENTION,
  type AssessmentBillingRetentionPort,
} from "../../ports/billing/assessment-billing-retention.port.js";
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
    @Inject(ASSESSMENT_BILLING_RETENTION)
    private readonly billingRetention: AssessmentBillingRetentionPort,
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

    // Credit reserved for this assessment is returned before the record goes
    // away; the reservation can no longer be released once its assessment link
    // is cleared, so the wallet would hold the credit forever.
    const releasedReservations =
      await this.billingRetention.releaseActiveReservations({
        assessmentId: assessment.id,
        userId: assessment.ownerId,
      });

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
          payload: {
            assessmentId: assessment.id,
            releasedReservations,
          },
        },
        tx,
      );
      // Billing records outlive the assessment as financial history, so the
      // database refuses to cascade them. Detaching keeps the record and lets
      // the assessment go.
      await this.billingRetention.detachAssessment(assessment.id, tx);
      await tx.assessment.delete({ where: { id: assessment.id } });
    });

    return { assessment_id: assessment.id, deleted: true };
  }
}
