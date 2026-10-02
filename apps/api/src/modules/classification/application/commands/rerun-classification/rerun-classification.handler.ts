import { randomUUID } from "node:crypto";
import { ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS } from "@lcsp/contracts/evidence";
import { OutboxStatus, Prisma } from "@prisma/client";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
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
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
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
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      causationId: evidenceReport.id,
      actor: {
        id: command.rbacContext.userId,
        type: command.actorType,
      },
      result: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: `${evidenceReport.id}:engineering-assessment-rerun:${randomUUID()}`,
      payload: {
        evidenceReportId: evidenceReport.id,
        technicalEvidenceReportId: evidenceReport.id,
        assessmentId: command.assessmentId,
        snapshotId: evidenceReport.snapshotId,
        scanJobId: evidenceReport.scanJobId,
        correlationId: command.correlationId,
        rerun: true,
        rerunReason: command.reason ?? null,
      },
    });

    const dispatchCorrelationId = await this.prisma.$transaction(async (tx) => {
      // Serialize check-and-enqueue across API instances, including the first
      // dispatch when there is no outbox row yet to lock.
      const dispatchScope = JSON.stringify([
        evidenceReport.id,
        command.reason ?? null,
      ]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dispatchScope}))`;
      const cutoff = new Date(
        Date.now() - ASSESSMENT_PIPELINE_LIVENESS_WINDOW_SECONDS * 1000,
      );
      const recent = await tx.outboxMessage.findFirst({
        where: {
          aggregateId: evidenceReport.id,
          eventType: SCAN_EVENT_TYPES.evidenceAccepted,
          AND: [
            { payload: { path: ["rerun"], equals: true } },
            {
              payload: {
                path: ["rerunReason"],
                equals: command.reason ?? Prisma.JsonNull,
              },
            },
          ],
          OR: [
            { status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] } },
            { status: OutboxStatus.PUBLISHED, publishedAt: { gt: cutoff } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      });
      if (recent && !command.afterCustomerStop) {
        const payload = recent.payload as { correlationId?: string };
        return payload.correlationId ?? command.correlationId;
      }
      await this.outboxRepository.enqueue(event, tx);
      await this.auditWriter.writeInTx(
        {
          eventType: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
          actorId: command.rbacContext.userId,
          actor: {
            id: command.rbacContext.userId,
            type: command.actorType,
          },
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
      return command.correlationId;
    });

    return {
      technical_evidence_report_id: evidenceReport.id,
      status: CLASSIFICATION_RERUN_STATUSES.queued,
      correlationId: dispatchCorrelationId,
    };
  }
}
