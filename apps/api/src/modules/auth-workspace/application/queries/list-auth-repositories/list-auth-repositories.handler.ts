import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuthRepositoriesSuccess } from "../../contracts/auth-workspace/settings.contract.ts";
import { ListAuthRepositoriesQuery } from "./list-auth-repositories.query.ts";
import {
  CredentialProvider as PrismaCredentialProvider,
  RepositoryAuthenticationMode,
} from "@prisma/client";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_AUTHENTICATION_MODES,
} from "@lcsp/contracts/github-integration";

export class ListAuthRepositoriesHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: ListAuthRepositoriesQuery,
  ): Promise<AuthRepositoriesSuccess> {
    const connections = await this.prisma.repositoryConnection.findMany({
      where: {
        userId: query.context.userId,
      },
      orderBy: [{ connectedAt: "desc" }, { repositoryFullName: "asc" }],
    });
    const assessmentIds = connections
      .map((connection) => connection.assessmentId)
      .filter((value): value is string => typeof value === "string");
    const assessments =
      assessmentIds.length === 0
        ? []
        : await this.prisma.assessment.findMany({
            where: { id: { in: assessmentIds } },
            select: { id: true, name: true },
          });
    const assessmentNameById = new Map(
      assessments.map((assessment) => [assessment.id, assessment.name]),
    );

    return {
      ok: true,
      repositories: connections.map((connection) => ({
        id: connection.id,
        provider:
          connection.provider === PrismaCredentialProvider.GITLAB
            ? CREDENTIAL_PROVIDERS.gitlab
            : CREDENTIAL_PROVIDERS.github,
        authentication_mode:
          connection.authenticationMode ===
          RepositoryAuthenticationMode.GITHUB_APP
            ? REPOSITORY_AUTHENTICATION_MODES.githubApp
            : connection.authenticationMode ===
                RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL
              ? REPOSITORY_AUTHENTICATION_MODES.gitlabCliCredential
              : REPOSITORY_AUTHENTICATION_MODES.githubCliCredential,
        installation_id: connection.installationId,
        repository_name: connection.repositoryName,
        repository_full_name: connection.repositoryFullName,
        default_branch: connection.defaultBranch,
        status: connection.status,
        connected_at: connection.connectedAt.toISOString(),
        revoked_at: connection.revokedAt?.toISOString() ?? null,
        assessment_id: connection.assessmentId,
        assessment_name: connection.assessmentId
          ? (assessmentNameById.get(connection.assessmentId) ?? null)
          : null,
      })),
    };
  }
}
