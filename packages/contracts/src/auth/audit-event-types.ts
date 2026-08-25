import {
  AUDIT_DECISIONS,
  type AuditDecision,
} from "../audit/audit-event.types.ts";

export const AUTH_AUDIT_EVENT_TYPES = {
  authSignUpSuccess: "AUTH_SIGN_UP_SUCCESS",
  authSignUpFailed: "AUTH_SIGN_UP_FAILED",
  authSignInSuccess: "AUTH_SIGN_IN_SUCCESS",
  authSignInFailed: "AUTH_SIGN_IN_FAILED",
  authSessionRevoked: "AUTH_SESSION_REVOKED",
  authMfaEnrolled: "AUTH_MFA_ENROLLED",
  authMfaDisabled: "AUTH_MFA_DISABLED",
  authMfaOtpVerified: "AUTH_MFA_OTP_VERIFIED",
  authMfaOtpFailed: "AUTH_MFA_OTP_FAILED",
  authMfaRecoveryCodesGenerated: "AUTH_MFA_RECOVERY_CODES_GENERATED",
  authMfaRecoveryCodeViewed: "AUTH_MFA_RECOVERY_CODE_VIEWED",
  authMfaRecoveryCodeDownloaded: "AUTH_MFA_RECOVERY_CODE_DOWNLOADED",
  authMfaRecoveryCodePrinted: "AUTH_MFA_RECOVERY_CODE_PRINTED",
  authMfaRecoveryCodeCopied: "AUTH_MFA_RECOVERY_CODE_COPIED",
  authMfaRecoveryCodeUsed: "AUTH_MFA_RECOVERY_CODE_USED",
  authProfileUpdated: "AUTH_PROFILE_UPDATED",
  authOauthStart: "AUTH_OAUTH_START",
  authOauthLoginSuccess: "AUTH_OAUTH_LOGIN_SUCCESS",
  authOauthLoginFailed: "AUTH_OAUTH_LOGIN_FAILED",
  authDeveloperInvited: "AUTH_DEVELOPER_INVITED",
  authDeveloperInvitationPreviewDenied:
    "AUTH_DEVELOPER_INVITATION_PREVIEW_DENIED",
  authDeveloperInvitationAccepted: "AUTH_DEVELOPER_INVITATION_ACCEPTED",
  authDeveloperRevoked: "AUTH_DEVELOPER_REVOKED",
  authDeveloperTaskContextAllowed: "AUTH_DEVELOPER_TASK_CONTEXT_ALLOWED",
  authDeveloperTaskContextDenied: "AUTH_DEVELOPER_TASK_CONTEXT_DENIED",
} as const;

export type AuthAuditEventType =
  (typeof AUTH_AUDIT_EVENT_TYPES)[keyof typeof AUTH_AUDIT_EVENT_TYPES];

export const AUTH_LEGACY_AUDIT_EVENT_TYPES = {
  loginSucceeded: "auth.login.succeeded",
  loginFailed: "auth.login.failed",
  sessionCreated: "auth.session.created",
  sessionRevoked: "auth.session.revoked",
  registerSucceeded: "auth.register.succeeded",
  registerFailed: "auth.register.failed",
  mfaEnrolled: "auth.mfa.enrolled",
  mfaDisabled: "auth.mfa.disabled",
  mfaVerified: "auth.mfa.verified",
  mfaFailed: "auth.mfa.failed",
  mfaRateLimited: "auth.mfa.rate_limited",
  mfaRecoveryCodesGenerated: "auth.mfa.recovery_codes.generated",
  mfaRecoveryCodeViewed: "auth.mfa.recovery_code.viewed",
  mfaRecoveryCodeDownloaded: "auth.mfa.recovery_code.downloaded",
  mfaRecoveryCodePrinted: "auth.mfa.recovery_code.printed",
  mfaRecoveryCodeCopied: "auth.mfa.recovery_code.copied",
  mfaRecoveryCodeUsed: "auth.mfa.recovery_code.used",
  profileUpdated: "auth.profile.updated",
  recoveryRequested: "auth.recovery.requested",
  recoveryConfirmed: "auth.recovery.confirmed",
  recoveryConfirmFailed: "auth.recovery.confirm_failed",
  oauthStartSucceeded: "auth.oauth.start.succeeded",
  oauthStartFailed: "auth.oauth.start.failed",
  oauthLoginSucceeded: "auth.oauth.login.succeeded",
  oauthLoginFailed: "auth.oauth.login.failed",
  oauthLinkSucceeded: "auth.oauth.link.succeeded",
  oauthLinkFailed: "auth.oauth.link.failed",
  workspaceAccessAllowed: "workspace.access.allowed",
  workspaceAccessDenied: "workspace.access.denied",
} as const;

export const LEGACY_AUTH_AUDIT_EVENT_TYPE_ALIASES: Record<string, string> = {
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded]: "LOGIN_SUCCESS",
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.loginFailed]:
    AUTH_AUDIT_EVENT_TYPES.authSignInFailed,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.sessionRevoked]:
    AUTH_AUDIT_EVENT_TYPES.authSessionRevoked,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled]:
    AUTH_AUDIT_EVENT_TYPES.authMfaEnrolled,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaDisabled]:
    AUTH_AUDIT_EVENT_TYPES.authMfaDisabled,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaVerified]:
    AUTH_AUDIT_EVENT_TYPES.authMfaOtpVerified,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaFailed]:
    AUTH_AUDIT_EVENT_TYPES.authMfaOtpFailed,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodesGenerated]:
    AUTH_AUDIT_EVENT_TYPES.authMfaRecoveryCodesGenerated,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeViewed]:
    AUTH_AUDIT_EVENT_TYPES.authMfaRecoveryCodeViewed,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeDownloaded]:
    AUTH_AUDIT_EVENT_TYPES.authMfaRecoveryCodeDownloaded,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodePrinted]:
    AUTH_AUDIT_EVENT_TYPES.authMfaRecoveryCodePrinted,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeCopied]:
    AUTH_AUDIT_EVENT_TYPES.authMfaRecoveryCodeCopied,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeUsed]:
    AUTH_AUDIT_EVENT_TYPES.authMfaRecoveryCodeUsed,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.profileUpdated]:
    AUTH_AUDIT_EVENT_TYPES.authProfileUpdated,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartSucceeded]:
    AUTH_AUDIT_EVENT_TYPES.authOauthStart,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed]:
    AUTH_AUDIT_EVENT_TYPES.authOauthStart,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginSucceeded]:
    AUTH_AUDIT_EVENT_TYPES.authOauthLoginSuccess,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed]:
    AUTH_AUDIT_EVENT_TYPES.authOauthLoginFailed,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkSucceeded]:
    AUTH_AUDIT_EVENT_TYPES.authOauthLoginSuccess,
  [AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkFailed]:
    AUTH_AUDIT_EVENT_TYPES.authOauthLoginFailed,
};

export type LegacyAuthAuditEvent = Record<string, unknown>;

export function isLegacyAuthAuditEvent(
  event: unknown,
): event is LegacyAuthAuditEvent {
  return typeof event === "object" && event !== null && "event_type" in event;
}

export function normalizeLegacyAuthAuditEventType(eventType: string): string {
  return LEGACY_AUTH_AUDIT_EVENT_TYPE_ALIASES[eventType] ?? eventType;
}

export function authAuditReadString(
  event: LegacyAuthAuditEvent,
  key: string,
): string {
  const value = event[key];
  if (typeof value !== "string") {
    throw new Error(`Auth audit event field ${key} must be a string`);
  }

  return value;
}

export function authAuditReadRequiredString(
  event: LegacyAuthAuditEvent,
  key: string,
): string {
  const value = authAuditReadString(event, key);
  if (value.length === 0) {
    throw new Error(`Auth audit event field ${key} must be a string`);
  }

  return value;
}

export function authAuditReadNullableString(
  event: LegacyAuthAuditEvent,
  key: string,
): string | null {
  const value = event[key];
  return typeof value === "string" ? value : null;
}

export function authAuditReadDecision(
  event: LegacyAuthAuditEvent,
  key: string,
): AuditDecision | null {
  const value = event[key];
  return value === AUDIT_DECISIONS.allow || value === AUDIT_DECISIONS.deny
    ? value
    : null;
}
