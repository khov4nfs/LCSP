import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, configValidationSchema } from "./config/config.js";
import { AIUsageFlowModule } from "./modules/ai-usage-flow/ai-usage-flow.module.js";
import { AppFeatureModule } from "./modules/app/app.module.js";
import { AssessmentModule } from "./modules/assessment/assessment.module.js";
import { AuditModule as AuditFeatureModule } from "./modules/audit/audit.module.js";
import { AuthWorkspaceModule } from "./modules/auth-workspace/auth-workspace.module.js";
import { ClassificationModule } from "./modules/classification/classification.module.js";
import { EvidenceModule } from "./modules/evidence/evidence.module.js";

import { DocumentModule } from "./modules/document/document.module.js";
import { GitHubIntegrationModule } from "./modules/github-integration/github-integration.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { LegalRuleCatalogModule } from "./modules/legal-rule-catalog/legal-rule-catalog.module.js";
import { ReconciliationModule } from "./modules/reconciliation/reconciliation.module.js";
import { ScanModule } from "./modules/scan/scan.module.js";
import { WizardModule } from "./modules/wizard/wizard.module.js";
import { AuditModule as AuditPlatformModule } from "./platform/audit/audit.module.js";
import { LoggingContextMiddleware } from "./platform/logging/logging-context.middleware.js";
import { DevUnsafeHttpTraceMiddleware } from "./platform/logging/dev-unsafe-http-trace.middleware.js";
import { HttpLoggerMiddleware } from "./platform/logging/http-logger.middleware.js";
import { unsafeDevTraceEnabled } from "./platform/logging/dev-unsafe-trace.js";
import { MailModule } from "./platform/mail/mail.module.js";
import { OutboxModule } from "./platform/outbox/outbox.module.js";
import { RbacModule } from "./platform/rbac/rbac.module.js";
import { ProblemExceptionFilter } from "./platform/problems/problem-exception.filter.js";
import { ProblemStatusInterceptor } from "./platform/problems/problem-status.interceptor.js";
import { StorageModule } from "./platform/storage/storage.module.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = resolveEnvPath([".env.pm2", ".env"]);
const rootTestEnvPath = resolveEnvPath([".env.test", ".env.pm2", ".env"]);

function resolveEnvPath(
  filenames: ReadonlyArray<".env" | ".env.test" | ".env.pm2">,
): string | undefined {
  const startDirs = [
    process.cwd(),
    __dirname,
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", ".."),
  ];

  for (const startDir of startDirs) {
    for (const filename of filenames) {
      const resolved = findUpwards(startDir, filename);
      if (resolved) {
        return resolved;
      }
    }
  }

  return undefined;
}

function findUpwards(
  startDir: string,
  filename: ".env" | ".env.test" | ".env.pm2",
): string | undefined {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, filename);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: (process.env.NODE_ENV === "test"
        ? [rootTestEnvPath, rootEnvPath]
        : [rootEnvPath]
      ).filter((value): value is string => typeof value === "string"),
      load: [config],
      validationSchema: configValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    AuditPlatformModule,
    MailModule,
    OutboxModule,
    RbacModule,
    StorageModule,
    AIUsageFlowModule,
    AppFeatureModule,
    AuthWorkspaceModule,
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
    // Fail during API bootstrap if unsafe raw logging was accidentally combined
    // with production mode. Outside explicit unsafe dev tracing this is a no-op.
    unsafeDevTraceEnabled();
    consumer
      .apply(
        LoggingContextMiddleware,
        DevUnsafeHttpTraceMiddleware,
        HttpLoggerMiddleware,
      )
      .forRoutes("*");
  }
}
