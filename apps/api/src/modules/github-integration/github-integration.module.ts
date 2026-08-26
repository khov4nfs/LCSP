import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { GitHubAppCallbackHandler } from "./application/commands/github-app-callback/github-app-callback.handler.js";
import { GitHubAppStartHandler } from "./application/commands/github-app-start/github-app-start.handler.js";
import { PinSnapshotHandler } from "./application/commands/pin-snapshot/pin-snapshot.handler.js";
import { TriggerScanHandler } from "./application/commands/trigger-scan/trigger-scan.handler.js";
import { StreamSnapshotArchiveHandler } from "./application/queries/stream-snapshot-archive/stream-snapshot-archive.handler.js";
import { GITHUB_APP_INSTALL_STATE_REPOSITORY } from "./application/ports/persistence/github-app-install-state.repository.js";
import { REPOSITORY_CONNECTION_REPOSITORY } from "./application/ports/persistence/repository-connection.repository.js";
import { REPOSITORY_SNAPSHOT_REPOSITORY } from "./application/ports/persistence/repository-snapshot.repository.js";
import { REPOSITORY_SCAN_JOB_REPOSITORY } from "./application/ports/persistence/repository-scan-job.repository.js";
import { GitHubAppClient } from "./infrastructure/github/github-app.client.js";
import { SnapshotArchiveCache } from "./infrastructure/github/snapshot-archive-cache.js";
import { PrismaGitHubAppInstallStateRepository } from "./infrastructure/persistence/prisma-github-app-install-state.repository.js";
import { PrismaRepositoryConnectionRepository } from "./infrastructure/persistence/prisma-github-integration.repository.js";
import { PrismaRepositorySnapshotRepository } from "./infrastructure/persistence/prisma-repository-snapshot.repository.js";
import { PrismaRepositoryScanJobRepository } from "./infrastructure/persistence/prisma-repository-scan-job.repository.js";
import { InternalSnapshotController } from "./presentation/http/internal-snapshot.controller.js";
import { GitHubIntegrationController } from "./presentation/http/github-integration.controller.js";
import { ScanTriggerGuard } from "./presentation/http/scan-trigger.guard.js";

/**
 * Wires GitHub App connectivity, immutable snapshot pinning/streaming, and repository scan triggering across HTTP, CQRS, and Prisma adapters.
 */
@Module({
  imports: [CqrsModule, RbacModule],
  controllers: [GitHubIntegrationController, InternalSnapshotController],
  providers: [
    GitHubAppStartHandler,
    GitHubAppCallbackHandler,
    PinSnapshotHandler,
    TriggerScanHandler,
    StreamSnapshotArchiveHandler,
    GitHubAppClient,
    SnapshotArchiveCache,
    WorkerApiKeyGuard,
    PrismaGitHubAppInstallStateRepository,
    PrismaRepositoryConnectionRepository,
    PrismaRepositorySnapshotRepository,
    PrismaRepositoryScanJobRepository,
    ScanTriggerGuard,
    {
      provide: GITHUB_APP_INSTALL_STATE_REPOSITORY,
      useExisting: PrismaGitHubAppInstallStateRepository,
    },
    {
      provide: REPOSITORY_CONNECTION_REPOSITORY,
      useExisting: PrismaRepositoryConnectionRepository,
    },
    {
      provide: REPOSITORY_SNAPSHOT_REPOSITORY,
      useExisting: PrismaRepositorySnapshotRepository,
    },
    {
      provide: REPOSITORY_SCAN_JOB_REPOSITORY,
      useExisting: PrismaRepositoryScanJobRepository,
    },
  ],
})
export class GitHubIntegrationModule {}
