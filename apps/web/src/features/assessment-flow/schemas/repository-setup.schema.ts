import { z } from "zod";

import { GIT_PROVIDER_OPTIONS } from "../config/git-provider-options";

export const repositorySetupSchema = z
  .object({
    provider: z.string().trim().min(1),
    repositoryUrl: z.url(),
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

    const hostname = new URL(value.repositoryUrl).hostname.toLowerCase();
    if (hostname !== provider.hostname) {
      context.addIssue({
        code: "custom",
        path: ["repositoryUrl"],
        message: "repository-provider-mismatch",
      });
    }
    const repositoryPath = new URL(value.repositoryUrl).pathname
      .replace(/\.git$/u, "")
      .split("/")
      .filter(Boolean);
    if (repositoryPath.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["repositoryUrl"],
        message: "repository-path-invalid",
      });
    }
  });
