export const RBAC_DECISIONS = {
  allow: "ALLOW",
  deny: "DENY",
} as const;

export type RbacDecision = (typeof RBAC_DECISIONS)[keyof typeof RBAC_DECISIONS];

export const RBAC_REASON_CODES = {
  accountSuspended: "ACCOUNT_SUSPENDED",
  authorized: "AUTHORIZED",
  denied: "RBAC_DENIED",
  loadError: "LOAD_ERROR",
  metadataMissing: "RBAC_METADATA_MISSING",
  mfaRequired: "MFA_REQUIRED",
  sessionInvalid: "SESSION_INVALID",
} as const;

export type RbacReasonCode =
  (typeof RBAC_REASON_CODES)[keyof typeof RBAC_REASON_CODES];

export type RbacContextDenialReason =
  | typeof RBAC_REASON_CODES.accountSuspended
  | typeof RBAC_REASON_CODES.sessionInvalid
  | typeof RBAC_REASON_CODES.mfaRequired
  | typeof RBAC_REASON_CODES.loadError;

// Authorization decisions use one canonical AuditEvent type and one local
// outbox recovery event so API guards, the fallback writer, and the recovery
// poller cannot diverge on ad-hoc strings.
export const RBAC_AUDIT_EVENT_TYPES = {
  authorizationDecision: "AUTHORIZATION_DECISION",
} as const;

export const RBAC_OUTBOX_EVENT_TYPES = {
  authorizationDecisionAuditFallback:
    "event.authorization.decision-audit-fallback.v1",
} as const;
