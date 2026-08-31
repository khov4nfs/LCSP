import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
import { PROVIDER_CREDENTIAL_REPOSITORY } from "./application/ports/persistence/provider-credential.repository.js";
import { CREDENTIAL_STORE } from "./application/ports/security/credential-store.port.js";
import { ACTIVE_PROVIDER_CREDENTIAL_RESOLVER } from "./application/ports/security/active-provider-credential.resolver.js";
import { CREDENTIAL_AUTHORIZATION_RESOLVER } from "./application/ports/security/credential-authorization-resolver.port.js";
import { KEY_ENCRYPTION_KEY_PROVIDER } from "./application/ports/security/key-encryption-key-provider.port.js";
import type { AppConfig } from "../../config/config.types.js";
import { GitHubAppClient } from "./infrastructure/github/github-app.client.js";
import { SnapshotArchiveCache } from "./infrastructure/github/snapshot-archive-cache.js";
import { PrismaGitHubAppInstallStateRepository } from "./infrastructure/persistence/prisma-github-app-install-state.repository.js";
import { PrismaRepositoryConnectionRepository } from "./infrastructure/persistence/prisma-github-integration.repository.js";
import { PrismaRepositorySnapshotRepository } from "./infrastructure/persistence/prisma-repository-snapshot.repository.js";
import { PrismaRepositoryScanJobRepository } from "./infrastructure/persistence/prisma-repository-scan-job.repository.js";
import { PrismaProviderCredentialRepository } from "./infrastructure/persistence/prisma-credential.repositories.js";
import { PrismaDatabaseCredentialStore } from "./infrastructure/persistence/prisma-database-credential.store.js";
import { PrismaCredentialAuthorizationResolver } from "./infrastructure/persistence/prisma-credential-authorization.resolver.js";
import { PrismaActiveProviderCredentialResolver } from "./infrastructure/persistence/prisma-active-provider-credential.resolver.js";
import { PrismaCredentialPersistenceUnitOfWork } from "./infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import { EnvelopeEncryptionService } from "./infrastructure/security/envelope-encryption.service.js";
import { createCredentialKeyEncryptionKeyProvider } from "./infrastructure/security/credential-key-encryption-key-provider.factory.js";
import { InternalSnapshotController } from "./presentation/http/internal-snapshot.controller.js";
import { GitHubIntegrationController } from "./presentation/http/github-integration.controller.js";
import { ScanTriggerGuard } from "./presentation/http/scan-trigger.guard.js";
import { GitHubCredentialRequestGuard } from "./presentation/http/github-credential-request.guard.js";
import { DiscoverGitHubRepositoriesHandler } from "./application/commands/discover-github-repositories/discover-github-repositories.handler.js";
import { ConnectGitHubCliRepositoryHandler } from "./application/commands/connect-github-cli-repository/connect-github-cli-repository.handler.js";
import { ConfigureProviderCredentialHandler } from "./application/commands/configure-provider-credential/configure-provider-credential.handler.js";
import { ConnectAssessmentRepositoryHandler } from "./application/commands/connect-assessment-repository/connect-assessment-repository.handler.js";
import {
  GITHUB_REPOSITORY_PROVIDER,
  REPOSITORY_PROVIDER_REGISTRY,
  type GitHubRepositoryProviderPort,
  type RepositoryProviderAdapter,
} from "./application/ports/github-repository-provider.port.js";
import {
  GitHubCliProviderError,
  GitHubCliRepositoryProvider,
} from "./infrastructure/github/github-cli-repository.provider.js";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";
import {
  GITHUB_ARCHIVE_TRANSPORT,
  REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY,
  type GitHubArchiveTransportPort,
} from "./application/ports/github-archive-transport.port.js";
import { GitHubSecureArchiveHttpTransport } from "./infrastructure/github/github-secure-archive-http.transport.js";
import {
  assertGitHubCliRuntime,
  resolveGitHubCliExecutablePath,
} from "./infrastructure/github/github-cli-runtime.validator.js";
import { GitLabCliRepositoryProvider } from "./infrastructure/gitlab/gitlab-cli-repository.provider.js";
import { ConfiguredRepositoryProviderRegistry } from "./infrastructure/repository-provider.registry.js";
import { GitLabSecureArchiveHttpTransport } from "./infrastructure/gitlab/gitlab-secure-archive-http.transport.js";
import {
  assertGitLabCliRuntime,
  resolveGitLabCliExecutablePath,
} from "./infrastructure/gitlab/gitlab-cli-runtime.validator.js";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

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
    DiscoverGitHubRepositoriesHandler,
    ConnectGitHubCliRepositoryHandler,
    ConfigureProviderCredentialHandler,
    ConnectAssessmentRepositoryHandler,
    {
      provide: REPOSITORY_PROVIDER_REGISTRY,
      inject: [GITHUB_REPOSITORY_PROVIDER, ConfigService],
      useFactory: (
        githubProvider: GitHubRepositoryProviderPort,
        configService: ConfigService<AppConfig, true>,
      ) => {
        const gitlab = configService.get("gitlabCli", { infer: true });
        let gitlabProvider: RepositoryProviderAdapter;
        if (!gitlab.enabled) {
          gitlabProvider = {
            validateIdentity: () =>
              Promise.reject(new Error("gitlab_cli_unavailable")),
            listAccessibleRepositories: () =>
              Promise.reject(new Error("gitlab_cli_unavailable")),
            validateRepositoryAccess: () =>
              Promise.reject(new Error("gitlab_cli_unavailable")),
            resolveCommit: () =>
              Promise.reject(new Error("gitlab_cli_unavailable")),
            downloadArchive: () =>
              Promise.reject(new Error("gitlab_cli_unavailable")),
          };
        } else {
          const executablePath = resolveGitLabCliExecutablePath(
            gitlab.executablePath,
          );
          assertGitLabCliRuntime(executablePath);
          gitlabProvider = new GitLabCliRepositoryProvider({
            ...gitlab,
            executablePath,
          });
        }
        return new ConfiguredRepositoryProviderRegistry(
          new Map([
            [CREDENTIAL_PROVIDERS.github, githubProvider],
            [CREDENTIAL_PROVIDERS.gitlab, gitlabProvider],
          ]),
        );
      },
    },
    GitHubAppClient,
    SnapshotArchiveCache,
    WorkerApiKeyGuard,
    PrismaGitHubAppInstallStateRepository,
    PrismaRepositoryConnectionRepository,
    PrismaRepositorySnapshotRepository,
    PrismaRepositoryScanJobRepository,
    PrismaProviderCredentialRepository,
    EnvelopeEncryptionService,
    PrismaDatabaseCredentialStore,
    PrismaCredentialAuthorizationResolver,
    PrismaCredentialPersistenceUnitOfWork,
    ScanTriggerGuard,
    GitHubCredentialRequestGuard,
    {
      provide: GITHUB_ARCHIVE_TRANSPORT,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<AppConfig, true>,
      ): GitHubArchiveTransportPort => {
        const cli = configService.get("githubCli", { infer: true });
        return new GitHubSecureArchiveHttpTransport({
          timeoutMs: cli.archiveTimeoutMs,
          maxArchiveBytes: cli.maxArchiveBytes,
        });
      },
    },
    {
      provide: GITHUB_REPOSITORY_PROVIDER,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<AppConfig, true>,
      ): GitHubRepositoryProviderPort => {
        const persistence = configService.get("githubCredentialPersistence", {
          infer: true,
        });
        const cli = configService.get("githubCli", { infer: true });
        if (!persistence.enabled) {
          const unavailable = (): Promise<never> =>
            Promise.reject(
              new GitHubCliProviderError(
                GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
              ),
            );
          return {
            validateIdentity: unavailable,
            listAccessibleRepositories: unavailable,
            validateRepositoryAccess: unavailable,
            resolveCommit: unavailable,
            downloadArchive: unavailable,
          };
        }
        const executablePath = resolveGitHubCliExecutablePath(
          cli.executablePath,
        );
        assertGitHubCliRuntime(executablePath);
        return new GitHubCliRepositoryProvider({ ...cli, executablePath });
      },
    },
    {
      provide: REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY,
      inject: [GITHUB_ARCHIVE_TRANSPORT, ConfigService],
      useFactory: (
        githubTransport: GitHubArchiveTransportPort,
        configService: ConfigService<AppConfig, true>,
      ) => {
        const cli = configService.get("githubCli", { infer: true });
        const gitlab = new GitLabSecureArchiveHttpTransport({
          timeoutMs: cli.archiveTimeoutMs,
          maxArchiveBytes: cli.maxArchiveBytes,
        });
        return {
          get(provider: string): GitHubArchiveTransportPort {
            if (provider === CREDENTIAL_PROVIDERS.github)
              return githubTransport;
            if (provider === CREDENTIAL_PROVIDERS.gitlab) return gitlab;
            throw new Error(
              `repository_archive_transport_unavailable:${provider}`,
            );
          },
        };
      },
    },
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
    {
      provide: PROVIDER_CREDENTIAL_REPOSITORY,
      useExisting: PrismaProviderCredentialRepository,
    },
    {
      provide: KEY_ENCRYPTION_KEY_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const persistence = configService.get("githubCredentialPersistence", {
          infer: true,
        });
        return createCredentialKeyEncryptionKeyProvider(persistence);
      },
    },
    { provide: CREDENTIAL_STORE, useExisting: PrismaDatabaseCredentialStore },
    {
      provide: ACTIVE_PROVIDER_CREDENTIAL_RESOLVER,
      useClass: PrismaActiveProviderCredentialResolver,
    },
    {
      provide: CREDENTIAL_AUTHORIZATION_RESOLVER,
      useExisting: PrismaCredentialAuthorizationResolver,
    },
  ],
})
export class GitHubIntegrationModule {}
