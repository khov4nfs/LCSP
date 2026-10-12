import { ConfirmPasswordRecoveryHandler } from "./confirm-password-recovery/confirm-password-recovery.handler.ts";
import { DisableMfaHandler } from "./disable-mfa/disable-mfa.handler.ts";
import { EnrollMfaHandler } from "./enroll-mfa/enroll-mfa.handler.ts";
import { GenerateMfaRecoveryCodesHandler } from "./generate-mfa-recovery-codes/generate-mfa-recovery-codes.handler.ts";
import { OAuthCallbackHandler } from "./oauth-callback/oauth-callback.handler.ts";
import { OAuthLinkCallbackHandler } from "./oauth-link-callback/oauth-link-callback.handler.ts";
import { OAuthLinkStartHandler } from "./oauth-link-start/oauth-link-start.handler.ts";
import { OAuthStartHandler } from "./oauth-start/oauth-start.handler.ts";
import { ReauthenticatePasswordHandler } from "./reauthenticate-password/reauthenticate-password.handler.ts";
import { RecordMfaRecoveryCodeAccessHandler } from "./record-mfa-recovery-code-access/record-mfa-recovery-code-access.handler.ts";
import { RequestPasswordRecoveryHandler } from "./request-password-recovery/request-password-recovery.handler.ts";
import { RevokeOwnedSessionHandler } from "./revoke-owned-session/revoke-owned-session.handler.ts";
import { RevokeSessionHandler } from "./revoke-session/revoke-session.handler.ts";
import { SignInHandler } from "./sign-in/sign-in.handler.ts";
import { SignUpHandler } from "./sign-up/sign-up.handler.ts";
import { UpdateProfileHandler } from "./update-profile/update-profile.handler.ts";
import { VerifyMfaOtpHandler } from "./verify-mfa-otp/verify-mfa-otp.handler.ts";
import { VerifyMfaRecoveryCodeHandler } from "./verify-mfa-recovery-code/verify-mfa-recovery-code.handler.ts";

export * from "./confirm-password-recovery/confirm-password-recovery.command.ts";
export * from "./confirm-password-recovery/confirm-password-recovery.handler.ts";
export * from "./disable-mfa/disable-mfa.command.ts";
export * from "./disable-mfa/disable-mfa.handler.ts";
export * from "./enroll-mfa/enroll-mfa.command.ts";
export * from "./enroll-mfa/enroll-mfa.handler.ts";
export * from "./generate-mfa-recovery-codes/generate-mfa-recovery-codes.command.ts";
export * from "./generate-mfa-recovery-codes/generate-mfa-recovery-codes.handler.ts";
export * from "./oauth-callback/oauth-callback.command.ts";
export * from "./oauth-callback/oauth-callback.handler.ts";
export * from "./oauth-link-callback/oauth-link-callback.command.ts";
export * from "./oauth-link-callback/oauth-link-callback.handler.ts";
export * from "./oauth-link-start/oauth-link-start.command.ts";
export * from "./oauth-link-start/oauth-link-start.handler.ts";
export * from "./oauth-start/oauth-start.command.ts";
export * from "./oauth-start/oauth-start.handler.ts";
export * from "./reauthenticate-password/reauthenticate-password.command.ts";
export * from "./reauthenticate-password/reauthenticate-password.handler.ts";
export * from "./record-mfa-recovery-code-access/record-mfa-recovery-code-access.command.ts";
export * from "./record-mfa-recovery-code-access/record-mfa-recovery-code-access.handler.ts";
export * from "./request-password-recovery/request-password-recovery.command.ts";
export * from "./request-password-recovery/request-password-recovery.handler.ts";
export * from "./revoke-owned-session/revoke-owned-session.command.ts";
export * from "./revoke-owned-session/revoke-owned-session.handler.ts";
export * from "./revoke-session/revoke-session.command.ts";
export * from "./revoke-session/revoke-session.handler.ts";
export * from "./sign-in/sign-in.command.ts";
export * from "./sign-in/sign-in.handler.ts";
export * from "./sign-up/sign-up.command.ts";
export * from "./sign-up/sign-up.handler.ts";
export * from "./update-profile/update-profile.command.ts";
export * from "./update-profile/update-profile.handler.ts";
export * from "./verify-mfa-otp/verify-mfa-otp.command.ts";
export * from "./verify-mfa-otp/verify-mfa-otp.handler.ts";
export * from "./verify-mfa-recovery-code/verify-mfa-recovery-code.command.ts";
export * from "./verify-mfa-recovery-code/verify-mfa-recovery-code.handler.ts";

export const AUTH_COMMAND_HANDLERS = [
  ConfirmPasswordRecoveryHandler,
  DisableMfaHandler,
  EnrollMfaHandler,
  GenerateMfaRecoveryCodesHandler,
  OAuthCallbackHandler,
  OAuthLinkCallbackHandler,
  OAuthLinkStartHandler,
  OAuthStartHandler,
  ReauthenticatePasswordHandler,
  RecordMfaRecoveryCodeAccessHandler,
  RequestPasswordRecoveryHandler,
  RevokeOwnedSessionHandler,
  RevokeSessionHandler,
  SignInHandler,
  SignUpHandler,
  UpdateProfileHandler,
  VerifyMfaOtpHandler,
  VerifyMfaRecoveryCodeHandler,
] as const;
