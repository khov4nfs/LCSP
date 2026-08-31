import { z } from "zod";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

export const githubRepositoryCredentialSchema = z.object({
  provider: z.union([
    z.literal(CREDENTIAL_PROVIDERS.github),
    z.literal(CREDENTIAL_PROVIDERS.gitlab),
  ]),
  credential: z.string().trim().min(1).max(512),
});

export type GitHubRepositoryCredentialValues = z.infer<
  typeof githubRepositoryCredentialSchema
>;
