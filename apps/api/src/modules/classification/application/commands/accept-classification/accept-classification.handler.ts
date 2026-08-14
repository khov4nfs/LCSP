import * as crypto from "node:crypto";

import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { ASSESSMENT_RUNTIME_STAGE_CODES } from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_SCHEMA_VERSIONS,
  CLASSIFICATION_RESULT_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
  type ClassificationGuardrailStatus,
} from "@lcsp/contracts/scan";
import {
  ConflictException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import {
  fromPrismaLegalRuleMatchGuardrailStatus,
  toPrismaClassificationGuardrailStatus,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaVerifiedProfileStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { ClassificationResultCallbackResponseDto } from "../../contracts/classification/classification-result-callback.contract.js";
import { OverclaimGuardrailService } from "../../services/classification/overclaim-guardrail.service.js";
import { AcceptClassificationCommand } from "./accept-classification.command.js";

const CLASSIFICATION_WORKER_ACTOR_ID =
  AUDIT_ACTOR_IDS.classificationResultWorker;

@CommandHandler(AcceptClassificationCommand)
export class AcceptClassificationHandler implements ICommandHandler<AcceptClassificationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outboxRepository: OutboxRepository,
    private readonly overclaimGuardrail: OverclaimGuardrailService,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
  ) {}

  async execute(
    command: AcceptClassificationCommand,
  ): Promise<ClassificationResultCallbackResponseDto> {
    this.validate(command);

    const payload = command.payload;
    const correlationId = command.correlationId ?? payload.assessment_id;

    this.overclaimGuardrail.validate(
      payload.classification_data,
      correlationId,
    );

    const verifiedProfile = await this.prisma.verifiedProfile.findFirst({
      where: {
        id: payload.verified_profile_id,
        assessmentId: payload.assessment_id,
        status: toPrismaVerifiedProfileStatus(
          VERIFIED_PROFILE_STATUSES.approved,
        ),
      },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
      },
    });

    if (!verifiedProfile) {
      throw new NotFoundException(
        this.errorBody(command, SCAN_ERROR_CODES.verifiedProfileNotFound),
      );
    }

    const legalRuleMatch = await this.prisma.legalRuleMatch.findFirst({
      where: {
        id: payload.legal_rule_match_id,
        assessmentId: payload.assessment_id,
        verifiedProfileId: payload.verified_profile_id,
      },
      select: {
        id: true,
        assessmentId: true,
        guardrailStatus: true,
      },
    });

    if (!legalRuleMatch) {
      throw new NotFoundException(
        this.errorBody(command, SCAN_ERROR_CODES.legalRuleMatchNotFound),
      );
    }

    if (
      fromPrismaLegalRuleMatchGuardrailStatus(
        legalRuleMatch.guardrailStatus,
      ) === LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.legalRuleMatchNotFound),
      );
    }

    const existingResult = await this.prisma.classificationResult.findUnique({
      where: { legalRuleMatchId: payload.legal_rule_match_id },
      select: { id: true },
    });

    if (existingResult) {
      throw new ConflictException(
        this.errorBody(command, SCAN_ERROR_CODES.resultAlreadyExists),
      );
    }

    const classificationResultId = crypto.randomUUID();
    const guardrailStatus = payload.guardrail_status;
    const isBlocked =
      guardrailStatus === CLASSIFICATION_GUARDRAIL_STATUSES.blocked;
    const blockedReason =
      isBlocked ? "CITATION_BASIS_MISSING" : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.classificationResult.create({
        data: {
          id: classificationResultId,
          legalRuleMatchId: payload.legal_rule_match_id,
          verifiedProfileId: payload.verified_profile_id,
          assessmentId: payload.assessment_id,
          organizationId: verifiedProfile.organizationId,
          schemaVersion: payload.schema_version,
          classificationData:
            payload.classification_data as Prisma.InputJsonValue,
          guardrailStatus:
            toPrismaClassificationGuardrailStatus(guardrailStatus),
          blockedReason,
          status: toPrismaEvidenceAcceptanceStatus(
            CLASSIFICATION_RESULT_STATUSES.accepted,
          ),
        },
      });

      await this.enqueueReadyEvent(
        command,
        tx,
        verifiedProfile,
        classificationResultId,
        guardrailStatus,
      );

      await this.writeAuditLog(
        command,
        tx,
        verifiedProfile,
        classificationResultId,
        guardrailStatus,
        blockedReason,
      );
    });

    const runId = classificationRunId(
      verifiedProfile.assessmentId,
      verifiedProfile.id,
    );
    await this.runtimeEvents.recordToolCompleted({
      organizationId: verifiedProfile.organizationId,
      assessmentId: verifiedProfile.assessmentId,
      runId,
      correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.classification,
      toolName: "classification_result",
      summary: isBlocked
        ? "Classification completed with guardrail block"
        : "Classification completed",
      outputSummary: {
        classificationResultId,
        legalRuleMatchId: payload.legal_rule_match_id,
        guardrailStatus,
      },
      completedAt: new Date(),
    });
    await this.runtimeEvents.recordRunCompleted({
      organizationId: verifiedProfile.organizationId,
      assessmentId: verifiedProfile.assessmentId,
      runId,
      correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.classification,
      toolName: "classification_result",
      summary: "Assessment classification orchestration completed",
      outputSummary: {
        classificationResultId,
        guardrailStatus,
      },
      completedAt: new Date(),
    });

    return {
      accepted: true,
      classification_result_id: classificationResultId,
      guardrail_status: guardrailStatus,
      correlationId: correlationId,
    };
  }

  private validate(command: AcceptClassificationCommand): void {
    const payload = command.payload;
    if (
      !isRecord(payload) ||
      !clean(payload.legal_rule_match_id) ||
      !clean(payload.verified_profile_id) ||
      !clean(payload.assessment_id) ||
      !CLASSIFICATION_RESULT_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof CLASSIFICATION_RESULT_SCHEMA_VERSIONS)[number],
      ) ||
      !isRecord(payload.classification_data) ||
      !Object.values(CLASSIFICATION_GUARDRAIL_STATUSES).includes(
        payload.guardrail_status,
      )
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.classificationSchemaInvalid),
      );
    }
  }

  private async enqueueReadyEvent(
    command: AcceptClassificationCommand,
    tx: Prisma.TransactionClient,
    verifiedProfile: {
      id: string;
      assessmentId: string;
      organizationId: string;
    },
    classificationResultId: string,
    guardrailStatus: ClassificationGuardrailStatus,
  ): Promise<void> {
    const correlationId = command.correlationId || classificationResultId;
    const message = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.classificationResult,
      aggregateId: classificationResultId,
      eventType: SCAN_EVENT_TYPES.classificationResultReady,
      organizationId: verifiedProfile.organizationId,
      assessmentId: verifiedProfile.assessmentId,
      correlationId,
      causationId: verifiedProfile.id,
      actor: {
        id: CLASSIFICATION_WORKER_ACTOR_ID,
        type: AUDIT_ACTOR_TYPES.service,
      },
      result: SCAN_EVENT_TYPES.classificationResultReady,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: `${classificationResultId}:${SCAN_EVENT_TYPES.classificationResultReady}`,
      payload: {
        classificationResultId,
        assessmentId: verifiedProfile.assessmentId,
        guardrailStatus,
        correlationId,
      },
    });

    await this.outboxRepository.enqueue(message, tx);
  }

  private async writeAuditLog(
    command: AcceptClassificationCommand,
    tx: Prisma.TransactionClient,
    verifiedProfile: {
      id: string;
      assessmentId: string;
      organizationId: string;
    },
    classificationResultId: string,
    guardrailStatus: ClassificationGuardrailStatus,
    blockedReason: string | null,
  ): Promise<void> {
    const isBlocked =
      guardrailStatus === CLASSIFICATION_GUARDRAIL_STATUSES.blocked;

    const auditEventType = isBlocked
      ? SCAN_EVENT_TYPES.classificationBlockedAudit
      : SCAN_EVENT_TYPES.classificationAcceptedAudit;

    const correlationId = command.correlationId || classificationResultId;

    await this.auditWriter.writeInTx(
      {
        eventType: auditEventType,
        actorId: CLASSIFICATION_WORKER_ACTOR_ID,
        organizationId: verifiedProfile.organizationId,
        assessmentId: verifiedProfile.assessmentId,
        resourceType: AUDIT_RESOURCE_TYPES.classificationResult,
        resourceId: classificationResultId,
        correlationId,
        causationId: verifiedProfile.id,
        decision: isBlocked ? AUDIT_DECISIONS.deny : AUDIT_DECISIONS.allow,
        result: auditEventType,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        actor: {
          id: CLASSIFICATION_WORKER_ACTOR_ID,
          type: AUDIT_ACTOR_TYPES.service,
        },
        payload: {
          assessmentId: verifiedProfile.assessmentId,
          guardrailStatus,
          blockedReason,
          correlationId,
        },
      },
      tx,
    );
  }

  private errorBody(command: AcceptClassificationCommand, errorCode: string) {
    return problemResult(
      String(errorCode),
      command.correlationId ?? command.payload.assessment_id,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function classificationRunId(assessmentId: string, verifiedProfileId: string): string {
  return `classification:${assessmentId}:${verifiedProfileId}`;
}
