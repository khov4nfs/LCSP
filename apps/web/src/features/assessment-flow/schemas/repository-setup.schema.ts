import { z } from "zod";
import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import {
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";

import { GIT_PROVIDER_OPTIONS } from "../config/git-provider-options";

export const repositorySetupSchema = z
  .object({
    provider: z.string().trim().min(1),
    repositoryUrl: z.string().trim().min(1),
  })
  .superRefine((value, context) => {
    const provider = GIT_PROVIDER_OPTIONS.find(
      (option) => option.id === value.provider,
    );
    if (!provider?.supported) {
      context.addIssue({
        code: "custom", path: ["provider"], message: "provider-not-supported",
      });
      return;
    }
    const parsedProvider = parseProviderRepositoryUrl(value.repositoryUrl);
    if (!parsedProvider || parsedProvider.provider !== provider.id) {
      context.addIssue({
        code: "custom", path: ["repositoryUrl"], message: "repository-url-invalid",
      });
    }
  });

/**
 * Business purpose: Determine which supported provider owns a candidate direct repository URL.
 * Business rules:
 * - The selected provider must exactly match one shared parser's recognized host and path contract.
 * - URL syntax is a locator and cannot establish repository access.
 * Execution flow:
 * 1. Test each provider parser.
 * 2. Return its provider discriminator and normalized locator, or null.
 * Failure cases:
 * - Malformed or unsupported URLs remain invalid and cannot be connected under another provider.
 * Side effects:
 * - Pure URL parsing; no network request or persistence.
 */
function parseProviderRepositoryUrl(value: string) {
  const github = parseGitHubRepositoryUrl(value);
  if (github) return { provider: ASSESSMENT_REPOSITORY_PROVIDERS.github, locator: github };
  const gitlab = parseGitLabRepositoryUrl(value);
  if (gitlab) return { provider: ASSESSMENT_REPOSITORY_PROVIDERS.gitlab, locator: gitlab };
  const bitbucket = parseBitbucketRepositoryUrl(value);
  if (bitbucket) return { provider: ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket, locator: bitbucket };
  const azure = parseAzureDevOpsRepositoryUrl(value);
  return azure ? { provider: ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps, locator: azure } : null;
}

export type RepositorySetupFormData = z.infer<typeof repositorySetupSchema>;
