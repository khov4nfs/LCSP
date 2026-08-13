export { GITHUB_INTEGRATION_ERROR_CODES } from "@lcsp/contracts/github-integration";
import type { RepositoryConnectionStatus } from "@lcsp/contracts/github-integration";
import { GITHUB_INTEGRATION_ERROR_CODES } from "@lcsp/contracts/github-integration";

export type GithubIntegrationErrorCode =
  (typeof GITHUB_INTEGRATION_ERROR_CODES)[keyof typeof GITHUB_INTEGRATION_ERROR_CODES];

export interface GitHubAppCallbackDto {
  connection_id: string;
  repository_name: string;
  repository_full_name: string;
  default_branch: string;
  status: RepositoryConnectionStatus;
  correlationId: string;
}
