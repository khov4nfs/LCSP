import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";

import { PrismaModule } from "../../infrastructure/prisma/prisma.module.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuditModule } from "../../platform/audit/audit.module.js";
import { ConfirmPasswordRecoveryHandler } from "./application/commands/confirm-password-recovery/confirm-password-recovery.handler.ts";
import { DisableMfaHandler } from "./application/commands/disable-mfa/disable-mfa.handler.ts";
import { EnrollMfaHandler } from "./application/commands/enroll-mfa/enroll-mfa.handler.ts";
import { GenerateMfaRecoveryCodesHandler } from "./application/commands/generate-mfa-recovery-codes/generate-mfa-recovery-codes.handler.ts";
import { OAuthCallbackHandler } from "./application/commands/oauth-callback/oauth-callback.handler.ts";
import { OAuthLinkCallbackHandler } from "./application/commands/oauth-link-callback/oauth-link-callback.handler.ts";
import { OAuthLinkStartHandler } from "./application/commands/oauth-link-start/oauth-link-start.handler.ts";
import { OAuthStartHandler } from "./application/commands/oauth-start/oauth-start.handler.ts";
import { RequestPasswordRecoveryHandler } from "./application/commands/request-password-recovery/request-password-recovery.handler.ts";
import { ReauthenticatePasswordHandler } from "./application/commands/reauthenticate-password/reauthenticate-password.handler.ts";
import { RecordMfaRecoveryCodeAccessHandler } from "./application/commands/record-mfa-recovery-code-access/record-mfa-recovery-code-access.handler.ts";
import { RevokeOwnedSessionHandler } from "./application/commands/revoke-owned-session/revoke-owned-session.handler.ts";
import { RevokeSessionHandler } from "./application/commands/revoke-session/revoke-session.handler.ts";
import { SignInHandler } from "./application/commands/sign-in/sign-in.handler.ts";
import { SignUpHandler } from "./application/commands/sign-up/sign-up.handler.ts";
import { UpdateProfileHandler } from "./application/commands/update-profile/update-profile.handler.ts";
import { VerifyMfaOtpHandler } from "./application/commands/verify-mfa-otp/verify-mfa-otp.handler.ts";
import { VerifyMfaRecoveryCodeHandler } from "./application/commands/verify-mfa-recovery-code/verify-mfa-recovery-code.handler.ts";
import { CheckSensitiveRouteHandler } from "./application/queries/check-sensitive-route/check-sensitive-route.handler.ts";
import { GetWorkspaceHandler } from "./application/queries/get-workspace/get-workspace.handler.ts";
import { GetAuthProfileHandler } from "./application/queries/get-auth-profile/get-auth-profile.handler.ts";
import { ListAuthRepositoriesHandler } from "./application/queries/list-auth-repositories/list-auth-repositories.handler.ts";
import { ListAuthSessionsHandler } from "./application/queries/list-auth-sessions/list-auth-sessions.handler.ts";
import {
  AUTH_WORKSPACE_RECOVERY_NOTIFIER,
  type RecoveryNotifier,
} from "./application/ports/notification/recovery-notifier.ts";
import type { AuthWorkspaceRepositories } from "./application/ports/persistence/auth-workspace-repositories.ts";
import { AuthAuditService } from "./application/services/auth-workspace/auth-audit.service.ts";
import { AuthWorkspaceSupportService } from "./application/services/auth-workspace/auth-workspace-support.service.ts";
import { AuthWorkspaceFacade } from "./application/services/auth-workspace/auth-workspace.facade.ts";
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

const AUTH_WORKSPACE_REPOSITORIES_BAG = "AUTH_WORKSPACE_REPOSITORIES_BAG";

function handlerProvider<T>(
  handlerClass: new (
    support: AuthWorkspaceSupportService,
    repositories: AuthWorkspaceRepositories,
    ...rest: never[]
  ) => T,
) {
  return {
    provide: handlerClass,
    inject: [AuthWorkspaceSupportService, AUTH_WORKSPACE_REPOSITORIES_BAG],
    useFactory: (
      support: AuthWorkspaceSupportService,
      repositories: AuthWorkspaceRepositories,
    ) => new handlerClass(support, repositories),
  };
}

@Module({
  imports: [PrismaModule, AuditModule, CqrsModule],
  controllers: [AuthWorkspaceController],
  providers: [
    ...REPOSITORY_PROVIDERS,
    {
      provide: AUTH_WORKSPACE_REPOSITORIES_BAG,
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
    handlerProvider(SignInHandler),
    {
      provide: SignUpHandler,
      inject: [PrismaService, AuthAuditService],
      useFactory: (prisma: PrismaService, authAudit: AuthAuditService) =>
        new SignUpHandler(prisma, authAudit),
    },
    handlerProvider(RevokeSessionHandler),
    {
      provide: RevokeOwnedSessionHandler,
      inject: [PrismaService, AuthWorkspaceSupportService],
      useFactory: (
        prisma: PrismaService,
        support: AuthWorkspaceSupportService,
      ) => new RevokeOwnedSessionHandler(prisma, support),
    },
    {
      provide: GetAuthProfileHandler,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new GetAuthProfileHandler(prisma),
    },
    {
      provide: ListAuthSessionsHandler,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ListAuthSessionsHandler(prisma),
    },
    {
      provide: ListAuthRepositoriesHandler,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ListAuthRepositoriesHandler(prisma),
    },
    CheckSensitiveRouteHandler,
    handlerProvider(GetWorkspaceHandler),
    handlerProvider(DisableMfaHandler),
    handlerProvider(EnrollMfaHandler),
    handlerProvider(VerifyMfaOtpHandler),
    handlerProvider(VerifyMfaRecoveryCodeHandler),
    handlerProvider(GenerateMfaRecoveryCodesHandler),
    handlerProvider(RecordMfaRecoveryCodeAccessHandler),
    handlerProvider(UpdateProfileHandler),
    handlerProvider(ReauthenticatePasswordHandler),
    {
      provide: RequestPasswordRecoveryHandler,
      inject: [
        AuthWorkspaceSupportService,
        AUTH_WORKSPACE_REPOSITORIES_BAG,
        AUTH_WORKSPACE_RECOVERY_NOTIFIER,
      ],
      useFactory: (
        support: AuthWorkspaceSupportService,
        repositories: AuthWorkspaceRepositories,
        notifier: RecoveryNotifier,
      ) => new RequestPasswordRecoveryHandler(support, repositories, notifier),
    },
    handlerProvider(ConfirmPasswordRecoveryHandler),
    {
      provide: OAuthStartHandler,
      inject: [
        AuthWorkspaceSupportService,
        AUTH_WORKSPACE_REPOSITORIES_BAG,
        OAuthProviderRegistry,
        ConfigService,
      ],
      useFactory: (
        support: AuthWorkspaceSupportService,
        repositories: AuthWorkspaceRepositories,
        providerRegistry: OAuthProviderRegistry,
        configService: ConfigService,
      ) =>
        new OAuthStartHandler(
          support,
          repositories,
          providerRegistry,
          configService,
        ),
    },
    {
      provide: OAuthCallbackHandler,
      inject: [
        AuthWorkspaceSupportService,
        AUTH_WORKSPACE_REPOSITORIES_BAG,
        OAuthProviderRegistry,
      ],
      useFactory: (
        support: AuthWorkspaceSupportService,
        repositories: AuthWorkspaceRepositories,
        providerRegistry: OAuthProviderRegistry,
      ) => new OAuthCallbackHandler(support, repositories, providerRegistry),
    },
    {
      provide: OAuthLinkStartHandler,
      inject: [
        AuthWorkspaceSupportService,
        AUTH_WORKSPACE_REPOSITORIES_BAG,
        OAuthProviderRegistry,
        ConfigService,
      ],
      useFactory: (
        support: AuthWorkspaceSupportService,
        repositories: AuthWorkspaceRepositories,
        providerRegistry: OAuthProviderRegistry,
        configService: ConfigService,
      ) =>
        new OAuthLinkStartHandler(
          support,
          repositories,
          providerRegistry,
          configService,
        ),
    },
    {
      provide: OAuthLinkCallbackHandler,
      inject: [
        AuthWorkspaceSupportService,
        AUTH_WORKSPACE_REPOSITORIES_BAG,
        OAuthProviderRegistry,
      ],
      useFactory: (
        support: AuthWorkspaceSupportService,
        repositories: AuthWorkspaceRepositories,
        providerRegistry: OAuthProviderRegistry,
      ) =>
        new OAuthLinkCallbackHandler(support, repositories, providerRegistry),
    },
    {
      provide: AuthWorkspaceFacade,
      inject: [
        SignInHandler,
        SignUpHandler,
        RevokeSessionHandler,
        RevokeOwnedSessionHandler,
        GetAuthProfileHandler,
        ListAuthSessionsHandler,
        ListAuthRepositoriesHandler,
        GetWorkspaceHandler,
        DisableMfaHandler,
        EnrollMfaHandler,
        VerifyMfaOtpHandler,
        VerifyMfaRecoveryCodeHandler,
        GenerateMfaRecoveryCodesHandler,
        RecordMfaRecoveryCodeAccessHandler,
        UpdateProfileHandler,
        RequestPasswordRecoveryHandler,
        ConfirmPasswordRecoveryHandler,
        ReauthenticatePasswordHandler,
        OAuthStartHandler,
        OAuthCallbackHandler,
        OAuthLinkStartHandler,
        OAuthLinkCallbackHandler,
      ],
      useFactory: (
        signInHandler: SignInHandler,
        signUpHandler: SignUpHandler,
        revokeSessionHandler: RevokeSessionHandler,
        revokeOwnedSessionHandler: RevokeOwnedSessionHandler,
        getAuthProfileHandler: GetAuthProfileHandler,
        listAuthSessionsHandler: ListAuthSessionsHandler,
        listAuthRepositoriesHandler: ListAuthRepositoriesHandler,
        getWorkspaceHandler: GetWorkspaceHandler,
        disableMfaHandler: DisableMfaHandler,
        enrollMfaHandler: EnrollMfaHandler,
        verifyMfaOtpHandler: VerifyMfaOtpHandler,
        verifyMfaRecoveryCodeHandler: VerifyMfaRecoveryCodeHandler,
        generateMfaRecoveryCodesHandler: GenerateMfaRecoveryCodesHandler,
        recordMfaRecoveryCodeAccessHandler: RecordMfaRecoveryCodeAccessHandler,
        updateProfileHandler: UpdateProfileHandler,
        requestPasswordRecoveryHandler: RequestPasswordRecoveryHandler,
        confirmPasswordRecoveryHandler: ConfirmPasswordRecoveryHandler,
        reauthenticatePasswordHandler: ReauthenticatePasswordHandler,
        oauthStartHandler: OAuthStartHandler,
        oauthCallbackHandler: OAuthCallbackHandler,
        oauthLinkStartHandler: OAuthLinkStartHandler,
        oauthLinkCallbackHandler: OAuthLinkCallbackHandler,
      ) =>
        new AuthWorkspaceFacade(
          signInHandler,
          signUpHandler,
          revokeSessionHandler,
          revokeOwnedSessionHandler,
          getAuthProfileHandler,
          listAuthSessionsHandler,
          listAuthRepositoriesHandler,
          getWorkspaceHandler,
          disableMfaHandler,
          enrollMfaHandler,
          verifyMfaOtpHandler,
          verifyMfaRecoveryCodeHandler,
          generateMfaRecoveryCodesHandler,
          recordMfaRecoveryCodeAccessHandler,
          updateProfileHandler,
          requestPasswordRecoveryHandler,
          confirmPasswordRecoveryHandler,
          reauthenticatePasswordHandler,
          oauthStartHandler,
          oauthCallbackHandler,
          oauthLinkStartHandler,
          oauthLinkCallbackHandler,
        ),
    },
  ],
  exports: [
    AuthWorkspaceFacade,
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
