import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
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
  CLASSIFICATION_RESULT_STATUSES,
  CLASSIFICATION_RERUN_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";

import {
  fromPrismaEvidenceAcceptanceStatus,
  fromPrismaLegalRuleMatchGuardrailStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
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
    const legalRuleMatch = await this.prisma.legalRuleMatch.findFirst({
      where: {
        assessmentId: command.assessmentId,
        organizationId: command.pbacContext.organizationId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        guardrailStatus: true,
        status: true,
      },
    });

    if (
      !legalRuleMatch ||
      fromPrismaEvidenceAcceptanceStatus(legalRuleMatch.status) !==
        LEGAL_RULE_MATCH_STATUSES.accepted
    ) {
      throw problemException(
        SCAN_ERROR_CODES.legalRuleMatchNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    if (
      fromPrismaLegalRuleMatchGuardrailStatus(
        legalRuleMatch.guardrailStatus,
      ) !== LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed
    ) {
      throw problemException(
        SCAN_ERROR_CODES.legalRuleMatchNotFound,
        command.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const existingResult = await this.prisma.classificationResult.findFirst({
      where: {
        legalRuleMatchId: legalRuleMatch.id,
        assessmentId: command.assessmentId,
        organizationId: command.pbacContext.organizationId,
      },
      select: { id: true, status: true },
    });

    if (
      existingResult &&
      fromPrismaEvidenceAcceptanceStatus(existingResult.status) ===
        CLASSIFICATION_RESULT_STATUSES.accepted
    ) {
      throw problemException(
        SCAN_ERROR_CODES.resultAlreadyExists,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const event = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.legalRuleMatch,
      aggregateId: legalRuleMatch.id,
      eventType: SCAN_EVENT_TYPES.legalRuleMatchReady,
      organizationId: command.pbacContext.organizationId,
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      actor: { id: command.pbacContext.userId, type: AUDIT_ACTOR_TYPES.user },
      result: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      authorizationAction: PBAC_ACTIONS.classificationRun,
      idempotencyKey: `${legalRuleMatch.id}:${command.correlationId}`,
      payload: {
        legalRuleMatchId: legalRuleMatch.id,
        assessmentId: command.assessmentId,
        guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
        correlationId: command.correlationId,
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
          resourceType: AUDIT_RESOURCE_TYPES.legalRuleMatch,
          resourceId: legalRuleMatch.id,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: SCAN_EVENT_TYPES.classificationRerunTriggeredAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: { reason: command.reason },
        },
        tx,
      );
    });

    return {
      legal_rule_match_id: legalRuleMatch.id,
      status: CLASSIFICATION_RERUN_STATUSES.queued,
      correlation_id: command.correlationId,
    };
  }
}
