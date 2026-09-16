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
import { AUTH_WORKSPACE_RECOVERY_NOTIFIER } from "./application/ports/notification/recovery-notifier.ts";
import {
  AUTH_WORKSPACE_REPOSITORIES,
  type AuthWorkspaceRepositories,
} from "./application/ports/persistence/auth-workspace-repositories.ts";
import {
  CheckSensitiveRouteHandler,
  GetAuthProfileHandler,
  GetWorkspaceHandler,
  ListAuthRepositoriesHandler,
  ListAuthSessionsHandler,
} from "./application/queries/index.ts";
import { AdminAccountCommandService } from "./application/services/admin/admin-account-command.service.js";
import { AdminAccountInvitationService } from "./application/services/admin/admin-account-invitation.service.js";
import { AdminAccountReadService } from "./application/services/admin/admin-account-read.service.js";
import { AdminOverviewService } from "./application/services/admin/admin-overview.service.js";
import { AuthAuditService } from "./application/services/auth-workspace/auth-audit.service.ts";
import { AuthWorkspaceSupportService } from "./application/services/auth-workspace/auth-workspace-support.service.ts";
import { RecoveryEmailNotifierService } from "./infrastructure/notification/recovery-email-notifier.service.ts";
import { GoogleOAuthProvider } from "./infrastructure/oauth/google-oauth.provider.ts";
import { OAuthProviderRegistry } from "./infrastructure/oauth/oauth-provider.registry.ts";
import {
  PrismaAuditEventRepository,
  PrismaAuthorizationDecisionRepository,
  PrismaMfaEnrollmentRepository,
  PrismaMfaOtpUsedRepository,
  PrismaMfaRateLimitRepository,
  PrismaMfaRecoveryCodeRepository,
  PrismaOAuthIdentityRepository,
  PrismaOAuthStateRepository,
  PrismaRecoveryRequestRepository,
  PrismaSessionRepository,
  PrismaUserRepository,
} from "./infrastructure/persistence/prisma-auth-workspace.repositories.ts";
import { AccountInvitationsController } from "./presentation/http/account-invitations.controller.js";
import { AdminOverviewController } from "./presentation/http/admin-overview.controller.js";
import { AdminUsersController } from "./presentation/http/admin-users.controller.ts";
import { AuthWorkspaceController } from "./presentation/http/auth-workspace.controller.ts";

const REPOSITORY_PROVIDERS = [
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaAuditEventRepository,
  PrismaAuthorizationDecisionRepository,
  PrismaMfaEnrollmentRepository,
  PrismaMfaRateLimitRepository,
  PrismaMfaOtpUsedRepository,
  PrismaMfaRecoveryCodeRepository,
  PrismaRecoveryRequestRepository,
  PrismaOAuthStateRepository,
  PrismaOAuthIdentityRepository,
];

@Module({
  imports: [PrismaModule, AuditModule, CqrsModule, MailModule],
  controllers: [
    AuthWorkspaceController,
    AdminUsersController,
    AccountInvitationsController,
    AdminOverviewController,
  ],
  providers: [
    AdminOverviewService,
    AdminAccountReadService,
    AdminAccountCommandService,
    AdminAccountInvitationService,
    ...REPOSITORY_PROVIDERS,
    {
      provide: AUTH_WORKSPACE_REPOSITORIES,
      inject: REPOSITORY_PROVIDERS,
      useFactory: (
        users: PrismaUserRepository,
        sessions: PrismaSessionRepository,
        auditEvents: PrismaAuditEventRepository,
        authorizationDecisions: PrismaAuthorizationDecisionRepository,
        mfaEnrollments: PrismaMfaEnrollmentRepository,
        mfaRateLimits: PrismaMfaRateLimitRepository,
        mfaOtpUsed: PrismaMfaOtpUsedRepository,
        mfaRecoveryCodes: PrismaMfaRecoveryCodeRepository,
        recoveryRequests: PrismaRecoveryRequestRepository,
        oauthStates: PrismaOAuthStateRepository,
        oauthIdentities: PrismaOAuthIdentityRepository,
      ): AuthWorkspaceRepositories => ({
        users,
        sessions,
        auditEvents,
        authorizationDecisions,
        mfaEnrollments,
        mfaRateLimits,
        mfaOtpUsed,
        mfaRecoveryCodes,
        recoveryRequests,
        oauthStates,
        oauthIdentities,
      }),
    },
    {
      provide: AuthWorkspaceSupportService,
      inject: [AuthAuditService],
      useFactory: (authAudit: AuthAuditService) =>
        new AuthWorkspaceSupportService(authAudit),
    },
    {
      provide: AUTH_WORKSPACE_RECOVERY_NOTIFIER,
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
    ListAuthRepositoriesHandler,
    CheckSensitiveRouteHandler,
    GetWorkspaceHandler,
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
    // Exposed for platform/rbac's RbacGuard, which needs read access to
    // sessions/users/MFA enrollment and write access to the
    // decision log.
    PrismaSessionRepository,
    PrismaUserRepository,
    PrismaMfaEnrollmentRepository,
    PrismaAuthorizationDecisionRepository,
  ],
})
export class AuthWorkspaceModule {}
