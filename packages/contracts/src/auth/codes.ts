export const AUTH_ERROR_CODES = {
  authRequired: "AUTH_REQUIRED",
  invalidCredentials: "INVALID_CREDENTIALS",
  invalidInviteState: "INVALID_INVITE_STATE",
  membershipMissing: "MEMBERSHIP_MISSING",
  emailVerificationRequired: "EMAIL_VERIFICATION_REQUIRED",
  sessionInvalid: "SESSION_INVALID",
  temporaryLock: "TEMPORARY_LOCKED",
  authzPolicyUnavailable: "AUTHZ_POLICY_UNAVAILABLE",
  authzSubjectIncomplete: "AUTHZ_SUBJECT_INCOMPLETE",
  authzTenantScopeMismatch: "AUTHZ_TENANT_SCOPE_MISMATCH",
  authzStateGateBlocked: "AUTHZ_STATE_GATE_BLOCKED",
  authzEvaluatorFailure: "AUTHZ_EVALUATOR_FAILURE",
  validationFailed: "VALIDATION_FAILED",
  reauthRequired: "REAUTH_REQUIRED",
  mfaRequired: "MFA_REQUIRED",
  mfaInvalid: "MFA_INVALID",
  mfaRateLimited: "MFA_RATE_LIMITED",
  recoveryInvalid: "RECOVERY_INVALID",
  pbacDenied: "PBAC_DENIED",
  unsupportedProvider: "UNSUPPORTED_PROVIDER",
  invalidRedirectUri: "INVALID_REDIRECT_URI",
  oauthStateInvalid: "OAUTH_STATE_INVALID",
  oauthCallbackInvalid: "OAUTH_CALLBACK_INVALID",
  accountNotFound: "ACCOUNT_NOT_FOUND",
} as const;

export const ACCEPT_INVITATION_ERROR_CODES = {
  invitationInvalid: "INVITATION_INVALID",
  invitationNotApproved: "INVITATION_NOT_APPROVED",
  emailAlreadyExists: "EMAIL_ALREADY_EXISTS",
  passwordTooShort: "PASSWORD_TOO_SHORT",
  invalidRequest: "INVALID_REQUEST",
} as const;

export const SIGN_UP_ERROR_CODES = {
  emailAlreadyExists: "EMAIL_ALREADY_EXISTS",
  passwordTooShort: "PASSWORD_TOO_SHORT",
  invalidRequest: "INVALID_REQUEST",
} as const;

export const INVITE_DEVELOPER_ERROR_CODES = {
  invalidActions: "INVALID_ACTIONS",
  assessmentNotOwned: "ASSESSMENT_NOT_OWNED",
  invalidEmail: "INVALID_EMAIL",
  invalidRequest: "INVALID_REQUEST",
} as const;

export const ORGANIZATION_SCOPE_ERROR_CODES = {
  mismatch: "ORG_SCOPE_MISMATCH",
} as const;

export const REVOKE_MEMBERSHIP_ERROR_CODES = {
  membershipNotFound: "MEMBERSHIP_NOT_FOUND",
  cannotSelfRevoke: "CANNOT_SELF_REVOKE",
  organizationScopeMismatch: ORGANIZATION_SCOPE_ERROR_CODES.mismatch,
} as const;

export const WORKSPACE_ERROR_CODES = {
  selectionRequired: "WORKSPACE_SELECTION_REQUIRED",
  notFound: "WORKSPACE_NOT_FOUND",
} as const;
