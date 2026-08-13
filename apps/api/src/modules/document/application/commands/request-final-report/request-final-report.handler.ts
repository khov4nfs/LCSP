import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_EVENT_TYPES,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
} from "@lcsp/contracts/document";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import { CLASSIFICATION_GUARDRAIL_STATUSES } from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import {
  fromPrismaClassificationGuardrailStatus,
  toPrismaDocumentRequestStatus,
  toPrismaDocumentType,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { FinalReportRequestDto } from "../../contracts/document/final-report-request.contract.js";
import { RequestFinalReportCommand } from "./request-final-report.command.js";

const DOCUMENT_REQUEST_LOCK_PREFIX = "document-final-report";

@CommandHandler(RequestFinalReportCommand)
export class RequestFinalReportHandler implements ICommandHandler<RequestFinalReportCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: RequestFinalReportCommand,
  ): Promise<FinalReportRequestDto> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: command.assessmentId },
      select: { id: true, organizationId: true },
    });

    if (!assessment || assessment.organizationId !== command.organizationId) {
      throw problemException(
        DOCUMENT_ERROR_CODES.assessmentNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const classificationResult =
      await this.prisma.classificationResult.findFirst({
        where: {
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          guardrailStatus: true,
        },
      });

    if (
      !classificationResult ||
      !hasPassedGuardrail(classificationResult.guardrailStatus)
    ) {
      throw problemException(
        DOCUMENT_ERROR_CODES.classificationGuardrailNotPassed,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const documentRequestId = await this.prisma.$transaction(async (tx) => {
      const lockKey = [
        DOCUMENT_REQUEST_LOCK_PREFIX,
        command.organizationId,
        command.assessmentId,
      ].join(":");

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
      `;

      const existingRequest = await tx.documentRequest.findFirst({
        where: {
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
          documentType: toPrismaDocumentType(DOCUMENT_TYPES.finalReport),
          status: {
            in: [
              toPrismaDocumentRequestStatus(DOCUMENT_REQUEST_STATUSES.queued),
              toPrismaDocumentRequestStatus(
                DOCUMENT_REQUEST_STATUSES.generating,
              ),
            ],
          },
        },
        select: { id: true },
      });

      if (existingRequest) {
        throw problemException(
          DOCUMENT_ERROR_CODES.alreadyQueued,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const created = await tx.documentRequest.create({
        data: {
          id: crypto.randomUUID(),
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
          requestedById: command.requestedById,
          classificationResultId: classificationResult.id,
          documentType: toPrismaDocumentType(DOCUMENT_TYPES.finalReport),
          status: toPrismaDocumentRequestStatus(
            DOCUMENT_REQUEST_STATUSES.queued,
          ),
          correlationId: command.correlationId,
        },
        select: { id: true },
      });

      return created.id;
    });

    await this.outboxRepository.enqueue({
      aggregateType: OUTBOX_AGGREGATE_TYPES.documentRequest,
      aggregateId: documentRequestId,
      eventType: DOCUMENT_EVENT_TYPES.finalReportRequested,
      payload: {
        documentRequestId,
        assessmentId: command.assessmentId,
        classificationResultId: classificationResult.id,
        correlationId: command.correlationId,
      },
    });

    await this.auditWriter.write({
      eventType: DOCUMENT_EVENT_TYPES.finalReportRequestedAudit,
      actorId: command.requestedById,
      organizationId: command.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.documentRequest,
      resourceId: documentRequestId,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        documentRequestId,
        assessmentId: command.assessmentId,
        classificationResultId: classificationResult.id,
        correlationId: command.correlationId,
      },
    });

    await this.auditWriter.write({
      eventType: DOCUMENT_EVENT_TYPES.finalReportRequestedAudit,
      actorId: command.requestedById,
      organizationId: command.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: command.assessmentId,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        documentRequestId,
        assessmentId: command.assessmentId,
        correlationId: command.correlationId,
      },
    });

    return {
      document_request_id: documentRequestId,
      status: DOCUMENT_REQUEST_STATUSES.queued,
      document_type: DOCUMENT_TYPES.finalReport,
      correlationId: command.correlationId,
    };
  }
}

function hasPassedGuardrail(
  status: Parameters<typeof fromPrismaClassificationGuardrailStatus>[0],
): boolean {
  return (
    fromPrismaClassificationGuardrailStatus(status) ===
    CLASSIFICATION_GUARDRAIL_STATUSES.passed
  );
}
