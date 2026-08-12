import { PBAC_DECISION } from "../pbac/decisions.ts";

export const AUDIT_DECISIONS = PBAC_DECISION;

export type AuditDecision =
  (typeof AUDIT_DECISIONS)[keyof typeof AUDIT_DECISIONS];

export const AUDIT_EVENT_SCHEMA_VERSION = "audit.event.v1";

export const AUDIT_REDACTION_STATUSES = {
  none: "NONE",
  redacted: "REDACTED",
} as const;

export type AuditRedactionStatus =
  (typeof AUDIT_REDACTION_STATUSES)[keyof typeof AUDIT_REDACTION_STATUSES];

export const AUDIT_ACTOR_TYPES = {
  user: "USER",
  service: "SERVICE",
  system: "SYSTEM",
} as const;

export type AuditActorType =
  (typeof AUDIT_ACTOR_TYPES)[keyof typeof AUDIT_ACTOR_TYPES];

export const AUDIT_ACTOR_IDS = {
  aiUsageFlowWorker: "ai-usage-flow-worker",
  classificationResultWorker: "classification-result-worker",
  conflictDetectionWorker: "conflict-detection-worker",
  documentWorker: "document-worker",
  legalRuleMatchWorker: "legal-rule-match-worker",
  scannerWorker: "scanner-worker",
  technicalProfileWorker: "technical-profile-worker",
  verifiedProfileWorker: "verified-profile-worker",
} as const;

export type AuditActorId =
  (typeof AUDIT_ACTOR_IDS)[keyof typeof AUDIT_ACTOR_IDS];

export const AUDIT_RESOURCE_TYPES = {
  aiUsageFlow: "AI_USAGE_FLOW",
  assessment: "ASSESSMENT",
  assessmentRecord: "ASSESSMENT_RECORD",
  auditExportRequest: "AUDIT_EXPORT_REQUEST",
  authInvitation: "AUTH_INVITATION",
  authMembership: "AUTH_MEMBERSHIP",
  authMfaRecoveryCode: "AUTH_MFA_RECOVERY_CODE",
  authOrganization: "AUTH_ORGANIZATION",
  authSession: "AUTH_SESSION",
  classificationReviewRequest: "CLASSIFICATION_REVIEW_REQUEST",
  classificationResult: "CLASSIFICATION_RESULT",
  conflictRecord: "CONFLICT_RECORD",
  documentRequest: "DOCUMENT_REQUEST",
  githubAppInstallState: "GITHUB_APP_INSTALL_STATE",
  httpRoute: "HTTP_ROUTE",
  legalRule: "LEGAL_RULE",
  legalRuleCatalogVersion: "LEGAL_RULE_CATALOG_VERSION",
  legalRuleMatch: "LEGAL_RULE_MATCH",
  outbox: "OUTBOX",
  readinessExport: "READINESS_EXPORT",
  repositoryConnection: "REPOSITORY_CONNECTION",
  repositoryScanJob: "REPOSITORY_SCAN_JOB",
  repositorySnapshot: "REPOSITORY_SNAPSHOT",
  technicalEvidenceReport: "TECHNICAL_EVIDENCE_REPORT",
  technicalProfile: "TECHNICAL_PROFILE",
  verifiedProfile: "VERIFIED_PROFILE",
  workerTask: "WORKER_TASK",
  workspace: "WORKSPACE",
  wizardProfile: "WIZARD_PROFILE",
} as const;

export type AuditResourceType =
  (typeof AUDIT_RESOURCE_TYPES)[keyof typeof AUDIT_RESOURCE_TYPES];

export interface AuditActorRef {
  id: string | null;
  type: AuditActorType;
}

export interface AuditEventInput {
  eventType: string;
  actorId: string | null;
  organizationId: string | null;
  assessmentId?: string | null;
  resourceType?: AuditResourceType | null;
  resourceId?: string | null;
  reasonCode?: string | null;
  correlationId: string;
  causationId?: string | null;
  result?: string | null;
  redactionStatus?: AuditRedactionStatus;
  actor?: AuditActorRef;
  sessionId?: string | null;
  policyId?: string | null;
  policyVersion?: string | null;
  decision: AuditDecision | null;
  payload?: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export type MaterialAuditEventInput = Omit<
  AuditEventInput,
  "payload" | "redactionStatus" | "actor"
> & {
  actor?: AuditActorRef;
  result: string;
  redactionStatus: AuditRedactionStatus;
  payload?: Record<string, unknown>;
};

const UNSAFE_EVENT_KEY_PATTERN =
  /(password|secret|token|nonce|rawSource|sourceCode|prompt|credential|privateKey|apiKey|repositoryToken)/i;

export function sanitizeEventPayload(
  payload?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!payload) return undefined;

  const sanitized = sanitizeRecord(payload);
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function buildAuditEventInput(
  input: MaterialAuditEventInput,
): AuditEventInput {
  const actor = input.actor ?? {
    id: input.actorId,
    type: input.actorId ? AUDIT_ACTOR_TYPES.user : AUDIT_ACTOR_TYPES.system,
  };
  const safePayload = sanitizeEventPayload(input.payload) ?? {};

  return {
    ...input,
    actor,
    payload: {
      ...safePayload,
      schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
      actor,
      ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      redactionStatus: input.redactionStatus,
      result: input.result,
    },
  };
}

function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (UNSAFE_EVENT_KEY_PATTERN.test(key)) continue;
    const sanitizedValue = sanitizeValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeValue(item))
      .filter((item): item is unknown => item !== undefined);
    return items;
  }

  if (isRecord(value)) {
    return sanitizeRecord(value);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
