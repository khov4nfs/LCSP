import {
  AUDIT_ACTOR_IDS,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  buildAuditEventInput,
} from "@lcsp/contracts/audit";
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_EVENT_TYPES,
} from "@lcsp/contracts/document";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";
import * as crypto from "node:crypto";

import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
  toPrismaDocumentRequestStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  DocumentCallbackDto,
  DocumentCallbackRequest,
} from "../../contracts/document/document-callback.contract.js";
import { ProcessDocumentCallbackCommand } from "./process-document-callback.command.js";

/**
 * Applies worker document-generation callbacks to persisted requests and records the resulting audit event.
 */
@CommandHandler(ProcessDocumentCallbackCommand)
export class ProcessDocumentCallbackHandler implements ICommandHandler<ProcessDocumentCallbackCommand> {
  /**
   * Creates the callback handler with document persistence and audit dependencies.
   *
   * @param prisma - Prisma service used to locate/update document requests and persist the callback audit event.
   * @param auditWriter - Audit writer dependency available for document audit flows.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Resolves the target document request, applies worker status/output fields, and writes an audit record.
   *
   * @param command - Worker callback payload and fallback correlation identifier.
   * @returns Callback acknowledgement containing the processed document request identifier.
   * @throws A document-not-found problem when the callback references an unknown request.
   */
  async execute(
    command: ProcessDocumentCallbackCommand,
  ): Promise<DocumentCallbackDto> {
    const payload = command.payload as DocumentCallbackRequest;
    const request = await this.prisma.documentRequest.findUnique({
      where: { id: payload.document_request_id },
      select: {
        id: true,
        assessmentId: true,
        correlationId: true,
      },
    });

    if (!request) {
      throw problemException(
        DOCUMENT_ERROR_CODES.documentNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const updateData: Prisma.DocumentRequestUpdateInput = {
      status: toPrismaDocumentRequestStatus(payload.status),
    };

    if (payload.document_url) {
      updateData.documentUrl = payload.document_url;
    }
    if (payload.blocked_reason) {
      updateData.blockedReason = payload.blocked_reason;
    }

    await this.prisma.documentRequest.update({
      where: { id: payload.document_request_id },
      data: updateData,
    });

    const auditEvent = buildAuditEventInput({
      eventType: DOCUMENT_EVENT_TYPES.gapAnalysisRequestedAudit,
      actorId: AUDIT_ACTOR_IDS.documentWorker,
      assessmentId: request.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.documentRequest,
      resourceId: request.id,
      correlationId: request.correlationId ?? command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: DOCUMENT_EVENT_TYPES.gapAnalysisRequestedAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      payload: payload as unknown as Record<string, unknown>,
    });

    await this.prisma.auditEvent.create({
      data: {
        id: crypto.randomUUID(),
        eventType: auditEvent.eventType,
        actorId: auditEvent.actorId,
        resourceType: auditEvent.resourceType
          ? toPrismaAuditResourceType(auditEvent.resourceType)
          : null,
        resourceId: auditEvent.resourceId ?? null,
        correlationId: auditEvent.correlationId,
        reasonCode: auditEvent.reasonCode ?? null,
        decision: auditEvent.decision
          ? toPrismaAuthDecision(auditEvent.decision)
          : null,
        payload: auditEvent.payload as Prisma.InputJsonValue,
      },
    });

    return {
      processed: true,
      document_request_id: payload.document_request_id,
      correlationId: request.correlationId ?? command.correlationId,
    };
  }
}
