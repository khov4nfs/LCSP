import {
  Body,
  Controller,
  Delete,
  Inject,
  Optional,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BITBUCKET_CREDENTIAL_TYPES,
  AZURE_DEVOPS_CREDENTIAL_TYPES,
  CREDENTIAL_PROVIDERS,
  PROVIDER_CREDENTIAL_STATUSES,
  encodeBitbucketApiTokenCredential,
  encodeAzureDevOpsOrganizationPatCredential,
  GITHUB_INTEGRATION_ERROR_CODES,
} from "@lcsp/contracts/github-integration";

import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import {
  problemException,
  resultEnvelope,
} from "../../../../platform/http/filters/error.factory.js";
import { ReAuthForSensitiveRoute } from "../../../../platform/security/decorators/re-auth-for-sensitive-route.decorator.js";
import { SENSITIVE_ROUTE_IDS } from "../../../../platform/security/sensitive-route-policy.js";
import { PinSnapshotCommand } from "../../application/commands/pin-snapshot/pin-snapshot.command.js";
import type { PinSnapshotDto } from "../../application/contracts/github-integration/pin-snapshot.contract.js";
import { PinSnapshotRequest } from "./dto/pin-snapshot.request.js";
import {
  GitHubCliRepositoryConnectionRequest,
  GitHubRepositoryDiscoveryRequest,
} from "./dto/github-credential.request.js";
import { GitHubCredentialRequestGuard } from "./github-credential-request.guard.js";
import { DiscoverGitHubRepositoriesCommand } from "../../application/commands/discover-github-repositories/discover-github-repositories.command.js";
import { ConnectGitHubCliRepositoryCommand } from "../../application/commands/connect-github-cli-repository/connect-github-cli-repository.command.js";
import { ConfigureProviderCredentialCommand } from "../../application/commands/configure-provider-credential/configure-provider-credential.command.js";
import { DisconnectProviderCredentialCommand } from "../../application/commands/disconnect-provider-credential/disconnect-provider-credential.command.js";
import { ProviderCredentialRequest } from "./dto/provider-credential.request.js";
import { AssessmentRepositoryConnectionRequest } from "./dto/assessment-repository-connection.request.js";
import { ConnectAssessmentRepositoryCommand } from "../../application/commands/connect-assessment-repository/connect-assessment-repository.command.js";
import { ListRepositoryConnectionsQuery } from "../../application/queries/list-repository-connections/list-repository-connections.query.js";
import {
  ACTIVE_PROVIDER_CREDENTIAL_RESOLVER,
  type ActiveProviderCredentialResolver,
} from "../../application/ports/security/active-provider-credential.resolver.js";
import {
  REPOSITORY_PROVIDER_REGISTRY,
  type RepositoryProviderRegistry,
} from "../../application/ports/github-repository-provider.port.js";

interface GitHubIntegrationRequest {
  rbacContext?: RbacRequestContext;
  correlationId?: string;
}

/**
 * Exposes GitHub repository connection, credential and snapshot pinning HTTP operations (V1 scan triggering is retired).
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
    private readonly queryBus: QueryBus,
    @Optional()
    @Inject(ACTIVE_PROVIDER_CREDENTIAL_RESOLVER)
    private readonly activeCredentials?: ActiveProviderCredentialResolver,
    @Optional()
    @Inject(REPOSITORY_PROVIDER_REGISTRY)
    private readonly providerRegistry?: RepositoryProviderRegistry,
  ) {}

  @Get("github/repositories")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async listRepositories(@Req() request: GitHubIntegrationRequest) {
    const context = request.rbacContext as RbacRequestContext;
    return resultEnvelope(
      await this.queryBus.execute(new ListRepositoryConnectionsQuery(context)),
    );
  }

  @Get("provider-credentials")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  /**
   * Business purpose: Return the authenticated customer's credential lifecycle and deployment readiness for each known provider.
   * Business rules: Credential metadata is owner-scoped and secret-free; enabled means the exact provider adapter is registered, runtime-available, and permitted by deployment configuration.
   * Execution flow: 1. Resolve each provider's current lifecycle metadata. 2. Project safe account/status fields and exact registry readiness. 3. Return the standard success envelope.
   * Failure cases: Missing credential resolver fails closed; a missing registry reports target providers unavailable without exposing credential material.
   * Side effects: Performs read-only credential metadata lookups; no provider call, secret read, or persistence occurs.
   */
  async listProviderCredentials(@Req() request: GitHubIntegrationRequest) {
    const context = request.rbacContext as RbacRequestContext;
    if (!this.activeCredentials)
      throw new Error("provider_credentials_unavailable");
    const activeCredentials = this.activeCredentials;
    const providers = [
      CREDENTIAL_PROVIDERS.github,
      CREDENTIAL_PROVIDERS.gitlab,
      CREDENTIAL_PROVIDERS.bitbucket,
      CREDENTIAL_PROVIDERS.azureDevOps,
    ];
    return resultEnvelope(
      await Promise.all(
        providers.map(async (provider) => {
          const metadata = await activeCredentials.findLifecycle({
            userId: context.userId,
            provider,
          });
          return {
            provider,
            configured:
              metadata?.status === PROVIDER_CREDENTIAL_STATUSES.active,
            status: metadata?.status ?? null,
            implemented: true,
            enabled:
              this.providerRegistry?.isEnabled?.(provider) ??
              (provider === CREDENTIAL_PROVIDERS.github ||
                provider === CREDENTIAL_PROVIDERS.gitlab),
            available:
              this.providerRegistry?.isAvailable?.(provider) ??
              (provider === CREDENTIAL_PROVIDERS.github ||
                provider === CREDENTIAL_PROVIDERS.gitlab),
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
  /**
   * Business purpose: Configure an owner-scoped provider credential using the shared encrypted credential lifecycle.
   * Business rules: Legacy string submissions remain valid for existing providers; target providers accept only their typed credential shapes and declared expiry is passed for provider validation and persistence.
   * Execution flow: 1. Normalize the typed provider credential into the existing encrypted string-secret boundary. 2. Dispatch the configure command for the authenticated user. 3. Return the standard success envelope.
   * Failure cases: Invalid typed fields raise the shared credential request problem; provider validation or readiness failures are mapped by the command handler.
   * Side effects: The command may validate and persist an encrypted credential transactionally; raw secret data is never included in the response.
   */
  async configureProviderCredential(
    @Body() body: ProviderCredentialRequest,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.rbacContext as RbacRequestContext;
    let credential = body.credential;
    if (typeof credential !== "string") {
      if (
        body.provider === CREDENTIAL_PROVIDERS.bitbucket &&
        credential.type === BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken
      ) {
        try {
          credential = encodeBitbucketApiTokenCredential({
            email: credential.email,
            apiToken: credential.apiToken,
          });
        } catch {
          throw problemException(
            GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
            request.correlationId as string,
            { status: HttpStatus.BAD_REQUEST },
          );
        }
      } else if (
        body.provider === CREDENTIAL_PROVIDERS.azureDevOps &&
        credential.type === AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat
      ) {
        try {
          credential = encodeAzureDevOpsOrganizationPatCredential({
            organization: credential.organization,
            pat: credential.pat,
          });
        } catch {
          throw problemException(
            GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
            request.correlationId as string,
            { status: HttpStatus.BAD_REQUEST },
          );
        }
      } else {
        throw problemException(
          GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
          request.correlationId as string,
          { status: HttpStatus.BAD_REQUEST },
        );
      }
    }
    return resultEnvelope(
      await this.commandBus.execute(
        new ConfigureProviderCredentialCommand(
          context.userId,
          context.role,
          context.sessionId,
          body.provider,
          credential,
          request.correlationId as string,
          body.credential_expires_at,
        ),
      ),
    );
  }

  /**
   * Guarded disconnect of the caller's own provider credential; requires recent reauthentication.
   */
  @Delete("provider-credentials/:provider")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.providerCredentialDisconnect,
    method: "DELETE",
    pathTemplate: "/provider-credentials/:provider",
    aliases: [
      { method: "DELETE", pathTemplate: "/api/provider-credentials/:provider" },
    ],
  })
  async disconnectProviderCredential(
    @Param("provider") provider: string,
    @Req() request: GitHubIntegrationRequest,
  ) {
    const context = request.rbacContext as RbacRequestContext;
    return resultEnvelope(
      await this.commandBus.execute(
        new DisconnectProviderCredentialCommand(
          context.userId,
          context.role,
          context.sessionId,
          provider,
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
   * Business purpose: Let the authenticated customer pin an exact revision and approved repository source directory.
   *
   * Business rules:
   * - The customer role guard and pin handler enforce ownership and canonical source scope.
   * - Forward the requested prefix exactly; omission retains whole-repository compatibility.
   *
   * Execution flow:
   * 1. Read the authenticated actor and repository selectors.
   * 2. Dispatch the pin command including the unmodified source prefix.
   * 3. Return the persisted snapshot in the standard success envelope.
   *
   * Failure cases:
   * - Authorization, invalid scope or provider resolution failures propagate as standard API problems.
   *
   * Side effects:
   * - Delegates snapshot, outbox and audit persistence to the command handler.
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
          body.source_path_prefix,
        ),
      ),
    );
  }
}
