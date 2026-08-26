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
  ASSESSMENT_RESULT_MODES,
  CLASSIFICATION_GUARDRAIL_STATUSES,
  CLASSIFICATION_RESULT_SCHEMA_VERSIONS,
  CLASSIFICATION_RESULT_STATUSES,
  ENGINEERING_EVIDENCE_CLAIM_TYPES,
  ENGINEERING_LIMITATION_CODES,
  ENGINEERING_RULE_EVALUATION_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
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
  toPrismaClassificationGuardrailStatus,
  toPrismaEvidenceAcceptanceStatus,
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
const ENGINEERING_LIMITATION_CODE_SET = new Set<string>(
  Object.values(ENGINEERING_LIMITATION_CODES),
);
const ENGINEERING_CLAIM_TYPE_SET = new Set<string>(
  Object.values(ENGINEERING_EVIDENCE_CLAIM_TYPES),
);
const ENGINEERING_EVALUATION_STATUS_SET = new Set<string>(
  Object.values(ENGINEERING_RULE_EVALUATION_STATUSES),
);

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
    const assessmentRunId = clean(payload.classification_data.run_id);
    this.overclaimGuardrail.validate(
      payload.classification_data,
      correlationId,
    );

    const evidenceReport = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        id: payload.technical_evidence_report_id,
        assessmentId: payload.assessment_id,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        ),
      },
      select: {
        id: true,
        assessmentId: true,
        snapshotId: true,
      },
    });

    if (!evidenceReport) {
      throw new NotFoundException(
        this.errorBody(command, SCAN_ERROR_CODES.evidenceReportNotFound),
      );
    }

    const existingResults = await this.prisma.classificationResult.findMany({
      where: {
        assessmentId: evidenceReport.assessmentId,
        status: toPrismaEvidenceAcceptanceStatus(
          CLASSIFICATION_RESULT_STATUSES.accepted,
        ),
      },
      select: { id: true, classificationData: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const existingResult = existingResults.find((item) => {
      const data = isRecord(item.classificationData)
        ? item.classificationData
        : {};
      return (
        clean(data.technical_evidence_report_id) === evidenceReport.id &&
        clean(data.mode) ===
          ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation &&
        clean(data.run_id) === assessmentRunId
      );
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
    const blockedReason = isBlocked ? "ENGINEERING_ASSESSMENT_BLOCKED" : null;
    const persistedData: Prisma.InputJsonValue = {
      ...payload.classification_data,
      mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
      ...(assessmentRunId ? { run_id: assessmentRunId } : {}),
      technical_evidence_report_id: evidenceReport.id,
      snapshot_id:
        clean(payload.classification_data.snapshot_id) ??
        evidenceReport.snapshotId,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.classificationResult.create({
        data: {
          id: classificationResultId,
          legalRuleMatchId: null,
          verifiedProfileId: null,
          assessmentId: evidenceReport.assessmentId,
          schemaVersion: payload.schema_version,
          classificationData: persistedData,
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
        evidenceReport,
        classificationResultId,
        guardrailStatus,
      );
      await this.writeAuditLog(
        command,
        tx,
        evidenceReport,
        classificationResultId,
        guardrailStatus,
        blockedReason,
      );
    });

    const runId =
      assessmentRunId ??
      engineeringAssessmentRunId(
        evidenceReport.assessmentId,
        evidenceReport.id,
      );
    const runtimeOutputSummary = engineeringAssessmentRuntimeOutputSummary({
      classificationResultId,
      technicalEvidenceReportId: evidenceReport.id,
      guardrailStatus,
      classificationData: payload.classification_data,
    });
    await this.runtimeEvents.recordToolCompleted({
      assessmentId: evidenceReport.assessmentId,
      runId,
      correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.classification,
      toolName: "engineering_rule_evaluation",
      summary: isBlocked
        ? "EngineeringRule assessment completed with guardrail block"
        : "EngineeringRule assessment completed",
      outputSummary: {
        ...runtimeOutputSummary,
        classificationResultId,
        technicalEvidenceReportId: evidenceReport.id,
        guardrailStatus,
        mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
      },
      completedAt: new Date(),
    });
    await this.runtimeEvents.recordRunCompleted({
      assessmentId: evidenceReport.assessmentId,
      runId,
      correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.classification,
      toolName: "engineering_rule_evaluation",
      summary: "Direct EngineeringRule assessment orchestration completed",
      outputSummary: {
        ...runtimeOutputSummary,
        classificationResultId,
        technicalEvidenceReportId: evidenceReport.id,
        guardrailStatus,
      },
      completedAt: new Date(),
    });

    return {
      accepted: true,
      classification_result_id: classificationResultId,
      guardrail_status: guardrailStatus,
      correlationId,
    };
  }

  private validate(command: AcceptClassificationCommand): void {
    const payload = command.payload;
    if (
      !isRecord(payload) ||
      !clean(payload.technical_evidence_report_id) ||
      !clean(payload.assessment_id) ||
      !CLASSIFICATION_RESULT_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof CLASSIFICATION_RESULT_SCHEMA_VERSIONS)[number],
      ) ||
      !isRecord(payload.classification_data) ||
      clean(payload.classification_data.mode) !==
        ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation ||
      !isValidEngineeringAssessmentData(payload.classification_data) ||
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
    evidenceReport: {
      id: string;
      assessmentId: string;
      snapshotId: string;
    },
    classificationResultId: string,
    guardrailStatus: ClassificationGuardrailStatus,
  ): Promise<void> {
    const correlationId = command.correlationId || classificationResultId;
    const message = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.classificationResult,
      aggregateId: classificationResultId,
      eventType: SCAN_EVENT_TYPES.classificationResultReady,
      assessmentId: evidenceReport.assessmentId,
      correlationId,
      causationId: evidenceReport.id,
      actor: {
        id: CLASSIFICATION_WORKER_ACTOR_ID,
        type: AUDIT_ACTOR_TYPES.service,
      },
      result: SCAN_EVENT_TYPES.classificationResultReady,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: `${classificationResultId}:${SCAN_EVENT_TYPES.classificationResultReady}`,
      payload: {
        classificationResultId,
        assessmentId: evidenceReport.assessmentId,
        technicalEvidenceReportId: evidenceReport.id,
        guardrailStatus,
        correlationId,
      },
    });

    await this.outboxRepository.enqueue(message, tx);
  }

  private async writeAuditLog(
    command: AcceptClassificationCommand,
    tx: Prisma.TransactionClient,
    evidenceReport: {
      id: string;
      assessmentId: string;
      snapshotId: string;
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
        assessmentId: evidenceReport.assessmentId,
        resourceType: AUDIT_RESOURCE_TYPES.classificationResult,
        resourceId: classificationResultId,
        correlationId,
        causationId: evidenceReport.id,
        decision: isBlocked ? AUDIT_DECISIONS.deny : AUDIT_DECISIONS.allow,
        result: auditEventType,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        actor: {
          id: CLASSIFICATION_WORKER_ACTOR_ID,
          type: AUDIT_ACTOR_TYPES.service,
        },
        payload: {
          assessmentId: evidenceReport.assessmentId,
          technicalEvidenceReportId: evidenceReport.id,
          snapshotId: evidenceReport.snapshotId,
          guardrailStatus,
          blockedReason,
          mode: ASSESSMENT_RESULT_MODES.engineeringRuleEvaluation,
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
      { status: HttpStatus.BAD_REQUEST },
    );
  }
}

function isValidEngineeringAssessmentData(
  data: Record<string, unknown>,
): boolean {
  if (!isMachineLimitationArray(data.limitations)) return false;

  if (data.evaluations !== undefined) {
    if (!Array.isArray(data.evaluations)) return false;
    for (const evaluation of data.evaluations) {
      if (!isRecord(evaluation)) return false;
      const status = clean(evaluation.status);
      if (status && !ENGINEERING_EVALUATION_STATUS_SET.has(status))
        return false;
      if (!isMachineLimitationArray(evaluation.limitations)) return false;
    }
  }

  if (data.claims !== undefined) {
    if (!Array.isArray(data.claims)) return false;
    for (const claim of data.claims) {
      if (!isRecord(claim)) return false;
      const claimType = clean(claim.claim_type);
      if (!claimType || !ENGINEERING_CLAIM_TYPE_SET.has(claimType))
        return false;
      if (!("value" in claim)) return false;
      if (claim.value !== null && typeof claim.value !== "boolean")
        return false;
      if (!isMachineLimitationArray(claim.limitations)) return false;
    }
  }

  return true;
}

function isMachineLimitationArray(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" && ENGINEERING_LIMITATION_CODE_SET.has(item),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function engineeringAssessmentRuntimeOutputSummary(input: {
  classificationResultId: string;
  technicalEvidenceReportId: string;
  guardrailStatus: ClassificationGuardrailStatus;
  classificationData: Record<string, unknown>;
}): Record<string, unknown> {
  const summary = isRecord(input.classificationData.summary)
    ? input.classificationData.summary
    : {};
  const observability = isRecord(input.classificationData.observability)
    ? input.classificationData.observability
    : {};
  return {
    classificationResultId: input.classificationResultId,
    technicalEvidenceReportId: input.technicalEvidenceReportId,
    guardrailStatus: input.guardrailStatus,
    engineeringSummary: {
      compliant: nonNegativeInteger(summary.compliant),
      nonCompliant: nonNegativeInteger(summary.non_compliant),
      unknown: nonNegativeInteger(summary.unknown),
      total: nonNegativeInteger(summary.total),
    },
    limitations: stringArray(input.classificationData.limitations),
    observability,
  };
}

function engineeringAssessmentRunId(
  assessmentId: string,
  evidenceReportId: string,
): string {
  return `engineering-assessment:${assessmentId}:${evidenceReportId}`;
}
