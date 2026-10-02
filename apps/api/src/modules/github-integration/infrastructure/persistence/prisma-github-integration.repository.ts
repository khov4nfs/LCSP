import { Injectable } from "@nestjs/common";
import {
  CredentialProvider as PrismaCredentialProvider,
  RepositoryAuthenticationMode as PrismaRepositoryAuthenticationMode,
} from "@prisma/client";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_AUTHENTICATION_MODES,
  type RepositoryAuthenticationMode,
} from "@lcsp/contracts/github-integration";

import { fromPrismaRepositoryConnectionStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { RepositoryConnectionRepository } from "../../application/ports/persistence/repository-connection.repository.js";
import { RepositoryConnection } from "../../domain/entities/repository-connection.entity.js";

/**
 * Implements repository-connection persistence with Prisma and translates persistence enums/JSON into the domain aggregate.
 */
@Injectable()
export class PrismaRepositoryConnectionRepository implements RepositoryConnectionRepository {
  /**
   * Creates the repository with the application Prisma client.
   *
   * @param prisma - Prisma service used for repository-connection persistence and linking.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds one repository connection by identifier and rehydrates the domain aggregate.
   *
   * @param id - Repository connection identifier to look up.
   * @returns Rehydrated repository connection, or null when no row exists.
   */
  async findById(id: string): Promise<RepositoryConnection | null> {
    const row = await this.prisma.repositoryConnection.findUnique({
      where: { id },
    });
    if (!row) return null;

    return RepositoryConnection.rehydrate({
      id: row.id,
      assessmentId: row.assessmentId,
      userId: row.userId,
      provider: fromPrismaCredentialProvider(row.provider),
      installationId: row.installationId,
      authenticationMode: fromPrismaAuthenticationMode(row.authenticationMode),
      providerCredentialId: row.providerCredentialId,
      credentialVersion: row.credentialVersion,
      credentialAuthorizedByUserId: row.credentialAuthorizedByUserId,
      credentialAuthorizationStatus: row.credentialAuthorizationStatus
        ? row.credentialAuthorizationStatus
        : null,
      credentialValidatedAt: row.credentialValidatedAt,
      credentialRevokedAt: row.credentialRevokedAt,
      repositoryId: row.repositoryId,
      repositoryName: row.repositoryName,
      repositoryFullName: row.repositoryFullName,
      defaultBranch: row.defaultBranch,
      permissions: row.permissions as Record<string, string>,
      status: fromPrismaRepositoryConnectionStatus(row.status),
      connectedAt: row.connectedAt,
      revokedAt: row.revokedAt,
    });
  }

  /**
   * Links a repository connection to an assessment only while it is unlinked or already linked to that same assessment.
   *
   * @param id - Repository connection identifier to update.
   * @param assessmentId - Assessment identifier to bind to the connection.
   * @returns True when exactly one compatible connection row was updated.
   */
  async linkToAssessment(id: string, assessmentId: string): Promise<boolean> {
    const result = await this.prisma.repositoryConnection.updateMany({
      where: {
        id,
        OR: [{ assessmentId: null }, { assessmentId }],
      },
      data: { assessmentId },
    });

    return result.count === 1;
  }
}

function fromPrismaAuthenticationMode(
  mode: PrismaRepositoryAuthenticationMode,
): RepositoryAuthenticationMode {
  switch (mode) {
    case PrismaRepositoryAuthenticationMode.GITHUB_APP:
      return REPOSITORY_AUTHENTICATION_MODES.githubApp;
    case PrismaRepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL:
      return REPOSITORY_AUTHENTICATION_MODES.gitlabCliCredential;
    case PrismaRepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL:
      return REPOSITORY_AUTHENTICATION_MODES.bitbucketCliCredential;
    case PrismaRepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL:
      return REPOSITORY_AUTHENTICATION_MODES.azureDevOpsCliCredential;
    default:
      return REPOSITORY_AUTHENTICATION_MODES.githubCliCredential;
  }
}

function fromPrismaCredentialProvider(
  provider: PrismaCredentialProvider,
): (typeof CREDENTIAL_PROVIDERS)[keyof typeof CREDENTIAL_PROVIDERS] {
  switch (provider) {
    case PrismaCredentialProvider.GITLAB:
      return CREDENTIAL_PROVIDERS.gitlab;
    case PrismaCredentialProvider.BITBUCKET:
      return CREDENTIAL_PROVIDERS.bitbucket;
    case PrismaCredentialProvider.AZURE_DEVOPS:
      return CREDENTIAL_PROVIDERS.azureDevOps;
    default:
      return CREDENTIAL_PROVIDERS.github;
  }
}
