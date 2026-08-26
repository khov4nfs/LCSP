import type { AuthMessages } from "../../types.ts";

export const enAuth = {
  errors: {
    authRequired: {
      title: "Sign-in required",
      detail: "You need to sign in to continue.",
    },
    invalidCredentials: {
      title: "Sign-in unavailable",
      detail: "The email or password is invalid.",
    },
    invalidInviteState: {
      title: "Entry path unavailable",
      detail: "The account is not ready for this approved entry path.",
    },
    emailVerificationRequired: {
      title: "Email verification required",
      detail: "You need to verify your email before continuing.",
    },
    sessionInvalid: {
      title: "Session unavailable",
      detail: "The session is invalid or has expired.",
    },
    temporaryLock: {
      title: "Temporary lock active",
      detail: "The account is temporarily locked. Please try again later.",
    },
    authzStateGateBlocked: {
      title: "Workspace blocked",
      detail: "You cannot access this workspace yet.",
    },
    authzEvaluatorFailure: {
      title: "Access check unavailable",
      detail: "Access cannot be verified right now.",
    },
    validationFailed: {
      title: "Request invalid",
      detail: "The request is invalid.",
    },
    reauthRequired: {
      title: "Confirm access required",
      detail:
        "Please confirm your signed-in session before performing this action.",
    },
    mfaRequired: {
      title: "MFA verification required",
      detail: "Two-factor authentication is required before workspace access.",
    },
    mfaInvalid: {
      title: "MFA code invalid",
      detail: "The verification code is invalid or has expired.",
    },
    mfaRateLimited: {
      title: "Too many MFA attempts",
      detail: "Too many failed attempts. Please try again later.",
    },
    recoveryInvalid: {
      title: "Recovery link invalid",
      detail: "This recovery link is invalid or has expired.",
    },
    rbacDenied: {
      title: "Action not permitted",
      detail: "You do not have permission to perform this action.",
    },
    unsupportedProvider: {
      title: "Sign-in provider unavailable",
      detail: "This sign-in provider is not supported.",
    },
    invalidRedirectUri: {
      title: "Sign-in unavailable",
      detail: "The sign-in request is invalid.",
    },
    oauthStateInvalid: {
      title: "Sign-in expired",
      detail:
        "The sign-in attempt is invalid or has expired. Please try again.",
    },
    oauthCallbackInvalid: {
      title: "Sign-in unavailable",
      detail: "We could not complete the sign-in attempt. Please try again.",
    },
    accountNotFound: {
      title: "Account not linked",
      detail: "No account is linked to this sign-in method.",
    },
  },
} as const satisfies AuthMessages;
