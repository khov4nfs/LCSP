import { apiRequest } from "./api-request.ts";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  REPOSITORY_AUTHENTICATION_MODES,
  type CredentialProvider,
  type RepositoryAuthenticationMode,
} from "@lcsp/contracts/github-integration";
import type { MessageKey } from "@lcsp/i18n";

export type RepositoryConnectionSummary = {
  id: string;
  provider: CredentialProvider;
  authentication_mode: RepositoryAuthenticationMode;
  installation_id: string | null;
  repository_name: string;
  repository_full_name: string;
  default_branch: string;
  status: string;
  connected_at: string;
  revoked_at: string | null;
  assessment_id: string | null;
  assessment_name: string | null;
};

export type GitHubRepositorySummary = {
  repository_id: string;
  name: string;
  full_name: string;
  default_branch: string;
  private: boolean;
};

export type GitHubRepositoryDiscovery = {
  authenticated_account: { id: string; login: string };
  repositories: GitHubRepositorySummary[];
  next_cursor: string | null;
};

export type GitHubRepositoryConnection = {
  connection_id: string;
  repository: GitHubRepositorySummary;
  connection_status: string;
  credential_status: string;
  connected_at: string;
};

export type ProviderCredentialStatus = {
  provider: CredentialProvider;
  configured: boolean;
  account: { id: string; username: string } | null;
};

export class GitHubRepositoryRequestError extends Error {
  readonly problemCode: string | undefined;
  readonly requiredAction: string | undefined;

  constructor(problemCode: string | undefined, requiredAction?: string) {
    super("github-repository-request-failed");
    this.problemCode = problemCode;
    this.requiredAction = requiredAction;
  }
}

export function githubRepositoryProblemMessageKey(error: unknown): MessageKey {
  const code =
    error instanceof GitHubRepositoryRequestError
      ? error.problemCode
      : undefined;
  switch (code) {
    case GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid:
    case GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired:
      return "pages.workspace.settingsHub.repositories.credentialInvalidDescription";
    case GITHUB_CREDENTIAL_ERROR_CODES.credentialApprovalRequired:
      return "pages.workspace.settingsHub.repositories.approvalRequiredDescription";
    case GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied:
    case GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable:
      return "pages.workspace.settingsHub.repositories.repositoryDeniedDescription";
    case GITHUB_INTEGRATION_ERROR_CODES.cliConnectDisabled:
    case GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable:
      return "pages.workspace.settingsHub.repositories.serviceUnavailableDescription";
    default:
      return "pages.workspace.settingsHub.repositories.requestFailedDescription";
  }
}

export async function discoverGitHubRepositories(input: {
  credential: string;
  limit: number;
}): Promise<GitHubRepositoryDiscovery> {
  const response = await apiRequest("/api/github/repository-discoveries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok || !isDiscovery(response.payload)) {
    throw new GitHubRepositoryRequestError(
      response.problemCode,
      response.requiredAction,
    );
  }
  return response.payload;
}

export async function connectGitHubRepository(input: {
  credential: string;
  provider: CredentialProvider;
  repository_url: string;
  assessment_id?: string;
}): Promise<GitHubRepositoryConnection> {
  const response = await apiRequest("/api/github/repository-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok || !isConnection(response.payload)) {
    throw new GitHubRepositoryRequestError(
      response.problemCode,
      response.requiredAction,
    );
  }
  return response.payload;
}

export async function configureProviderCredential(input: {
  provider: CredentialProvider;
  credential: string;
}): Promise<ProviderCredentialStatus> {
  const response = await apiRequest("/api/provider-credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok || !isCredentialStatus(response.payload)) {
    throw new GitHubRepositoryRequestError(
      response.problemCode,
      response.requiredAction,
    );
  }
  return response.payload;
}

export async function getProviderCredentialStatuses(): Promise<
  ProviderCredentialStatus[]
> {
  const response = await apiRequest("/api/provider-credentials");
  if (!response.ok || !Array.isArray(response.payload)) {
    throw new GitHubRepositoryRequestError(response.problemCode);
  }
  return response.payload as ProviderCredentialStatus[];
}

export async function getRepositoryConnections(): Promise<
  RepositoryConnectionSummary[]
> {
  const response = await apiRequest("/api/github/repositories");
  if (!response.ok || !isRepositoryConnectionsPayload(response.payload)) {
    throw new GitHubRepositoryRequestError(response.problemCode);
  }

  return response.payload.repositories;
}

function isRepository(value: unknown): value is GitHubRepositorySummary {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.repository_id === "string" &&
    typeof item.name === "string" &&
    typeof item.full_name === "string" &&
    typeof item.default_branch === "string" &&
    typeof item.private === "boolean"
  );
}

function isDiscovery(value: unknown): value is GitHubRepositoryDiscovery {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  const account = result.authenticated_account as Record<string, unknown>;
  return (
    typeof account?.id === "string" &&
    typeof account.login === "string" &&
    Array.isArray(result.repositories) &&
    result.repositories.every(isRepository) &&
    (typeof result.next_cursor === "string" || result.next_cursor === null)
  );
}

function isConnection(value: unknown): value is GitHubRepositoryConnection {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.connection_id === "string" &&
    isRepository(result.repository) &&
    typeof result.connection_status === "string" &&
    typeof result.credential_status === "string" &&
    typeof result.connected_at === "string"
  );
}

function isCredentialStatus(value: unknown): value is ProviderCredentialStatus {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const account = item.account as Record<string, unknown>;
  return (
    (item.provider === CREDENTIAL_PROVIDERS.github ||
      item.provider === CREDENTIAL_PROVIDERS.gitlab ||
      item.provider === CREDENTIAL_PROVIDERS.bitbucket ||
      item.provider === CREDENTIAL_PROVIDERS.azureDevOps) &&
    (item.configured === false ||
      (item.configured === true &&
        typeof account?.id === "string" &&
        typeof account.username === "string"))
  );
}

function isRepositoryConnectionsPayload(
  payload: unknown,
): payload is { repositories: RepositoryConnectionSummary[] } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const repositories = (payload as { repositories?: unknown }).repositories;
  return (
    Array.isArray(repositories) &&
    repositories.every((repository) => {
      if (typeof repository !== "object" || repository === null) {
        return false;
      }

      const candidate = repository as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        Object.values(CREDENTIAL_PROVIDERS).includes(
          candidate.provider as CredentialProvider,
        ) &&
        Object.values(REPOSITORY_AUTHENTICATION_MODES).includes(
          candidate.authentication_mode as RepositoryAuthenticationMode,
        ) &&
        (typeof candidate.installation_id === "string" ||
          candidate.installation_id === null) &&
        typeof candidate.repository_name === "string" &&
        typeof candidate.repository_full_name === "string" &&
        typeof candidate.default_branch === "string" &&
        typeof candidate.status === "string" &&
        typeof candidate.connected_at === "string" &&
        (typeof candidate.revoked_at === "string" ||
          candidate.revoked_at === null) &&
        (typeof candidate.assessment_id === "string" ||
          candidate.assessment_id === null) &&
        (typeof candidate.assessment_name === "string" ||
          candidate.assessment_name === null)
      );
    })
  );
}

