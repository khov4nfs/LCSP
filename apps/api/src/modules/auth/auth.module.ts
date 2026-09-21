import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PrismaModule } from "../../infrastructure/prisma/prisma.module.js";
import { AuditModule } from "../../platform/audit/audit.module.js";
import { MailModule } from "../../platform/mail/mail.module.js";
import {
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
} from "./application/commands/index.ts";
import { AUTH_RECOVERY_NOTIFIER } from "./application/ports/notification/recovery-notifier.ts";
import {
  AUTH_AUDIT_EVENT_REPOSITORY,
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_MFA_OTP_USED_REPOSITORY,
  AUTH_MFA_RATE_LIMIT_REPOSITORY,
  AUTH_MFA_RECOVERY_CODE_REPOSITORY,
  AUTH_OAUTH_IDENTITY_REPOSITORY,
  AUTH_OAUTH_STATE_REPOSITORY,
  AUTH_RECOVERY_REQUEST_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
} from "./application/ports/persistence/index.ts";
import {
  CheckSensitiveRouteHandler,
  GetAuthProfileHandler,
  ListAuthSessionsHandler,
} from "./application/queries/index.ts";
import { AuthAuditService } from "./application/services/auth/auth-audit.service.ts";
import { AuthSupportService } from "./application/services/auth/auth-support.service.ts";
import { RecoveryEmailNotifierService } from "./infrastructure/notification/recovery-email-notifier.service.ts";
import { GoogleOAuthProvider } from "./infrastructure/oauth/google-oauth.provider.ts";
import { OAuthProviderRegistry } from "./infrastructure/oauth/oauth-provider.registry.ts";
import {
  PrismaAuditEventRepository,
  PrismaMfaEnrollmentRepository,
  PrismaMfaOtpUsedRepository,
  PrismaMfaRateLimitRepository,
  PrismaMfaRecoveryCodeRepository,
  PrismaOAuthIdentityRepository,
  PrismaOAuthStateRepository,
  PrismaRecoveryRequestRepository,
  PrismaSessionRepository,
  PrismaUserRepository,
} from "./infrastructure/persistence/prisma-auth.repositories.ts";
import { AuthController } from "./presentation/http/auth.controller.ts";

const REPOSITORY_PROVIDERS = [
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaAuditEventRepository,
  PrismaMfaEnrollmentRepository,
  PrismaMfaRateLimitRepository,
  PrismaMfaOtpUsedRepository,
  PrismaMfaRecoveryCodeRepository,
  PrismaRecoveryRequestRepository,
  PrismaOAuthStateRepository,
  PrismaOAuthIdentityRepository,
  {
    provide: AUTH_USER_REPOSITORY,
    useExisting: PrismaUserRepository,
  },
  {
    provide: AUTH_SESSION_REPOSITORY,
    useExisting: PrismaSessionRepository,
  },
  {
    provide: AUTH_AUDIT_EVENT_REPOSITORY,
    useExisting: PrismaAuditEventRepository,
  },
  {
    provide: AUTH_MFA_ENROLLMENT_REPOSITORY,
    useExisting: PrismaMfaEnrollmentRepository,
  },
  {
    provide: AUTH_MFA_RATE_LIMIT_REPOSITORY,
    useExisting: PrismaMfaRateLimitRepository,
  },
  {
    provide: AUTH_MFA_OTP_USED_REPOSITORY,
    useExisting: PrismaMfaOtpUsedRepository,
  },
  {
    provide: AUTH_MFA_RECOVERY_CODE_REPOSITORY,
    useExisting: PrismaMfaRecoveryCodeRepository,
  },
  {
    provide: AUTH_RECOVERY_REQUEST_REPOSITORY,
    useExisting: PrismaRecoveryRequestRepository,
  },
  {
    provide: AUTH_OAUTH_STATE_REPOSITORY,
    useExisting: PrismaOAuthStateRepository,
  },
  {
    provide: AUTH_OAUTH_IDENTITY_REPOSITORY,
    useExisting: PrismaOAuthIdentityRepository,
  },
];

@Module({
  imports: [PrismaModule, AuditModule, CqrsModule, MailModule],
  controllers: [AuthController],
  providers: [
    ...REPOSITORY_PROVIDERS,
    {
      provide: AuthSupportService,
      inject: [AuthAuditService],
      useFactory: (authAudit: AuthAuditService) =>
        new AuthSupportService(authAudit),
    },
    {
      provide: AUTH_RECOVERY_NOTIFIER,
      useClass: RecoveryEmailNotifierService,
    },
    GoogleOAuthProvider,
    OAuthProviderRegistry,
    AuthAuditService,
    SignInHandler,
    SignUpHandler,
    RevokeSessionHandler,
    RevokeOwnedSessionHandler,
    GetAuthProfileHandler,
    ListAuthSessionsHandler,
    CheckSensitiveRouteHandler,
    DisableMfaHandler,
    EnrollMfaHandler,
    VerifyMfaOtpHandler,
    VerifyMfaRecoveryCodeHandler,
    GenerateMfaRecoveryCodesHandler,
    RecordMfaRecoveryCodeAccessHandler,
    UpdateProfileHandler,
    ReauthenticatePasswordHandler,
    RequestPasswordRecoveryHandler,
    ConfirmPasswordRecoveryHandler,
    OAuthStartHandler,
    OAuthCallbackHandler,
    OAuthLinkStartHandler,
    OAuthLinkCallbackHandler,
  ],
  exports: [
    AuthAuditService,
    AUTH_USER_REPOSITORY,
    AUTH_SESSION_REPOSITORY,
    AUTH_MFA_ENROLLMENT_REPOSITORY,
  ],
})
export class AuthModule {}
