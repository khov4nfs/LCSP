export const AUTH_ERROR_CODES = {
  authRequired: "AUTH_REQUIRED",
  invalidCredentials: "INVALID_CREDENTIALS",
  invalidInviteState: "INVALID_INVITE_STATE",
  emailVerificationRequired: "EMAIL_VERIFICATION_REQUIRED",
  sessionInvalid: "SESSION_INVALID",
  temporaryLock: "TEMPORARY_LOCKED",
  authzStateGateBlocked: "AUTHZ_STATE_GATE_BLOCKED",
  authzEvaluatorFailure: "AUTHZ_EVALUATOR_FAILURE",
  validationFailed: "VALIDATION_FAILED",
  reauthRequired: "REAUTH_REQUIRED",
  mfaRequired: "MFA_REQUIRED",
  mfaInvalid: "MFA_INVALID",
  mfaRateLimited: "MFA_RATE_LIMITED",
  recoveryInvalid: "RECOVERY_INVALID",
  rbacDenied: "RBAC_DENIED",
  unsupportedProvider: "UNSUPPORTED_PROVIDER",
  invalidRedirectUri: "INVALID_REDIRECT_URI",
  oauthStateInvalid: "OAUTH_STATE_INVALID",
  oauthCallbackInvalid: "OAUTH_CALLBACK_INVALID",
  accountNotFound: "ACCOUNT_NOT_FOUND",
} as const;

export const SIGN_UP_ERROR_CODES = {
  emailAlreadyExists: "EMAIL_ALREADY_EXISTS",
  passwordTooShort: "PASSWORD_TOO_SHORT",
  invalidRequest: "INVALID_REQUEST",
} as const;

export const ORGANIZATION_SCOPE_ERROR_CODES = {
  mismatch: "ORG_SCOPE_MISMATCH",
} as const;

export const WORKSPACE_ERROR_CODES = {
  selectionRequired: "WORKSPACE_SELECTION_REQUIRED",
  notFound: "WORKSPACE_NOT_FOUND",
} as const;
