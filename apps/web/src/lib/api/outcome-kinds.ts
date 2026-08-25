export const API_OUTCOME_KINDS = {
  accessRevoked: "access_revoked",
  alreadyResolved: "already_resolved",
  alreadySubmitted: "already_submitted",
  authenticated: "authenticated",
  blocked: "blocked",
  created: "created",
  disabled: "disabled",
  emailAlreadyExists: "email_already_exists",
  empty: "empty",
  error: "error",
  invalid: "invalid",
  invitationAccepted: "invitation_accepted",
  invitationInvalid: "invitation_invalid",
  loaded: "loaded",
  mfaRequired: "mfa_required",
  mfaEnrollmentRequired: "mfa_enrollment_required",
  notFound: "not_found",
  passwordTooShort: "password_too_short",
  rateLimited: "rate_limited",
  redirect: "redirect",
  requested: "requested",
  resolved: "resolved",
  saved: "saved",
  sessionInvalid: "session_invalid",
  submitted: "submitted",
  validationError: "validation_error",
  verified: "verified",
  workspaceSelectionRequired: "workspace_selection_required",
} as const;

export const API_VALIDATION_REASONS = {
  dismissReasonRequired: "dismiss_reason_required",
} as const;

export const API_REDIRECT_LOCATIONS = {
  mfaVerify: "/mfa/verify",
  mfaEnroll: "/mfa/enroll",
  recoveryRequest: "/recovery/request",
  signIn: "/sign-in",
  signUp: "/sign-up",
} as const;
