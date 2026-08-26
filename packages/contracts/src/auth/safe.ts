import { REQUIRED_ACTIONS } from "./actions.ts";
import { AUTH_ERROR_CODES } from "./codes.ts";
import type {
  AppProblem,
  ProblemKey,
  ProblemMeta,
  ProblemResult,
  SuccessResult,
} from "./problems.ts";
import type { AuthErrorCode, RequiredAction } from "./types.ts";

export const PROBLEM_REQUIRED_ACTIONS: Record<AuthErrorCode, RequiredAction> = {
  [AUTH_ERROR_CODES.authRequired]: REQUIRED_ACTIONS.signIn,
  [AUTH_ERROR_CODES.invalidCredentials]: REQUIRED_ACTIONS.signIn,
  [AUTH_ERROR_CODES.invalidInviteState]: REQUIRED_ACTIONS.acceptInvite,
  [AUTH_ERROR_CODES.emailVerificationRequired]: REQUIRED_ACTIONS.verifyEmail,
  [AUTH_ERROR_CODES.sessionInvalid]: REQUIRED_ACTIONS.signIn,
  [AUTH_ERROR_CODES.temporaryLock]: REQUIRED_ACTIONS.waitAndRetry,
  [AUTH_ERROR_CODES.authzStateGateBlocked]: REQUIRED_ACTIONS.contactOwner,
  [AUTH_ERROR_CODES.authzEvaluatorFailure]: REQUIRED_ACTIONS.contactOwner,
  [AUTH_ERROR_CODES.validationFailed]: REQUIRED_ACTIONS.signIn,
  [AUTH_ERROR_CODES.reauthRequired]: REQUIRED_ACTIONS.reauthenticate,
  [AUTH_ERROR_CODES.mfaRequired]: REQUIRED_ACTIONS.verifyMfa,
  [AUTH_ERROR_CODES.mfaInvalid]: REQUIRED_ACTIONS.verifyMfa,
  [AUTH_ERROR_CODES.mfaRateLimited]: REQUIRED_ACTIONS.waitAndRetry,
  [AUTH_ERROR_CODES.recoveryInvalid]: REQUIRED_ACTIONS.retryRecovery,
  [AUTH_ERROR_CODES.rbacDenied]: REQUIRED_ACTIONS.contactOwner,
  [AUTH_ERROR_CODES.unsupportedProvider]: REQUIRED_ACTIONS.none,
  [AUTH_ERROR_CODES.invalidRedirectUri]: REQUIRED_ACTIONS.none,
  [AUTH_ERROR_CODES.oauthStateInvalid]: REQUIRED_ACTIONS.signIn,
  [AUTH_ERROR_CODES.oauthCallbackInvalid]: REQUIRED_ACTIONS.signIn,
  [AUTH_ERROR_CODES.accountNotFound]: REQUIRED_ACTIONS.contactOwner,
};

type ProblemDefaults = {
  type: string;
  status: number;
  titleKey: ProblemKey;
  detailKey: ProblemKey;
};

export const PROBLEM_DEFAULTS: Record<AuthErrorCode, ProblemDefaults> = {
  [AUTH_ERROR_CODES.authRequired]: {
    type: "auth/auth-required",
    status: 401,
    titleKey: "auth.errors.authRequired.title",
    detailKey: "auth.errors.authRequired.detail",
  },
  [AUTH_ERROR_CODES.invalidCredentials]: {
    type: "auth/invalid-credentials",
    status: 401,
    titleKey: "auth.errors.invalidCredentials.title",
    detailKey: "auth.errors.invalidCredentials.detail",
  },
  [AUTH_ERROR_CODES.invalidInviteState]: {
    type: "auth/invalid-invite-state",
    status: 403,
    titleKey: "auth.errors.invalidInviteState.title",
    detailKey: "auth.errors.invalidInviteState.detail",
  },
  [AUTH_ERROR_CODES.emailVerificationRequired]: {
    type: "auth/email-verification-required",
    status: 403,
    titleKey: "auth.errors.emailVerificationRequired.title",
    detailKey: "auth.errors.emailVerificationRequired.detail",
  },
  [AUTH_ERROR_CODES.sessionInvalid]: {
    type: "auth/session-invalid",
    status: 401,
    titleKey: "auth.errors.sessionInvalid.title",
    detailKey: "auth.errors.sessionInvalid.detail",
  },
  [AUTH_ERROR_CODES.temporaryLock]: {
    type: "auth/temporary-lock",
    status: 429,
    titleKey: "auth.errors.temporaryLock.title",
    detailKey: "auth.errors.temporaryLock.detail",
  },
  [AUTH_ERROR_CODES.authzStateGateBlocked]: {
    type: "authz/state-gate-blocked",
    status: 403,
    titleKey: "auth.errors.authzStateGateBlocked.title",
    detailKey: "auth.errors.authzStateGateBlocked.detail",
  },
  [AUTH_ERROR_CODES.authzEvaluatorFailure]: {
    type: "authz/evaluator-failure",
    status: 403,
    titleKey: "auth.errors.authzEvaluatorFailure.title",
    detailKey: "auth.errors.authzEvaluatorFailure.detail",
  },
  [AUTH_ERROR_CODES.validationFailed]: {
    type: "request/validation-failed",
    status: 400,
    titleKey: "auth.errors.validationFailed.title",
    detailKey: "auth.errors.validationFailed.detail",
  },
  [AUTH_ERROR_CODES.reauthRequired]: {
    type: "auth/reauth-required",
    status: 403,
    titleKey: "auth.errors.reauthRequired.title",
    detailKey: "auth.errors.reauthRequired.detail",
  },
  [AUTH_ERROR_CODES.mfaRequired]: {
    type: "auth/mfa-required",
    status: 403,
    titleKey: "auth.errors.mfaRequired.title",
    detailKey: "auth.errors.mfaRequired.detail",
  },
  [AUTH_ERROR_CODES.mfaInvalid]: {
    type: "auth/mfa-invalid",
    status: 403,
    titleKey: "auth.errors.mfaInvalid.title",
    detailKey: "auth.errors.mfaInvalid.detail",
  },
  [AUTH_ERROR_CODES.mfaRateLimited]: {
    type: "auth/mfa-rate-limited",
    status: 429,
    titleKey: "auth.errors.mfaRateLimited.title",
    detailKey: "auth.errors.mfaRateLimited.detail",
  },
  [AUTH_ERROR_CODES.recoveryInvalid]: {
    type: "auth/recovery-invalid",
    status: 400,
    titleKey: "auth.errors.recoveryInvalid.title",
    detailKey: "auth.errors.recoveryInvalid.detail",
  },
  [AUTH_ERROR_CODES.rbacDenied]: {
    type: "authz/rbac-denied",
    status: 403,
    titleKey: "auth.errors.rbacDenied.title",
    detailKey: "auth.errors.rbacDenied.detail",
  },
  [AUTH_ERROR_CODES.unsupportedProvider]: {
    type: "auth/oauth-unsupported-provider",
    status: 400,
    titleKey: "auth.errors.unsupportedProvider.title",
    detailKey: "auth.errors.unsupportedProvider.detail",
  },
  [AUTH_ERROR_CODES.invalidRedirectUri]: {
    type: "auth/oauth-invalid-redirect-uri",
    status: 400,
    titleKey: "auth.errors.invalidRedirectUri.title",
    detailKey: "auth.errors.invalidRedirectUri.detail",
  },
  [AUTH_ERROR_CODES.oauthStateInvalid]: {
    type: "auth/oauth-state-invalid",
    status: 400,
    titleKey: "auth.errors.oauthStateInvalid.title",
    detailKey: "auth.errors.oauthStateInvalid.detail",
  },
  [AUTH_ERROR_CODES.oauthCallbackInvalid]: {
    type: "auth/oauth-callback-invalid",
    status: 400,
    titleKey: "auth.errors.oauthCallbackInvalid.title",
    detailKey: "auth.errors.oauthCallbackInvalid.detail",
  },
  [AUTH_ERROR_CODES.accountNotFound]: {
    type: "auth/oauth-account-not-found",
    status: 404,
    titleKey: "auth.errors.accountNotFound.title",
    detailKey: "auth.errors.accountNotFound.detail",
  },
};

export type CreateProblemOverrides = {
  requiredAction?: RequiredAction;
  meta?: ProblemMeta;
  status?: number;
  type?: string;
  titleKey?: ProblemKey;
  detailKey?: ProblemKey;
};

export function createProblem(
  errorCode: AuthErrorCode,
  correlationId: string,
  overrides: CreateProblemOverrides = {},
): AppProblem<AuthErrorCode> {
  const defaults = PROBLEM_DEFAULTS[errorCode];
  return {
    type: overrides.type ?? defaults.type,
    status: overrides.status ?? defaults.status,
    code: errorCode,
    titleKey: overrides.titleKey ?? defaults.titleKey,
    detailKey: overrides.detailKey ?? defaults.detailKey,
    requiredAction:
      overrides.requiredAction ??
      PROBLEM_REQUIRED_ACTIONS[errorCode] ??
      REQUIRED_ACTIONS.none,
    correlationId,
    meta: overrides.meta,
  };
}

export function createProblemResult(
  errorCode: AuthErrorCode,
  correlationId: string,
  overrides: CreateProblemOverrides = {},
): ProblemResult<AuthErrorCode> {
  return {
    ok: false,
    problem: createProblem(errorCode, correlationId, overrides),
  };
}

export function createSuccessResult<TData>(data: TData): SuccessResult<TData> {
  return {
    ok: true,
    data,
  };
}
