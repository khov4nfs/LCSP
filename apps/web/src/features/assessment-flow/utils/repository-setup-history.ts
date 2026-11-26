import { GIT_PROVIDER_OPTIONS } from "../config/git-provider-options";
import { buildCanonicalRepositoryUrl } from "@lcsp/contracts/github-integration";
import type { RepositorySetupAnswer } from "../types/repository-setup-conversation.types";

/**
 * Business purpose: Reconstruct a saved direct-URL answer using the provider's canonical repository URL.
 * Business rules:
 * - A saved provider and repository identity must be supported and unambiguous.
 * - Azure URLs retain organization/project/_git/repository structure.
 * Execution flow:
 * 1. Match the persisted provider.
 * 2. Prefer an API-validated canonical URL.
 * 3. Use the shared identity parser only when older setup data lacks that URL.
 * Failure cases:
 * - Missing or ambiguous identity returns null so the UI does not guess or submit a different repository.
 * Side effects:
 * - Pure projection with no repository or assessment mutation.
 */
export function deriveRepositorySetupAnswer(
  repository: {
    provider?: string | null;
    repositoryFullName: string | null;
    canonicalRepositoryUrl?: string | null;
  } | null,
): RepositorySetupAnswer | null {
  const provider = GIT_PROVIDER_OPTIONS.find(
    (option) => option.id === repository?.provider,
  );
  if (!provider || !repository?.repositoryFullName) return null;
  const repositoryUrl =
    repository.canonicalRepositoryUrl ??
    buildCanonicalRepositoryUrl(provider.id, repository.repositoryFullName);
  if (!repositoryUrl) return null;

  // Readiness and SSE persist the provider and full name, not the raw input URL.
  return {
    provider: provider.id,
    repositoryUrl,
  };
}
