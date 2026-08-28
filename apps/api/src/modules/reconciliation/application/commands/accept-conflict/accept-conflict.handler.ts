import * as crypto from "node:crypto";

import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  buildAuditEventInput,
  type AuditResourceType,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  AI_USAGE_FLOW_STATUSES,
  CONFLICT_DETECTION_SCHEMA_VERSIONS,
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";
import {
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
  toPrismaConflictRecordStatus,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaOutboxAggregateType,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import type {
  ConflictDetectionCallbackDto,
  ConflictInputRequest,
  ConflictType,
} from "../../contracts/reconciliation/conflict-detection-callback.contract.js";
import { AcceptConflictCommand } from "./accept-conflict.command.js";

const RECONCILIATION_WORKER_ACTOR_ID = AUDIT_ACTOR_IDS.conflictDetectionWorker;
const CONFLICT_TYPES = new Set<ConflictType>([
  "evidence_contradiction",
  "scope_mismatch",
  "unverifiable",
]);
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "codesnippet",
  "filecontent",
  "fullastbody",
  "fullprompt",
  "rawoutput",
  "rawsource",
  "rawsourcecode",
  "snippet",
  "sourcecode",
  "sourcecontent",
]);
const SECRET_PATTERNS = [
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i,
];
const SCORE_PRIORITY_EXPLANATION =
  "This score prioritizes Manager review effort and is not a legal risk, compliance status, or final classification.";
const DEFAULT_LIMITED_CONTEXT =
  "Only limited evidence context is available for this conflict.";
const DEFAULT_COVERAGE_LIMITATIONS =
  "Evidence references identify the supporting findings only and do not provide legal risk, compliance status, or final classification.";

@CommandHandler(AcceptConflictCommand)
export class AcceptConflictHandler implements ICommandHandler<AcceptConflictCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: AcceptConflictCommand,
  ): Promise<ConflictDetectionCallbackDto> {
    this.validate(command);

    const payload = command.payload;
    const aiUsageFlow = await this.prisma.aIUsageFlow.findFirst({
      where: {
        id: payload.ai_usage_flow_id,
        assessmentId: payload.assessment_id,
        status: toPrismaEvidenceAcceptanceStatus(
          AI_USAGE_FLOW_STATUSES.accepted,
        ),
      },
      select: {
        id: true,
        assessmentId: true,
      },
    });
    if (!aiUsageFlow) {
      throw new NotFoundException(
        this.errorBody(command, SCAN_ERROR_CODES.aiUsageFlowNotFound),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const conflictIds = payload.conflicts.map(() => crypto.randomUUID());

      await Promise.all(
        payload.conflicts.map((conflict, index) =>
          tx.conflictRecord.create({
            data: {
              id: conflictIds[index],
              aiUsageFlowId: aiUsageFlow.id,
              assessmentId: aiUsageFlow.assessmentId,
              conflictType: conflict.conflict_type,
              conflictScore: conflict.conflict_score,
              scoreExplanation: conflict.score_explanation,
              evidenceRefs: conflict.evidence_refs,
              explanationBasis: buildConflictExplanationBasis(
                conflict,
              ) as Prisma.InputJsonValue,
              status: toPrismaConflictRecordStatus(
                CONFLICT_RECORD_STATUSES.pending,
              ),
            },
          }),
        ),
      );

      const eventType =
        payload.conflicts.length > 0
          ? SCAN_EVENT_TYPES.reconciliationConflictsDetected
          : SCAN_EVENT_TYPES.reconciliationAllConflictsResolved;
      const auditType =
        payload.conflicts.length > 0
          ? SCAN_EVENT_TYPES.conflictDetectedAudit
          : SCAN_EVENT_TYPES.noConflictsDetectedAudit;

      const outboxEvent = buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.aiUsageFlow,
        aggregateId: aiUsageFlow.id,
        eventType,
        assessmentId: aiUsageFlow.assessmentId,
        correlationId: command.correlationId,
        causationId: aiUsageFlow.id,
        actor: {
          id: RECONCILIATION_WORKER_ACTOR_ID,
          type: AUDIT_ACTOR_TYPES.service,
        },
        result: auditType,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${aiUsageFlow.id}:${eventType}:${command.correlationId}`,
        payload: {
          assessmentId: aiUsageFlow.assessmentId,
          aiUsageFlowId: aiUsageFlow.id,
          conflictCount: payload.conflicts.length,
          correlationId: command.correlationId,
        },
      });
      await tx.outboxMessage.create({
        data: {
          id: crypto.randomUUID(),
          aggregateType: toPrismaOutboxAggregateType(outboxEvent.aggregateType),
          aggregateId: outboxEvent.aggregateId,
          eventType: outboxEvent.eventType,
          payload: outboxEvent.payload as Prisma.InputJsonValue,
        },
      });

      if (payload.conflicts.length === 0) {
        await this.createAudit(tx, {
          eventType: SCAN_EVENT_TYPES.noConflictsDetectedAudit,
          resourceId: aiUsageFlow.id,
          resourceType: AUDIT_RESOURCE_TYPES.aiUsageFlow,
          assessmentId: aiUsageFlow.assessmentId,
          correlationId: command.correlationId,
          causationId: aiUsageFlow.id,
          payload: {
            aiUsageFlowId: aiUsageFlow.id,
            assessmentId: aiUsageFlow.assessmentId,
            conflictCount: 0,
            correlationId: command.correlationId,
          },
        });
        return;
      }

      await Promise.all(
        payload.conflicts.map((conflict, index) =>
          this.createAudit(tx, {
            eventType: SCAN_EVENT_TYPES.conflictDetectedAudit,
            resourceId: conflictIds[index],
            resourceType: AUDIT_RESOURCE_TYPES.conflictRecord,
            assessmentId: aiUsageFlow.assessmentId,
            correlationId: command.correlationId,
            causationId: aiUsageFlow.id,
            payload: {
              conflictId: conflictIds[index],
              conflictType: conflict.conflict_type,
              assessmentId: aiUsageFlow.assessmentId,
              aiUsageFlowId: aiUsageFlow.id,
              correlationId: command.correlationId,
            },
          }),
        ),
      );
    });

    return {
      accepted: true,
      conflict_count: payload.conflicts.length,
      correlationId: command.correlationId,
    };
  }

  private validate(command: AcceptConflictCommand): void {
    const payload = command.payload;
    if (
      !isRecord(payload) ||
      !clean(payload.ai_usage_flow_id) ||
      !clean(payload.assessment_id) ||
      !CONFLICT_DETECTION_SCHEMA_VERSIONS.includes(
        payload.schema_version as (typeof CONFLICT_DETECTION_SCHEMA_VERSIONS)[number],
      ) ||
      !clean(payload.provider_version) ||
      !Array.isArray(payload.conflicts) ||
      !payload.conflicts.every(isConflictInput) ||
      !isRecord(payload.privacy_flags)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.conflictSchemaInvalid),
      );
    }

    if (
      payload.conflicts.some(
        (conflict) => !isValidScore(conflict.conflict_score),
      )
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.conflictScoreInvalid),
      );
    }

    if (
      payload.conflicts.some((conflict) => conflict.evidence_refs.length === 0)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.evidenceRefsEmpty),
      );
    }

    if (
      payload.privacy_flags.containsSourceCode !== false ||
      payload.privacy_flags.secretsRedacted !== true ||
      containsUnsafePayload(payload.conflicts)
    ) {
      throw new UnprocessableEntityException(
        this.errorBody(command, SCAN_ERROR_CODES.privacyFlagsInvalid),
      );
    }
  }

  private async createAudit(
    tx: Prisma.TransactionClient,
    input: {
      eventType: string;
      resourceType: AuditResourceType;
      resourceId: string;
      assessmentId: string;
      correlationId: string;
      causationId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const auditEvent = buildAuditEventInput({
      eventType: input.eventType,
      actorId: RECONCILIATION_WORKER_ACTOR_ID,
      assessmentId: input.assessmentId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      correlationId: input.correlationId,
      causationId: input.causationId,
      decision: AUDIT_DECISIONS.allow,
      result: input.eventType,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      actor: {
        id: RECONCILIATION_WORKER_ACTOR_ID,
        type: AUDIT_ACTOR_TYPES.service,
      },
      payload: input.payload,
    });
    await tx.auditEvent.create({
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
  }

  private errorBody(command: AcceptConflictCommand, errorCode: string) {
    return problemResult(errorCode, command.correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
}

function isConflictInput(value: unknown): value is ConflictInputRequest {
  if (!isRecord(value)) return false;
  return (
    isConflictType(value.conflict_type) &&
    typeof value.conflict_score === "number" &&
    Number.isFinite(value.conflict_score) &&
    Boolean(clean(value.score_explanation)) &&
    Array.isArray(value.evidence_refs) &&
    value.evidence_refs.every((entry) => Boolean(clean(entry)))
  );
}

function isConflictType(value: unknown): value is ConflictType {
  return typeof value === "string" && CONFLICT_TYPES.has(value as ConflictType);
}

function isValidScore(value: number): boolean {
  return value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildConflictExplanationBasis(
  conflict: ConflictInputRequest,
): Record<string, unknown> {
  const explicitBasis = isRecord(conflict.explanation_basis)
    ? conflict.explanation_basis
    : {};
  const sourceValues = isRecord(explicitBasis.source_values)
    ? explicitBasis.source_values
    : isRecord(conflict.source_values)
      ? conflict.source_values
      : {};
  const sourceRefs = isRecord(explicitBasis.source_refs)
    ? explicitBasis.source_refs
    : isRecord(conflict.conflicting_source_refs)
      ? conflict.conflicting_source_refs
      : {};

  return {
    affected_field:
      clean(explicitBasis.affected_field) ??
      clean(conflict.affected_claim_field) ??
      "not_provided",
    confidence:
      clean(explicitBasis.confidence) ??
      clean(conflict.confidence) ??
      "unknown",
    materiality_reason:
      clean(explicitBasis.materiality_reason) ??
      clean(conflict.materiality_reason) ??
      materialityReasonForType(conflict.conflict_type),
    score_priority_explanation:
      clean(explicitBasis.score_priority_explanation) ??
      SCORE_PRIORITY_EXPLANATION,
    source_values: {
      manager_answer: clean(sourceValues.manager_answer),
      technical_evidence: clean(sourceValues.technical_evidence),
    },
    source_refs: stringifyRecord(sourceRefs),
    evidence_context: normalizeEvidenceContext(
      explicitBasis.evidence_context ?? conflict.evidence_context,
      conflict.evidence_refs,
    ),
  };
}

function normalizeEvidenceContext(
  value: unknown,
  evidenceRefs: string[],
): Record<string, string>[] {
  if (Array.isArray(value)) {
    const contexts: Record<string, string>[] = [];
    for (const item of value) {
      if (!isRecord(item)) continue;
      const evidenceRef = clean(item.evidence_ref);
      if (!evidenceRef) continue;
      contexts.push({
        evidence_ref: evidenceRef,
        redacted_context:
          clean(item.redacted_context) ?? DEFAULT_LIMITED_CONTEXT,
        coverage_limitations:
          clean(item.coverage_limitations) ?? DEFAULT_COVERAGE_LIMITATIONS,
      });
    }
    if (contexts.length > 0) {
      return contexts;
    }
  }

  return evidenceRefs.map((evidenceRef) => ({
    evidence_ref: evidenceRef,
    redacted_context: DEFAULT_LIMITED_CONTEXT,
    coverage_limitations: DEFAULT_COVERAGE_LIMITATIONS,
  }));
}

function materialityReasonForType(conflictType: ConflictType): string {
  if (conflictType === "evidence_contradiction") {
    return "Manager answers and technical evidence differ on a material AI usage claim.";
  }
  if (conflictType === "scope_mismatch") {
    return "Manager answers and technical evidence differ on the role or scope of AI use.";
  }
  return "The claim needs review because supporting evidence has limited coverage.";
}

function stringifyRecord(
  value: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, clean(entry)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
}

function containsUnsafePayload(value: unknown): boolean {
  if (typeof value === "string") {
    return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafePayload);
  }
  if (!isRecord(value)) return false;

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    return (
      FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey) || containsUnsafePayload(entry)
    );
  });
}
