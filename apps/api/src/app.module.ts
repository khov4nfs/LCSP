import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, configValidationSchema } from "./config/config.js";
import { AppFeatureModule } from "./modules/app/app.module.js";
import { AIUsageFlowModule } from "./modules/ai-usage-flow/ai-usage-flow.module.js";
import { AssessmentModule } from "./modules/assessment/assessment.module.js";
import { AuditModule as AuditFeatureModule } from "./modules/audit/audit.module.js";
import { AuthWorkspaceModule } from "./modules/auth-workspace/auth-workspace.module.js";
import { ClassificationModule } from "./modules/classification/classification.module.js";
import { EvidenceModule } from "./modules/evidence/evidence.module.js";

import { DocumentModule } from "./modules/document/document.module.js";
import { GitHubIntegrationModule } from "./modules/github-integration/github-integration.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ReconciliationModule } from "./modules/reconciliation/reconciliation.module.js";
import { ScanModule } from "./modules/scan/scan.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { WizardModule } from "./modules/wizard/wizard.module.js";
import { LegalRuleCatalogModule } from "./modules/legal-rule-catalog/legal-rule-catalog.module.js";
import { OutboxModule } from "./platform/outbox/outbox.module.js";
import { PbacModule } from "./platform/pbac/pbac.module.js";
import { AuditModule as AuditPlatformModule } from "./platform/audit/audit.module.js";
import { MailModule } from "./platform/mail/mail.module.js";
import { HttpLoggerMiddleware } from "./platform/logging/http-logger.middleware.js";
import { ProblemExceptionFilter } from "./platform/problems/problem-exception.filter.js";
import { ProblemStatusInterceptor } from "./platform/problems/problem-status.interceptor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(appRoot, "..", "..");
const rootEnvPath = path.join(workspaceRoot, ".env");
const rootTestEnvPath = path.join(workspaceRoot, ".env.test");

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === "test"
          ? [rootTestEnvPath, rootEnvPath]
          : [rootEnvPath],
      load: [config],
      validationSchema: configValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    AuditPlatformModule,
    MailModule,
    OutboxModule,
    PbacModule,
    AIUsageFlowModule,
    AppFeatureModule,
    AuthWorkspaceModule,
    UsersModule,
    AssessmentModule,
    EvidenceModule,
    DocumentModule,
    GitHubIntegrationModule,
    ReconciliationModule,
    ScanModule,
    ClassificationModule,
    AuditFeatureModule,
    WizardModule,
    LegalRuleCatalogModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ProblemStatusInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes("*");
  }
}
