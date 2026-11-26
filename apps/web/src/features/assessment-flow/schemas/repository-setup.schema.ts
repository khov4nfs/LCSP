import { z } from "zod";
import { ASSESSMENT_REPOSITORY_LIMITS } from "@lcsp/contracts/assessment-domain";
import { repositorySourcePathPrefixSchema } from "@lcsp/contracts/github-integration";

import { GIT_PROVIDER_OPTIONS } from "../config/git-provider-options";
import { REPOSITORY_SETUP_ISSUES } from "../config/repository-setup-issues";
import {
  repositoryFullNameOf,
  repositoryIdentityOf,
} from "../utils/repository-entry";

/** One repository: the provider chosen and a URL that really belongs to that provider. */
export const repositoryEntrySchema = z
  .object({
    provider: z.string().trim().min(1),
    repositoryUrl: z.string().trim().min(1),
    sourcePathPrefix: repositorySourcePathPrefixSchema.nullable(),
  })
  .superRefine((value, context) => {
    const provider = GIT_PROVIDER_OPTIONS.find(
      (option) => option.id === value.provider,
    );
    if (!provider?.supported) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: REPOSITORY_SETUP_ISSUES.providerNotSupported,
      });
      return;
    }
    // The shared parser for the chosen provider must accept the URL; a URL of another provider is invalid here.
    if (
      !repositoryFullNameOf({
        provider: provider.id,
        repositoryUrl: value.repositoryUrl,
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["repositoryUrl"],
        message: REPOSITORY_SETUP_ISSUES.repositoryUrlInvalid,
      });
    }
  });

/**
 * The whole setup form: the draft fields stay free text, while the collected repositories must be valid,
 * duplicate-free entries within the product limit. Whether at least one repository exists also depends on the
 * repositories already saved on the server, so that rule lives in the form container.
 */
export const repositorySetupSchema = z
  .object({
    provider: z.string().trim().optional(),
    repositoryUrl: z.string(),
    repositories: z
      .array(repositoryEntrySchema)
      .max(ASSESSMENT_REPOSITORY_LIMITS.maxRepositories),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.repositories.forEach((entry, index) => {
      const identity = repositoryIdentityOf({
        provider: entry.provider,
        repositoryFullName: repositoryFullNameOf(entry),
        sourcePathPrefix: entry.sourcePathPrefix,
      });
      if (identity && seen.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["repositories", index, "repositoryUrl"],
          message: REPOSITORY_SETUP_ISSUES.duplicateRepository,
        });
      }
      if (identity) seen.add(identity);
    });
  });

export type RepositorySetupFormData = z.input<typeof repositorySetupSchema>;
