import { GIT_PROVIDER_OPTIONS } from "../config/git-provider-options";
import type { RepositorySetupAnswer } from "../types/repository-setup-conversation.types";

export function deriveRepositorySetupAnswer(
  repository: {
    provider?: string | null;
    repositoryFullName: string | null;
  } | null,
): RepositorySetupAnswer | null {
  const provider = GIT_PROVIDER_OPTIONS.find(
    (option) => option.id === repository?.provider && option.supported,
  );
  if (!provider || !repository?.repositoryFullName) return null;

  // Readiness and SSE persist the provider and full name, not the raw input URL.
  return {
    provider: provider.id,
    repositoryUrl: `https://${provider.hostname}/${repository.repositoryFullName}`,
  };
}
