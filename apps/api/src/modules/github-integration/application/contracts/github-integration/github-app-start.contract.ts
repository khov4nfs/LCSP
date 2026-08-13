export { GITHUB_INTEGRATION_ERROR_CODES } from "@lcsp/contracts/github-integration";
import { GITHUB_INTEGRATION_ERROR_CODES } from "@lcsp/contracts/github-integration";

export type GithubIntegrationErrorCode =
  (typeof GITHUB_INTEGRATION_ERROR_CODES)[keyof typeof GITHUB_INTEGRATION_ERROR_CODES];

export interface GitHubAppStartDto {
  installation_url: string;
  correlationId: string;
}
