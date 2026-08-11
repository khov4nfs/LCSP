import {
  AUDIT_REDACTION_STATUSES,
  type AuditActorRef,
  type AuditRedactionStatus,
  sanitizeEventPayload,
} from "../audit/audit-event.types.ts";

export const OUTBOX_STATUSES = {
  pending: "PENDING",
  published: "PUBLISHED",
  failed: "FAILED",
  dlq: "DLQ",
} as const;

export const OUTBOX_AUDIT_EVENT_TYPES = {
  retryScheduled: "OUTBOX_RETRY_SCHEDULED",
  dlqEntered: "OUTBOX_DLQ_ENTERED",
  dlqReplayDenied: "OUTBOX_DLQ_REPLAY_DENIED",
  dlqReplayed: "OUTBOX_DLQ_REPLAYED",
  dlqDiscarded: "OUTBOX_DLQ_DISCARDED",
} as const;

export const OUTBOX_ERROR_CODES = {
  dlqMessageNotFound: "OUTBOX_DLQ_MESSAGE_NOT_FOUND",
  dlqReplayUnsafeTarget: "OUTBOX_DLQ_REPLAY_UNSAFE_TARGET",
} as const;

export const OUTBOX_MESSAGE_SCHEMA_VERSION = "outbox.message.v1";

export const OUTBOX_EVENT_EXCHANGES = {
  commands: "lcsp.commands.v1",
  events: "lcsp.events.v1",
} as const;

export const OUTBOX_AGGREGATE_TYPES = {
  aiUsageFlow: "AI_USAGE_FLOW",
  assessment: "ASSESSMENT",
  authUser: "AUTH_USER",
  classificationResult: "CLASSIFICATION_RESULT",
  documentRequest: "DOCUMENT_REQUEST",
  legalRuleMatch: "LEGAL_RULE_MATCH",
  repositoryScanJob: "REPOSITORY_SCAN_JOB",
  repositorySnapshot: "REPOSITORY_SNAPSHOT",
  technicalEvidenceReport: "TECHNICAL_EVIDENCE_REPORT",
  technicalProfile: "TECHNICAL_PROFILE",
  targetedReanalysisRequest: "TARGETED_REANALYSIS_REQUEST",
  verifiedProfile: "VERIFIED_PROFILE",
  wizardProfile: "WIZARD_PROFILE",
} as const;

export type OutboxStatus =
  (typeof OUTBOX_STATUSES)[keyof typeof OUTBOX_STATUSES];

export type OutboxAggregateType =
  (typeof OUTBOX_AGGREGATE_TYPES)[keyof typeof OUTBOX_AGGREGATE_TYPES];

export interface OutboxMessageInput {
  aggregateType: OutboxAggregateType;
  aggregateId: string;
  eventType: string;
  schemaVersion?: string;
  organizationId?: string | null;
  assessmentId?: string | null;
  correlationId?: string;
  causationId?: string;
  actor?: AuditActorRef;
  result?: string;
  redactionStatus?: AuditRedactionStatus;
  authorizationAction?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
}

export interface OutboxMessage extends OutboxMessageInput {
  id: string;
  status: OutboxStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  publishedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

export type MaterialOutboxMessageInput = Omit<
  OutboxMessageInput,
  "schemaVersion" | "payload" | "redactionStatus"
> & {
  organizationId: string;
  correlationId: string;
  causationId: string;
  actor: AuditActorRef;
  result: string;
  redactionStatus: AuditRedactionStatus;
  authorizationAction?: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
};

const CANONICAL_OUTBOX_EVENT_PATTERN =
  /^(command|event)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+\.v1$/;

export function isCanonicalOutboxEventName(eventType: string): boolean {
  return CANONICAL_OUTBOX_EVENT_PATTERN.test(eventType);
}

export function buildOutboxMessageInput(
  input: MaterialOutboxMessageInput,
): OutboxMessageInput {
  if (!isCanonicalOutboxEventName(input.eventType)) {
    throw new Error(`Outbox event name is not canonical: ${input.eventType}`);
  }

  const safePayload = sanitizeEventPayload(input.payload) ?? {};
  const redactionStatus =
    input.redactionStatus ?? AUDIT_REDACTION_STATUSES.redacted;

  return {
    ...input,
    schemaVersion: OUTBOX_MESSAGE_SCHEMA_VERSION,
    redactionStatus,
    payload: {
      ...safePayload,
      schemaVersion: OUTBOX_MESSAGE_SCHEMA_VERSION,
      organizationId: input.organizationId,
      ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
      correlationId: input.correlationId,
      causationId: input.causationId,
      actor: input.actor,
      ...(input.authorizationAction
        ? { authorizationAction: input.authorizationAction }
        : {}),
      result: input.result,
      redactionStatus,
      idempotencyKey: input.idempotencyKey,
    },
  };
}
