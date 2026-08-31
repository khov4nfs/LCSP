import type { GITHUB_INTEGRATION_ERROR_CODES } from "./codes.ts";
import type { GITHUB_CREDENTIAL_ERROR_CODES } from "./codes.ts";

export type GithubIntegrationErrorCode =
  (typeof GITHUB_INTEGRATION_ERROR_CODES)[keyof typeof GITHUB_INTEGRATION_ERROR_CODES];

export type GitHubCredentialErrorCode =
  (typeof GITHUB_CREDENTIAL_ERROR_CODES)[keyof typeof GITHUB_CREDENTIAL_ERROR_CODES];
