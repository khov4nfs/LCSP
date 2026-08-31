import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  type AuthUserRole,
  type AuthBackupEmailPolicy,
  type AuthPrimaryEmailAddressPolicy,
  AUTH_ERROR_CODES,
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
  type MfaRecoveryCodeAccessAction,
  type ProblemMeta,
  PROBLEM_KEYS,
  SIGN_UP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_AUTHENTICATION_MODES,
  type CredentialProvider,
  type RepositoryAuthenticationMode,
} from "@lcsp/contracts/github-integration";
import type { MessageKey } from "@lcsp/i18n";

import type {
  MfaRecoveryCodeVerifyRequest,
  MfaVerifyOutcome,
  MfaVerifyRequest,
} from "./types/mfa-verify.types";
import { apiRequest } from "./api-request.ts";
import { API_OUTCOME_KINDS } from "./outcome-kinds.ts";
import {
  getProblemCode,
  getProblemMessageKeys,
  getProblemMeta,
} from "./problem-envelope.ts";

export type { MfaVerifyOutcome } from "./types/mfa-verify.types";

const SIGN_IN_ERROR_TITLE_KEYS = {
  invalidCredentials: PROBLEM_KEYS.invalidCredentialsTitle,
  temporaryLock: PROBLEM_KEYS.temporaryLockTitle,
} as const;

const SIGN_IN_ERROR_DETAIL_KEYS = {
  invalidCredentials: PROBLEM_KEYS.invalidCredentialsDetail,
  temporaryLock: PROBLEM_KEYS.temporaryLockDetail,
} as const;

type SignInErrorTitleKey =
  (typeof SIGN_IN_ERROR_TITLE_KEYS)[keyof typeof SIGN_IN_ERROR_TITLE_KEYS];

type SignInErrorDetailKey =
  (typeof SIGN_IN_ERROR_DETAIL_KEYS)[keyof typeof SIGN_IN_ERROR_DETAIL_KEYS];

export type SignInRequest = {
  email: string;
  password: string;
};

export type SignUpRequest = {
  email: string;
  display_name: string;
  password: string;
};

export type SignInWorkspaceOption = {
  id: string;
  name: string;
};

export type EnrollMfaOutcome =
  | {
      kind: typeof API_OUTCOME_KINDS.loaded;
      totpUri: string;
      recoveryCodes: string[];
    }
  | { kind: typeof API_OUTCOME_KINDS.mfaRequired }
  | { kind: typeof API_OUTCOME_KINDS.sessionInvalid }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type MfaRecoveryCodeAccessOutcome =
  | { kind: typeof API_OUTCOME_KINDS.saved }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type DisableMfaOutcome =
  | { kind: typeof API_OUTCOME_KINDS.disabled }
  | { kind: typeof API_OUTCOME_KINDS.mfaRequired }
  | { kind: typeof API_OUTCOME_KINDS.sessionInvalid }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type PasswordReauthRequest = {
  password: string;
};

export type SensitiveRouteCheckRequest = {
  method: string;
  path: string;
};

export type SensitiveRouteCheck = {
  is_sensitive: boolean;
  route_id: string | null;
  reauth_required: boolean;
  verified_at: string | null;
  expires_at: string | null;
};

export type PasswordReauthOutcome =
  | { kind: typeof API_OUTCOME_KINDS.verified }
  | { kind: typeof API_OUTCOME_KINDS.invalid }
  | { kind: typeof API_OUTCOME_KINDS.sessionInvalid }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type RequestRecoveryRequest = {
  email: string;
};

export type RequestRecoveryOutcome =
  | { kind: typeof API_OUTCOME_KINDS.requested }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type ConfirmRecoveryRequest = {
  token: string;
  new_password: string;
};

export type ConfirmRecoveryOutcome =
  | { kind: typeof API_OUTCOME_KINDS.verified }
  | { kind: typeof API_OUTCOME_KINDS.invalid }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type UpdateProfileRequest = {
  recovery_email?: string;
  primary_email_address_policy?: AuthPrimaryEmailAddressPolicy;
  backup_recovery_email_policy?: AuthBackupEmailPolicy;
};

export type UpdateProfileOutcome =
  | { kind: typeof API_OUTCOME_KINDS.saved }
  | { kind: typeof API_OUTCOME_KINDS.mfaRequired }
  | { kind: typeof API_OUTCOME_KINDS.sessionInvalid }
  | {
      kind: typeof API_OUTCOME_KINDS.validationError;
      titleKey: MessageKey;
      detailKey: MessageKey;
    }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type AuthSettingsProfile = {
  user_id: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  recovery_email: string | null;
  primary_email_address_policy: AuthPrimaryEmailAddressPolicy;
  backup_recovery_email_policy: AuthBackupEmailPolicy;
  created_at: string;
  updated_at: string;
  role: AuthUserRole;
  mfa_enrolled: boolean;
  mfa_enrolled_at: string | null;
  mfa_verified: boolean;
  mfa_verified_at: string | null;
  current_session_id: string;
  current_session_created_at: string;
  current_session_updated_at: string;
  current_session_expires_at: string;
};

export type AuthSessionSummary = {
  id: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  revoked_at: string | null;
  mfa_verified_at: string | null;
  is_current: boolean;
};

export type AuthRepositorySummary = {
  id: string;
  provider: CredentialProvider;
  authentication_mode: RepositoryAuthenticationMode;
  installation_id: string | null;
  repository_name: string;
  repository_full_name: string;
  default_branch: string;
  status: string;
  connected_at: string;
  revoked_at: string | null;
  assessment_id: string | null;
  assessment_name: string | null;
};

export type SignInOutcome =
  | { kind: typeof API_OUTCOME_KINDS.authenticated }
  | {
      kind: typeof API_OUTCOME_KINDS.workspaceSelectionRequired;
      workspaces: SignInWorkspaceOption[];
    }
  | { kind: typeof API_OUTCOME_KINDS.mfaRequired }
  | { kind: typeof API_OUTCOME_KINDS.mfaEnrollmentRequired }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: SignInErrorTitleKey;
      detailKey: SignInErrorDetailKey;
      lockedUntil?: string;
      retryAfterSeconds?: number;
    };

export type SignUpOutcome =
  | { kind: typeof API_OUTCOME_KINDS.authenticated }
  | { kind: typeof API_OUTCOME_KINDS.emailAlreadyExists }
  | { kind: typeof API_OUTCOME_KINDS.passwordTooShort }
  | { kind: typeof API_OUTCOME_KINDS.validationError }
  | { kind: typeof API_OUTCOME_KINDS.error };

export function toSignInOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): SignInOutcome {
  if (ok && isSignInSuccess(payload)) {
    if (payload.workspace_selection_required) {
      return {
        kind: API_OUTCOME_KINDS.workspaceSelectionRequired,
        workspaces: payload.workspaces ?? [],
      };
    }
    if (payload.mfa_required) {
      return payload.mfa_enrolled === false
        ? { kind: API_OUTCOME_KINDS.mfaEnrollmentRequired }
        : { kind: API_OUTCOME_KINDS.mfaRequired };
    }
    return { kind: API_OUTCOME_KINDS.authenticated };
  }

  if (problemCode === AUTH_ERROR_CODES.temporaryLock) {
    return {
      kind: API_OUTCOME_KINDS.error,
      titleKey: SIGN_IN_ERROR_TITLE_KEYS.temporaryLock,
      detailKey: SIGN_IN_ERROR_DETAIL_KEYS.temporaryLock,
      ...readTemporaryLockMetadata(getProblemMeta(payload)),
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: SIGN_IN_ERROR_TITLE_KEYS.invalidCredentials,
    detailKey: SIGN_IN_ERROR_DETAIL_KEYS.invalidCredentials,
  };
}

function readTemporaryLockMetadata(meta: ProblemMeta | undefined) {
  const lockedUntil =
    typeof meta?.lockedUntil === "string" ? meta.lockedUntil : undefined;
  const retryAfterSeconds =
    typeof meta?.retryAfterSeconds === "number"
      ? meta.retryAfterSeconds
      : undefined;

  return {
    ...(lockedUntil ? { lockedUntil } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

export async function signIn(
  credentials: SignInRequest,
): Promise<SignInOutcome> {
  const { payload, ok, problemCode } = await apiRequest("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });

  return toSignInOutcome(payload, ok, problemCode);
}

export async function signUp(request: SignUpRequest): Promise<SignUpOutcome> {
  const { ok, payload, problemCode } = await apiRequest("/api/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  return toSignUpOutcome(payload, ok, problemCode);
}

export function toSignUpOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): SignUpOutcome {
  if (ok) {
    return { kind: API_OUTCOME_KINDS.authenticated };
  }

  switch (problemCode) {
    case SIGN_UP_ERROR_CODES.emailAlreadyExists:
      return { kind: API_OUTCOME_KINDS.emailAlreadyExists };
    case SIGN_UP_ERROR_CODES.passwordTooShort:
      return { kind: API_OUTCOME_KINDS.passwordTooShort };
    case SIGN_UP_ERROR_CODES.invalidRequest:
    case AUTH_ERROR_CODES.validationFailed:
      return { kind: API_OUTCOME_KINDS.validationError };
    default:
      return { kind: API_OUTCOME_KINDS.error };
  }
}

export function toMfaVerifyOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): MfaVerifyOutcome {
  if (ok) {
    return { kind: API_OUTCOME_KINDS.verified };
  }

  if (problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return { kind: API_OUTCOME_KINDS.sessionInvalid };
  }
  if (problemCode === AUTH_ERROR_CODES.mfaRateLimited) {
    return {
      kind: API_OUTCOME_KINDS.rateLimited,
      titleKey: "auth.errors.mfaRateLimited.title",
      detailKey: "auth.errors.mfaRateLimited.detail",
    };
  }
  if (problemCode === AUTH_ERROR_CODES.mfaRequired) {
    return { kind: API_OUTCOME_KINDS.mfaRequired };
  }
  if (problemCode === AUTH_ERROR_CODES.mfaInvalid) {
    return {
      kind: API_OUTCOME_KINDS.invalid,
      titleKey: "auth.errors.mfaInvalid.title",
      detailKey: "auth.errors.mfaInvalid.detail",
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.mfaVerify.errors.requestFailedTitle",
    detailKey: "pages.mfaVerify.errors.requestFailedDetail",
  };
}

export async function verifyMfaOtp(
  request: MfaVerifyRequest,
): Promise<MfaVerifyOutcome> {
  const { payload, ok, problemCode } = await apiRequest(
    "/api/auth/mfa/verify-otp",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  return toMfaVerifyOutcome(payload, ok, problemCode);
}

export async function verifyMfaRecoveryCode(
  request: MfaRecoveryCodeVerifyRequest,
): Promise<MfaVerifyOutcome> {
  const { payload, ok, problemCode } = await apiRequest(
    "/api/auth/mfa/recovery-code/verify",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  return toMfaVerifyOutcome(payload, ok, problemCode);
}

export function toEnrollMfaOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): EnrollMfaOutcome {
  if (
    ok &&
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { totp_uri?: unknown }).totp_uri === "string"
  ) {
    return {
      kind: API_OUTCOME_KINDS.loaded,
      totpUri: (payload as { totp_uri: string }).totp_uri,
      recoveryCodes: Array.isArray(
        (payload as { recovery_codes?: unknown }).recovery_codes,
      )
        ? (payload as { recovery_codes: unknown[] }).recovery_codes.filter(
            (code): code is string => typeof code === "string",
          )
        : [],
    };
  }

  if (
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid
  ) {
    return { kind: API_OUTCOME_KINDS.sessionInvalid };
  }

  if (problemCode === AUTH_ERROR_CODES.mfaRequired) {
    return { kind: API_OUTCOME_KINDS.mfaRequired };
  }

  const problemKeys = getProblemMessageKeys(payload);
  if (problemKeys) {
    return {
      kind: API_OUTCOME_KINDS.error,
      titleKey: problemKeys.titleKey,
      detailKey: problemKeys.detailKey,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.mfaEnroll.errors.requestFailedTitle",
    detailKey: "pages.mfaEnroll.errors.requestFailedDetail",
  };
}

export async function enrollMfa(): Promise<EnrollMfaOutcome> {
  const { payload, ok, problemCode } = await apiRequest(
    "/api/auth/mfa/enroll",
    {
      method: "POST",
    },
  );

  return toEnrollMfaOutcome(payload, ok, problemCode);
}

export async function recordMfaRecoveryCodeAccess(
  action: MfaRecoveryCodeAccessAction,
): Promise<MfaRecoveryCodeAccessOutcome> {
  const { payload, ok } = await apiRequest(
    "/api/auth/mfa/recovery-codes/access",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );

  if (ok) {
    return { kind: API_OUTCOME_KINDS.saved };
  }

  const problemKeys = getProblemMessageKeys(payload);
  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey:
      problemKeys?.titleKey ?? "pages.mfaEnroll.errors.requestFailedTitle",
    detailKey:
      problemKeys?.detailKey ?? "pages.mfaEnroll.errors.requestFailedDetail",
  };
}

export { MFA_RECOVERY_CODE_ACCESS_ACTIONS };

export function toDisableMfaOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): DisableMfaOutcome {
  if (ok) {
    return { kind: API_OUTCOME_KINDS.disabled };
  }

  if (problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return { kind: API_OUTCOME_KINDS.sessionInvalid };
  }

  if (problemCode === AUTH_ERROR_CODES.mfaRequired) {
    return { kind: API_OUTCOME_KINDS.mfaRequired };
  }

  const problemKeys = getProblemMessageKeys(payload);
  if (problemKeys) {
    return {
      kind: API_OUTCOME_KINDS.error,
      titleKey: problemKeys.titleKey,
      detailKey: problemKeys.detailKey,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.workspace.settingsHub.password.disableFailedTitle",
    detailKey: "pages.workspace.settingsHub.password.disableFailedDescription",
  };
}

export async function disableMfa(): Promise<DisableMfaOutcome> {
  const { payload, ok, problemCode } = await apiRequest("/api/auth/mfa", {
    method: "DELETE",
  });

  return toDisableMfaOutcome(payload, ok, problemCode);
}

export function toPasswordReauthOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): PasswordReauthOutcome {
  if (ok) {
    return { kind: API_OUTCOME_KINDS.verified };
  }

  if (problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return { kind: API_OUTCOME_KINDS.sessionInvalid };
  }

  if (problemCode === AUTH_ERROR_CODES.invalidCredentials) {
    return { kind: API_OUTCOME_KINDS.invalid };
  }

  const problemKeys = getProblemMessageKeys(payload);
  if (problemKeys) {
    return {
      kind: API_OUTCOME_KINDS.error,
      titleKey: problemKeys.titleKey,
      detailKey: problemKeys.detailKey,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.signIn.errors.requestFailedTitle",
    detailKey: "pages.signIn.errors.requestFailedDetail",
  };
}

export async function reauthenticateWithPassword(
  request: PasswordReauthRequest,
): Promise<PasswordReauthOutcome> {
  const { payload, ok, problemCode } = await apiRequest(
    "/api/auth/re-auth/password",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  return toPasswordReauthOutcome(payload, ok, problemCode);
}

export async function checkSensitiveRoute(
  request: SensitiveRouteCheckRequest,
): Promise<SensitiveRouteCheck> {
  const { payload, ok } = await apiRequest("/api/auth/sensitive-route/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  return ok && isSensitiveRouteCheck(payload)
    ? payload
    : {
        is_sensitive: true,
        route_id: null,
        reauth_required: true,
        verified_at: null,
        expires_at: null,
      };
}

function isSensitiveRouteCheck(
  payload: unknown,
): payload is SensitiveRouteCheck {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const value = payload as Partial<SensitiveRouteCheck>;
  return (
    typeof value.is_sensitive === "boolean" &&
    isNullableString(value.route_id) &&
    typeof value.reauth_required === "boolean" &&
    isNullableString(value.verified_at) &&
    isNullableString(value.expires_at)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function toRequestRecoveryOutcome(
  payload: unknown,
  ok: boolean,
): RequestRecoveryOutcome {
  if (ok) {
    return { kind: API_OUTCOME_KINDS.requested };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.recoveryRequest.errors.requestFailedTitle",
    detailKey: "pages.recoveryRequest.errors.requestFailedDetail",
  };
}

export async function requestPasswordRecovery(
  request: RequestRecoveryRequest,
): Promise<RequestRecoveryOutcome> {
  const { payload, ok } = await apiRequest("/api/auth/recovery/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  return toRequestRecoveryOutcome(payload, ok);
}

export function toConfirmRecoveryOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): ConfirmRecoveryOutcome {
  if (ok) {
    return { kind: API_OUTCOME_KINDS.verified };
  }

  if (problemCode === AUTH_ERROR_CODES.recoveryInvalid) {
    return {
      kind: API_OUTCOME_KINDS.invalid,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.recoveryConfirm.errors.requestFailedTitle",
    detailKey: "pages.recoveryConfirm.errors.requestFailedDetail",
  };
}

export async function confirmPasswordRecovery(
  request: ConfirmRecoveryRequest,
): Promise<ConfirmRecoveryOutcome> {
  const { payload, ok, problemCode } = await apiRequest(
    "/api/auth/recovery/confirm",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  return toConfirmRecoveryOutcome(payload, ok, problemCode);
}

export function toUpdateProfileOutcome(
  payload: unknown,
  ok: boolean,
  problemCode = getProblemCode(payload),
): UpdateProfileOutcome {
  if (ok) {
    return { kind: API_OUTCOME_KINDS.saved };
  }

  if (problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return { kind: API_OUTCOME_KINDS.sessionInvalid };
  }

  if (problemCode === AUTH_ERROR_CODES.mfaRequired) {
    return { kind: API_OUTCOME_KINDS.mfaRequired };
  }

  if (problemCode === AUTH_ERROR_CODES.validationFailed) {
    return {
      kind: API_OUTCOME_KINDS.validationError,
      titleKey: "auth.errors.validationFailed.title",
      detailKey: "auth.errors.validationFailed.detail",
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.workspace.security.errors.requestFailedTitle",
    detailKey: "pages.workspace.security.errors.requestFailedDetail",
  };
}

export async function updateProfile(
  request: UpdateProfileRequest,
): Promise<UpdateProfileOutcome> {
  const { payload, ok, problemCode } = await apiRequest("/api/auth/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  return toUpdateProfileOutcome(payload, ok, problemCode);
}

export async function getAuthSettingsProfile(): Promise<AuthSettingsProfile> {
  const { payload, ok } = await apiRequest("/api/auth/profile");
  if (!ok || !isAuthSettingsProfile(payload)) {
    throw new Error("auth-settings-profile-load-failed");
  }

  return payload;
}

export async function getAuthSessions(): Promise<AuthSessionSummary[]> {
  const { payload, ok } = await apiRequest("/api/auth/sessions");
  if (!ok || !isAuthSessionsPayload(payload)) {
    throw new Error("auth-sessions-load-failed");
  }

  return payload.sessions;
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  const { payload, ok } = await apiRequest(
    `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
    },
  );
  if (
    !ok ||
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { revoked_session_id?: unknown }).revoked_session_id !==
      "string"
  ) {
    throw new Error("auth-session-revoke-failed");
  }
}

export async function getAuthRepositories(): Promise<AuthRepositorySummary[]> {
  const { payload, ok } = await apiRequest("/api/auth/repositories");
  if (!ok || !isAuthRepositoriesPayload(payload)) {
    throw new Error("auth-repositories-load-failed");
  }

  return payload.repositories;
}

export async function signOut(): Promise<void> {
  await apiRequest("/api/auth/sign-out", {
    method: "POST",
  }).catch(() => null);
}

function isSignInSuccess(payload: unknown): payload is {
  ok?: true;
  mfa_required?: boolean;
  mfa_enrolled?: boolean;
  workspace_selection_required?: boolean;
  workspaces?: SignInWorkspaceOption[];
} {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const candidate = payload as { ok?: unknown };
  return candidate.ok === undefined || candidate.ok === true;
}

function isAuthSettingsProfile(
  payload: unknown,
): payload is AuthSettingsProfile {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.user_id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.email_verified === "boolean" &&
    (typeof candidate.display_name === "string" ||
      candidate.display_name === null) &&
    (typeof candidate.recovery_email === "string" ||
      candidate.recovery_email === null) &&
    Object.values(AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES).includes(
      candidate.primary_email_address_policy as AuthPrimaryEmailAddressPolicy,
    ) &&
    Object.values(AUTH_BACKUP_EMAIL_POLICIES).includes(
      candidate.backup_recovery_email_policy as AuthBackupEmailPolicy,
    ) &&
    typeof candidate.created_at === "string" &&
    typeof candidate.updated_at === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.mfa_enrolled === "boolean" &&
    (typeof candidate.mfa_enrolled_at === "string" ||
      candidate.mfa_enrolled_at === null) &&
    typeof candidate.mfa_verified === "boolean" &&
    (typeof candidate.mfa_verified_at === "string" ||
      candidate.mfa_verified_at === null) &&
    typeof candidate.current_session_id === "string" &&
    typeof candidate.current_session_created_at === "string" &&
    typeof candidate.current_session_updated_at === "string" &&
    typeof candidate.current_session_expires_at === "string"
  );
}

function isAuthSessionsPayload(
  payload: unknown,
): payload is { sessions: AuthSessionSummary[] } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const sessions = (payload as { sessions?: unknown }).sessions;
  return (
    Array.isArray(sessions) &&
    sessions.every((session) => {
      if (typeof session !== "object" || session === null) {
        return false;
      }

      const candidate = session as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        Object.values(CREDENTIAL_PROVIDERS).includes(
          candidate.provider as CredentialProvider,
        ) &&
        typeof candidate.created_at === "string" &&
        typeof candidate.updated_at === "string" &&
        typeof candidate.expires_at === "string" &&
        (typeof candidate.revoked_at === "string" ||
          candidate.revoked_at === null) &&
        (typeof candidate.mfa_verified_at === "string" ||
          candidate.mfa_verified_at === null) &&
        typeof candidate.is_current === "boolean"
      );
    })
  );
}

function isAuthRepositoriesPayload(
  payload: unknown,
): payload is { repositories: AuthRepositorySummary[] } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const repositories = (payload as { repositories?: unknown }).repositories;
  return (
    Array.isArray(repositories) &&
    repositories.every((repository) => {
      if (typeof repository !== "object" || repository === null) {
        return false;
      }

      const candidate = repository as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        Object.values(REPOSITORY_AUTHENTICATION_MODES).includes(
          candidate.authentication_mode as RepositoryAuthenticationMode,
        ) &&
        (typeof candidate.installation_id === "string" ||
          candidate.installation_id === null) &&
        typeof candidate.repository_name === "string" &&
        typeof candidate.repository_full_name === "string" &&
        typeof candidate.default_branch === "string" &&
        typeof candidate.status === "string" &&
        typeof candidate.connected_at === "string" &&
        (typeof candidate.revoked_at === "string" ||
          candidate.revoked_at === null) &&
        (typeof candidate.assessment_id === "string" ||
          candidate.assessment_id === null) &&
        (typeof candidate.assessment_name === "string" ||
          candidate.assessment_name === null)
      );
    })
  );
}
