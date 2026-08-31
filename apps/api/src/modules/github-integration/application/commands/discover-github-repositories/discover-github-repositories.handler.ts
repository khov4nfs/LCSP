import { HttpStatus, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
} from "@lcsp/contracts/github-integration";

import type { AppConfig } from "../../../../../config/config.types.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { GitHubRepositoryDiscoveryDto } from "../../contracts/github-integration/github-cli-connect.contract.js";
import {
  GITHUB_REPOSITORY_PROVIDER,
  type GitHubIdentity,
  type GitHubRepositoryProviderPort,
  type GitHubRepositorySummary,
} from "../../ports/github-repository-provider.port.js";
import { CredentialLease } from "../../security/credential-lease.js";
import {
  assertCredential,
  mapProviderFailure,
} from "../github-cli-connect.support.js";
import { DiscoverGitHubRepositoriesCommand } from "./discover-github-repositories.command.js";

@CommandHandler(DiscoverGitHubRepositoriesCommand)
export class DiscoverGitHubRepositoriesHandler implements ICommandHandler<DiscoverGitHubRepositoriesCommand> {
  constructor(
    @Inject(GITHUB_REPOSITORY_PROVIDER)
    private readonly provider: GitHubRepositoryProviderPort,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: DiscoverGitHubRepositoriesCommand,
  ): Promise<GitHubRepositoryDiscoveryDto> {
    this.assertEnabledAndManager(command.subjectRole, command.correlationId);
    assertCredential(command.credential, command.correlationId);
    const limit = command.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const startPage = decodeCursor(command.cursor, command.correlationId);
    const lease = new CredentialLease(command.credential, {
      internalCredentialId: crypto.randomUUID(),
      credentialVersion: 1,
      repositoryFullName: "github.com/*",
      expiresAt: new Date(Date.now() + 2 * 60_000),
    });
    let identity: GitHubIdentity;
    let repositories: GitHubRepositorySummary[];
    try {
      identity = await this.provider.validateIdentity(lease);
      repositories = await this.provider.listAccessibleRepositories(lease, {
        perPage: limit,
        maxPages: 1,
        maxRepositories: limit,
        startPage,
      });
    } catch (error: unknown) {
      mapProviderFailure(error, command.correlationId);
    } finally {
      lease.dispose();
    }

    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.cliRepositoryDiscoverySucceeded,
      actorId: command.userId,
      resourceType: AUDIT_RESOURCE_TYPES.httpRoute,
      resourceId: "github/repository-discoveries",
      correlationId: command.correlationId,
      sessionId: command.sessionId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        providerAccountId: identity.id,
        providerLogin: identity.login,
        repositoryCount: repositories.length,
      },
    });
    return {
      authenticated_account: { id: identity.id, login: identity.login },
      repositories: repositories.map((repository) => ({
        repository_id: repository.id,
        name: repository.name,
        full_name: repository.fullName,
        default_branch: repository.defaultBranch,
        private: repository.private,
      })),
      next_cursor:
        repositories.length === limit ? encodeCursor(startPage + 1) : null,
    };
  }

  private assertEnabledAndManager(role: string, correlationId: string): void {
    if (
      !this.config.get("githubCredentialPersistence", { infer: true }).enabled
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.cliConnectDisabled,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (role !== AUTH_USER_ROLES.customer) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
        correlationId,
        { status: HttpStatus.FORBIDDEN },
      );
    }
  }
}

function encodeCursor(page: number): string {
  return Buffer.from(`github-repositories:v1:${page}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(
  value: string | undefined,
  correlationId: string,
): number {
  if (value === undefined) return 1;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const match = /^github-repositories:v1:(\d{1,4})$/u.exec(decoded);
    const page = Number(match?.[1]);
    if (
      !match ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000 ||
      encodeCursor(page) !== value
    ) {
      throw new Error();
    }
    return page;
  } catch {
    throw problemException(
      GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
}
