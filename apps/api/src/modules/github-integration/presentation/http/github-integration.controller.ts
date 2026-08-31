import {
  Body,
  Controller,
  Inject,
  Optional,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";
import type { Response } from "express";

import { createCorrelationId } from "../../../auth-workspace/infrastructure/security/security.utils.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ReAuthForSensitiveRoute } from "../../../../platform/security/decorators/re-auth-for-sensitive-route.decorator.js";
import { SENSITIVE_ROUTE_IDS } from "../../../../platform/security/sensitive-route-policy.js";
import { GitHubAppCallbackCommand } from "../../application/commands/github-app-callback/github-app-callback.command.js";
import { GitHubAppStartCommand } from "../../application/commands/github-app-start/github-app-start.command.js";
import { PinSnapshotCommand } from "../../application/commands/pin-snapshot/pin-snapshot.command.js";
import { TriggerScanCommand } from "../../application/commands/trigger-scan/trigger-scan.command.js";
import type { PinSnapshotDto } from "../../application/contracts/github-integration/pin-snapshot.contract.js";
import type { TriggerScanDto } from "../../application/contracts/github-integration/trigger-scan.contract.js";
import { PinSnapshotRequest } from "./dto/pin-snapshot.request.js";
import { TriggerScanRequest } from "./dto/trigger-scan.request.js";
import {
  GitHubCliRepositoryConnectionRequest,
  GitHubRepositoryDiscoveryRequest,
} from "./dto/github-credential.request.js";
import { GitHubCredentialRequestGuard } from "./github-credential-request.guard.js";
import { DiscoverGitHubRepositoriesCommand } from "../../application/commands/discover-github-repositories/discover-github-repositories.command.js";
import { ConnectGitHubCliRepositoryCommand } from "../../application/commands/connect-github-cli-repository/connect-github-cli-repository.command.js";
import { ConfigureProviderCredentialCommand } from "../../application/commands/configure-provider-credential/configure-provider-credential.command.js";
import { ProviderCredentialRequest } from "./dto/provider-credential.request.js";
import { AssessmentRepositoryConnectionRequest } from "./dto/assessment-repository-connection.request.js";
import { ConnectAssessmentRepositoryCommand } from "../../application/commands/connect-assessment-repository/connect-assessment-repository.command.js";
import {
  ACTIVE_PROVIDER_CREDENTIAL_RESOLVER,
  type ActiveProviderCredentialResolver,
} from "../../application/ports/security/active-provider-credential.resolver.js";
import {
  ScanTriggerGuard,
  type ScanTriggerRequestContext,
} from "./scan-trigger.guard.js";

interface GitHubIntegrationRequest extends ScanTriggerRequestContext {
  rbacContext?: RbacRequestContext;
  correlationId?: string;
}

/**
 * Exposes GitHub App connection, repository snapshot pinning, and scan-trigger HTTP operations.
 */
@Controller()
export class GitHubIntegrationController {
  /**
   * Creates the controller with the CQRS command dispatcher used by all GitHub integration mutations.
   *
   * @param commandBus - Command bus used to start/complete App installation, pin snapshots, and trigger scans.
   */
  constructor(
    private readonly commandBus: CommandBus,
    @Optional()
    @Inject(ACTIVE_PROVIDER_CREDENTIAL_RESOLVER)
    private readonly activeCredentials?: ActiveProviderCredentialResolver,
  ) {}

  @Get("provider-credentials")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async listProviderCredentials(@Req() request: GitHubIntegrationRequest) {
    const context = request.rbacContext as RbacRequestContext;
    if (!this.activeCredentials)
      throw new Error("provider_credentials_unavailable");
    const activeCredentials = this.activeCredentials;
    const providers = [
      CREDENTIAL_PROVIDERS.github,
      CREDENTIAL_PROVIDERS.gitlab,
    ];
    return resultEnvelope(
      await Promise.all(
        providers.map(async (provider) => {
          const metadata = await activeCredentials.findMetadata({
            userId: context.userId,
            provider,
          });
          return {
            provider,
            configured: metadata !== null,
            account: metadata
              ? {
                  id: metadata.providerAccountId,
                  username: metadata.providerLogin,
                }
              : null,
          };
        }),
      ),
    );
  }

  @Post("github/repository-discoveries")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard, GitHubCredentialRequestGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.githubCliRepositoryDiscovery,
    method: "POST",
    pathTemplate: "/github/repository-discoveries",
    aliases: [
      { method: "POST", pathTemplate: "/api/github/repository-discoveries" },
    ],
  })
  async discoverRepositories(
    @Body() body: GitHubRepositoryDiscoveryRequest,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.rbacContext as RbacRequestContext;
    return resultEnvelope(
      await this.commandBus.execute(
        new DiscoverGitHubRepositoriesCommand(
          context.userId,
          context.role,
          context.sessionId,
          body.credential,
          body.limit,
          body.cursor,
          request.correlationId as string,
        ),
      ),
    );
  }

  @Post("github/repository-connections")
  @UseGuards(RbacGuard, GitHubCredentialRequestGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.githubCliRepositoryConnect,
    method: "POST",
    pathTemplate: "/github/repository-connections",
    aliases: [
      { method: "POST", pathTemplate: "/api/github/repository-connections" },
    ],
  })
  async connectCliRepository(
    @Body() body: GitHubCliRepositoryConnectionRequest,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.rbacContext as RbacRequestContext;
    return resultEnvelope(
      await this.commandBus.execute(
        new ConnectGitHubCliRepositoryCommand(
          context.userId,
          context.role,
          context.sessionId,
          body.credential,
          body.repository_full_name,
          body.assessment_id,
          body.credential_expires_at,
          request.correlationId as string,
          body.provider ?? CREDENTIAL_PROVIDERS.github,
          body.repository_url,
        ),
      ),
    );
  }

  @Post("provider-credentials")
  @UseGuards(RbacGuard, GitHubCredentialRequestGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.githubCliRepositoryConnect,
    method: "POST",
    pathTemplate: "/provider-credentials",
    aliases: [{ method: "POST", pathTemplate: "/api/provider-credentials" }],
  })
  async configureProviderCredential(
    @Body() body: ProviderCredentialRequest,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.rbacContext as RbacRequestContext;
    return resultEnvelope(
      await this.commandBus.execute(
        new ConfigureProviderCredentialCommand(
          context.userId,
          context.role,
          context.sessionId,
          body.provider,
          body.credential,
          request.correlationId as string,
        ),
      ),
    );
  }

  @Post("assessments/:assessmentId/repository-connection")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async connectAssessmentRepository(
    @Param("assessmentId") assessmentId: string,
    @Body() body: AssessmentRepositoryConnectionRequest,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.rbacContext as RbacRequestContext;
    return resultEnvelope(
      await this.commandBus.execute(
        new ConnectAssessmentRepositoryCommand(
          assessmentId,
          context.userId,
          context.role,
          body.repositoryUrl,
          request.correlationId as string,
        ),
      ),
    );
  }

  /**
   * Starts or resumes the sensitive GitHub App installation flow for the authenticated organization/user.
   *
   * @param redirectUri - Allowlisted client redirect URI to restore after GitHub callback.
   * @param assessmentId - Optional assessment to bind to the resulting repository connection.
   * @param installationId - Optional existing installation identifier for reconnect/resume flows.
   * @param request - RBAC-authenticated request containing user, session, and correlation context.
   * @returns Standard result envelope containing the GitHub installation URL.
   */
  @Get("github/app/start")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.githubAppStart,
    method: "GET",
    pathTemplate: "/github/app/start",
    aliases: [{ method: "GET", pathTemplate: "/api/github/app/start" }],
  })
  async startAppInstallation(
    @Query("redirect_uri") redirectUri: string | undefined,
    @Query("assessment_id") assessmentId: string | undefined,
    @Query("installation_id") installationId: string | undefined,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const rbacContext = request.rbacContext as RbacRequestContext;

    return resultEnvelope(
      await this.commandBus.execute(
        new GitHubAppStartCommand(
          rbacContext.userId,
          redirectUri,
          assessmentId,
          request.correlationId as string,
          rbacContext.sessionId,
          installationId,
        ),
      ),
    );
  }

  /**
   * Completes the public GitHub App callback using the opaque state created by the installation-start flow.
   *
   * @param installationId - GitHub App installation identifier returned by GitHub.
   * @param code - GitHub callback authorization code.
   * @param state - Opaque installation state binding the callback to the original request.
   * @param repositoryId - Optional repository selected during the installation flow.
   * @param correlationId - Optional upstream correlation identifier; generated when absent.
   * @returns Standard result envelope containing the established repository connection.
   */
  @Get("github/app/callback")
  async handleAppCallback(
    @Query("installation_id") installationId: string,
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("repository_id") repositoryId: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new GitHubAppCallbackCommand(
          installationId,
          code,
          state,
          correlationId ?? createCorrelationId(),
          repositoryId,
        ),
      ),
    );
  }

  /**
   * Pins an exact immutable GitHub commit as an assessment repository snapshot.
   *
   * @param assessmentId - Assessment that will own the snapshot.
   * @param body - Repository connection plus optional branch/ref/commit selectors.
   * @param request - RBAC-authenticated request containing actor, scope, and correlation context.
   * @returns Standard result envelope containing persisted snapshot metadata.
   */
  @Post("assessments/:assessmentId/snapshots")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async pinSnapshot(
    @Param("assessmentId") assessmentId: string,
    @Body() body: PinSnapshotRequest,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.rbacContext as RbacRequestContext;
    return resultEnvelope(
      await this.commandBus.execute<PinSnapshotCommand, PinSnapshotDto>(
        new PinSnapshotCommand(
          assessmentId,
          context.userId,
          context.role,
          context.scope ?? undefined,
          body.connection_id,
          body.branch,
          body.ref,
          body.commit_sha,
          request.correlationId as string,
        ),
      ),
    );
  }

  /**
   * Triggers a repository scan either from a trusted worker key or a manually RBAC-authorized user request.
   *
   * @param assessmentId - Assessment whose pinned snapshot should be scanned.
   * @param body - Snapshot identifier, idempotency key, and optional requested trigger source.
   * @param request - Guard-enriched request containing trusted/manual source and optional RBAC context.
   * @param response - Express response used to distinguish newly created jobs (201) from idempotent duplicates (200).
   * @returns Standard result envelope containing scan-job trigger metadata.
   */
  @Post("assessments/:assessmentId/scan-jobs")
  @UseGuards(ScanTriggerGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async triggerScan(
    @Param("assessmentId") assessmentId: string,
    @Body() body: TriggerScanRequest,
    @Req() request: GitHubIntegrationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const context = request.rbacContext;
    const result = await this.commandBus.execute<
      TriggerScanCommand,
      TriggerScanDto
    >(
      new TriggerScanCommand(
        assessmentId,
        body.snapshot_id,
        request.scanTriggerSource as TriggerScanCommand["triggerSource"],
        body.idempotency_key,
        context?.userId ?? null,
        context?.role ?? null,
        context?.scope ?? undefined,
        request.correlationId ?? createCorrelationId(),
      ),
    );
    response.status(result.is_new ? 201 : 200);
    return resultEnvelope(result);
  }
}
