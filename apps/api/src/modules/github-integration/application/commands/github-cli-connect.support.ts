import { HttpStatus } from "@nestjs/common";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  type GitHubCredentialErrorCode,
  type RepositoryUrlLocator,
} from "@lcsp/contracts/github-integration";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { GitHubCliProviderError } from "../../infrastructure/github/github-cli-repository.provider.js";
import { GitLabCliProviderError } from "../../infrastructure/gitlab/gitlab-cli-repository.provider.js";
import { BitbucketCliProviderError } from "../../infrastructure/bitbucket/bitbucket-cli-repository.provider.js";
import { BitbucketRestProviderError } from "../../infrastructure/bitbucket/bitbucket-rest-repository.provider.js";
import { AzureDevOpsRestProviderError } from "../../infrastructure/azure-devops/azure-devops-rest-repository.provider.js";
import { CredentialResolutionError } from "../../infrastructure/persistence/prisma-credential-authorization.resolver.js";
import { RepositoryProviderUnavailableError } from "../../infrastructure/repository-provider.registry.js";

export const GITHUB_CREDENTIAL_MIN_LENGTH = 20;
export const GITHUB_CREDENTIAL_MAX_LENGTH = 2048;
export const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
export const GITLAB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u;
export const BITBUCKET_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
export const AZURE_DEVOPS_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9][^/]*\/[A-Za-z0-9][^/]*$/u;

export type GitHubRepositoryLocator = RepositoryUrlLocator;
export type GitLabRepositoryLocator = GitHubRepositoryLocator;
export type BitbucketRepositoryLocator = GitHubRepositoryLocator;
export type AzureDevOpsRepositoryLocator = GitHubRepositoryLocator;

// Backend onboarding delegates URL rules to the shared contract parsers.
export {
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";

export function assertCredential(
  value: unknown,
  correlationId: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < GITHUB_CREDENTIAL_MIN_LENGTH ||
    value.length > GITHUB_CREDENTIAL_MAX_LENGTH ||
    /[\r\n\0]/u.test(value)
  ) {
    throw problemException(
      GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
}

/**
 * Business purpose: Convert only stable provider categories into the API's shared problem envelope.
 * Business rules:
 * - Raw adapter messages, HTTP payloads, tokens, and unrelated error strings are never returned to the caller.
 * Execution flow:
 * 1. Classify a known typed failure, map its established HTTP status, and raise the shared problem exception.
 * Failure cases:
 * - Unrecognized errors become providerResponseInvalid rather than being misclassified as credential revocation.
 * Side effects:
 * - Raises an API exception and performs no persistence or provider operation.
 */
export function mapProviderFailure(
  error: unknown,
  correlationId: string,
): never {
  const category = providerFailureCategory(error);
  throw problemException(category, correlationId, {
    status: providerFailureStatus(category),
  });
}

/**
 * Classifies safe typed errors shared by repository provider operations.
 *
 * Business purpose: Preserve actionable provider failure categories across all adapter-backed handlers.
 * Business rules:
 * - Only trusted typed errors may select an authentication or authorization category.
 * - Arbitrary HTTP or CLI errors never imply credential revocation.
 * Execution flow:
 * 1. Match provider adapters and local credential/provider availability errors.
 * 2. Return the generic invalid-response category when no trusted type matches.
 * Failure cases:
 * - Unrecognized values fail closed as providerResponseInvalid without exposing their message.
 * Side effects:
 * - Pure classification; it does not mutate credential state or log provider payloads.
 */
export function providerFailureCategory(
  error: unknown,
): GitHubCredentialErrorCode {
  if (
    error instanceof GitHubCliProviderError ||
    error instanceof GitLabCliProviderError ||
    error instanceof BitbucketCliProviderError ||
    error instanceof BitbucketRestProviderError ||
    error instanceof AzureDevOpsRestProviderError
  ) {
    return error.category;
  }
  if (error instanceof CredentialResolutionError) return error.code;
  if (error instanceof RepositoryProviderUnavailableError)
    return error.category;
  return GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid;
}

/**
 * Maps one established provider failure category to its HTTP status.
 *
 * Business purpose: Keep provider failures aligned with the existing API problem contract.
 * Business rules:
 * - Statuses are derived only from the bounded contract category set.
 * Execution flow:
 * 1. Look up the category's established HTTP status.
 * Failure cases:
 * - No provider response content is used to choose a status.
 * Side effects:
 * - Pure mapping with no persistence or external action.
 */
export function providerFailureStatus(
  category: GitHubCredentialErrorCode,
): number {
  const statuses: Record<GitHubCredentialErrorCode, number> = {
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired]: HttpStatus.BAD_REQUEST,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid]: HttpStatus.UNAUTHORIZED,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired]: HttpStatus.UNAUTHORIZED,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialApprovalRequired]:
      HttpStatus.FORBIDDEN,
    [GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied]:
      HttpStatus.NOT_FOUND,
    [GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable]: HttpStatus.NOT_FOUND,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited]:
      HttpStatus.TOO_MANY_REQUESTS,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout]: HttpStatus.GATEWAY_TIMEOUT,
    [GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled]: 499,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable]:
      HttpStatus.SERVICE_UNAVAILABLE,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid]:
      HttpStatus.BAD_GATEWAY,
  };
  return statuses[category];
}
