export const RBAC_REASON_CODE = {
  authorized: "AUTHORIZED",
  denied: "RBAC_DENIED",
  loadError: "LOAD_ERROR",
  metadataMissing: "RBAC_METADATA_MISSING",
  mfaRequired: "MFA_REQUIRED",
  sessionInvalid: "SESSION_INVALID",
} as const;

export type RbacReasonCode =
  (typeof RBAC_REASON_CODE)[keyof typeof RBAC_REASON_CODE];
