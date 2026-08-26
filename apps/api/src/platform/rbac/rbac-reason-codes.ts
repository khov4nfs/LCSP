export const LOCAL_RBAC_REASON_CODES = {
  authorized: "AUTHORIZED",
  denied: "RBAC_DENIED",
  loadError: "LOAD_ERROR",
  metadataMissing: "RBAC_METADATA_MISSING",
  mfaRequired: "MFA_REQUIRED",
  sessionInvalid: "SESSION_INVALID",
} as const;

export type RbacContextDenialReason =
  | typeof LOCAL_RBAC_REASON_CODES.sessionInvalid
  | typeof LOCAL_RBAC_REASON_CODES.mfaRequired
  | typeof LOCAL_RBAC_REASON_CODES.loadError;

export type LocalRbacReasonCode =
  (typeof LOCAL_RBAC_REASON_CODES)[keyof typeof LOCAL_RBAC_REASON_CODES];
