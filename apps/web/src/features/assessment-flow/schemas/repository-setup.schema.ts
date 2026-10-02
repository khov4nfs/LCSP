import { z } from "zod";
import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import {
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";

import { GIT_PROVIDER_OPTIONS } from "../config/git-provider-options";

export const repositorySetupSchema = z
  .object({
    provider: z.string().trim().min(1),
    repositoryUrl: z.string().trim().min(1),
    // A blank branch intentionally delegates to the provider default branch.
    // Keep this optional at the transport boundary so a saved setup created
    // before branch selection was exposed remains valid when restored.
    branch: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    const provider = GIT_PROVIDER_OPTIONS.find(
      (option) => option.id === value.provider,
    );
    if (!provider?.supported) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "provider-not-supported",
      });
      return;
    }
    const locator =
      provider.id === ASSESSMENT_REPOSITORY_PROVIDERS.github
        ? parseGitHubRepositoryUrl(value.repositoryUrl)
        : provider.id === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab
          ? parseGitLabRepositoryUrl(value.repositoryUrl)
          : null;
    if (!locator) {
      context.addIssue({
        code: "custom",
        path: ["repositoryUrl"],
        message: "repository-url-invalid",
      });
    }
  });

export type RepositorySetupFormData = z.infer<typeof repositorySetupSchema>;
