export const RBAC_DECISIONS = {
  allow: "ALLOW",
  deny: "DENY",
} as const;

export type RbacDecision =
  (typeof RBAC_DECISIONS)[keyof typeof RBAC_DECISIONS];

export const RBAC_REASON_CODES = {
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
  | typeof RBAC_REASON_CODES.sessionInvalid
  | typeof RBAC_REASON_CODES.mfaRequired
  | typeof RBAC_REASON_CODES.loadError;
