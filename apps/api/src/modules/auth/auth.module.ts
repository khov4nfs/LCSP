import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PrismaModule } from "../../infrastructure/prisma/prisma.module.ts";
import { AuditModule } from "../../platform/audit/audit.module.ts";
import { MailModule } from "../../platform/mail/mail.module.ts";
import { AUTH_COMMAND_HANDLERS } from "./application/commands/index.ts";
import { AUTH_RECOVERY_NOTIFIER } from "./application/ports/notification/recovery-notifier.ts";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
} from "./application/ports/persistence/index.ts";
import { AUTH_QUERY_HANDLERS } from "./application/queries/index.ts";
import { AuthAuditService } from "./application/services/auth/auth-audit.service.ts";
import { AuthSupportService } from "./application/services/auth/auth-support.service.ts";
import { RecoveryEmailNotifierService } from "./infrastructure/notification/recovery-email-notifier.service.ts";
import { GoogleOAuthProvider } from "./infrastructure/oauth/google-oauth.provider.ts";
import { OAuthProviderRegistry } from "./infrastructure/oauth/oauth-provider.registry.ts";
import { AUTH_PERSISTENCE_PROVIDERS } from "./infrastructure/persistence/index.ts";
import { AUTH_CONTROLLERS } from "./presentation/http/index.ts";

@Module({
  imports: [PrismaModule, AuditModule, CqrsModule, MailModule],
  controllers: [...AUTH_CONTROLLERS],
  providers: [
    ...AUTH_PERSISTENCE_PROVIDERS,
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
    ...AUTH_COMMAND_HANDLERS,
    ...AUTH_QUERY_HANDLERS,
  ],
  exports: [
    AuthAuditService,
    AUTH_USER_REPOSITORY,
    AUTH_SESSION_REPOSITORY,
    AUTH_MFA_ENROLLMENT_REPOSITORY,
  ],
})
export class AuthModule {}
