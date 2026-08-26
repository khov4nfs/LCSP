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
import * as crypto from "node:crypto";

import {
  fromPrismaClassificationGuardrailStatus,
  toPrismaDocumentRequestStatus,
  toPrismaDocumentType,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { RequestGapAnalysisCommand } from "./request-gap-analysis.command.js";

const DOCUMENT_REQUEST_LOCK_PREFIX = "document-gap-analysis";

/**
 * Queues gap-analysis generation after classification is present and guardrails pass, while preventing duplicate active requests.
 */
@CommandHandler(RequestGapAnalysisCommand)
export class RequestGapAnalysisHandler implements ICommandHandler<RequestGapAnalysisCommand> {
  /**
   * Creates the handler with persistence, outbox, and audit dependencies.
   *
   * @param prisma - Prisma service used for assessment/classification checks and transactional request creation.
   * @param outboxRepository - Outbox used to dispatch gap-analysis generation work.
   * @param auditWriter - Audit writer used to record document and assessment-level request events.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Validates assessment/classification readiness, reserves one active request, then publishes and audits the generation request.
   *
   * @param command - Assessment, requester, and correlation context for the gap-analysis request.
   * @returns Queued gap-analysis document request metadata.
   * @throws When the assessment/classification is unavailable, guardrails have not passed, or an active request already exists.
   */
  async execute(command: RequestGapAnalysisCommand): Promise<{
    document_request_id: string;
    status: string;
    document_type: string;
    correlationId: string;
  }> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: command.assessmentId },
      select: { id: true },
    });

    if (!assessment) {
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
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          guardrailStatus: true,
        },
      });

    if (!classificationResult) {
      throw problemException(
        DOCUMENT_ERROR_CODES.classificationRequired,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    if (!hasPassedGuardrail(classificationResult.guardrailStatus)) {
      throw problemException(
        DOCUMENT_ERROR_CODES.classificationGuardrailNotPassed,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const documentRequestId = await this.prisma.$transaction(async (tx) => {
      const lockKey = [DOCUMENT_REQUEST_LOCK_PREFIX, command.assessmentId].join(
        ":",
      );

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
      `;

      const existingRequest = await tx.documentRequest.findFirst({
        where: {
          assessmentId: command.assessmentId,
          documentType: toPrismaDocumentType(DOCUMENT_TYPES.gapAnalysis),
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
          requestedById: command.requestedById,
          classificationResultId: classificationResult.id,
          documentType: toPrismaDocumentType(DOCUMENT_TYPES.gapAnalysis),
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
      eventType: DOCUMENT_EVENT_TYPES.gapAnalysisRequested,
      payload: {
        documentRequestId,
        assessmentId: command.assessmentId,
        classificationResultId: classificationResult.id,
        correlationId: command.correlationId,
      },
    });

    await this.auditWriter.write({
      eventType: DOCUMENT_EVENT_TYPES.gapAnalysisRequestedAudit,
      actorId: command.requestedById,
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
      eventType: DOCUMENT_EVENT_TYPES.gapAnalysisRequestedAudit,
      actorId: command.requestedById,
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
      document_type: DOCUMENT_TYPES.gapAnalysis,
      correlationId: command.correlationId,
    };
  }
}

/**
 * Checks whether a persisted classification guardrail status resolves to the passed contract state.
 *
 * @param status - Prisma classification guardrail status to normalize.
 * @returns True when gap-analysis generation is permitted by the classification guardrail.
 */
function hasPassedGuardrail(
  status: Parameters<typeof fromPrismaClassificationGuardrailStatus>[0],
): boolean {
  return (
    fromPrismaClassificationGuardrailStatus(status) ===
    CLASSIFICATION_GUARDRAIL_STATUSES.passed
  );
}
