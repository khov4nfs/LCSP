import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import {
  CLASSIFICATION_RERUN_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
} from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { toPrismaEvidenceAcceptanceStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { RerunClassificationResponseDto } from "../../contracts/classification/rerun-classification.contract.js";
import { RerunClassificationCommand } from "./rerun-classification.command.js";

@CommandHandler(RerunClassificationCommand)
export class RerunClassificationHandler implements ICommandHandler<RerunClassificationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: RerunClassificationCommand,
  ): Promise<RerunClassificationResponseDto> {
    const evidenceReport = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        assessmentId: command.assessmentId,
        organizationId: command.pbacContext.organizationId,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        ),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        snapshotId: true,
        scanJobId: true,
      },
    });

    if (!evidenceReport) {
      throw problemException(
        SCAN_ERROR_CODES.evidenceReportNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const event = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.technicalEvidenceReport,
      aggregateId: evidenceReport.id,
      eventType: SCAN_EVENT_TYPES.evidenceAccepted,
      organizationId: command.pbacContext.organizationId,
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      causationId: evidenceReport.id,
      actor: {
        id: command.pbacContext.userId,
        type: AUDIT_ACTOR_TYPES.user,
      },
      result: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      authorizationAction: PBAC_ACTIONS.classificationRun,
      idempotencyKey: `${evidenceReport.id}:${command.correlationId}:engineering-assessment-rerun`,
      payload: {
        evidenceReportId: evidenceReport.id,
        technicalEvidenceReportId: evidenceReport.id,
        assessmentId: command.assessmentId,
        snapshotId: evidenceReport.snapshotId,
        scanJobId: evidenceReport.scanJobId,
        correlationId: command.correlationId,
        rerun: true,
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.outboxRepository.enqueue(event, tx);
      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
          actorId: command.pbacContext.userId,
          organizationId: command.pbacContext.organizationId,
          assessmentId: command.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.technicalEvidenceReport,
          resourceId: evidenceReport.id,
          correlationId: command.correlationId,
          causationId: evidenceReport.id,
          decision: AUDIT_DECISIONS.allow,
          result: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            reason: command.reason,
            technicalEvidenceReportId: evidenceReport.id,
            snapshotId: evidenceReport.snapshotId,
          },
        },
        tx,
      );
    });

    return {
      technical_evidence_report_id: evidenceReport.id,
      status: CLASSIFICATION_RERUN_STATUSES.queued,
      correlationId: command.correlationId,
    };
  }
}
