import type { RepositoryProviderAdapter } from "../application/ports/github-repository-provider.port.js";

/**
 * Providers are always registered. Availability is the executable lookup: when
 * `build` throws (CLI missing or unsupported) the adapter rejects every call
 * with the provider's own "client unavailable" error instead of crashing boot.
 */
export function providerOrUnavailable(
  build: () => RepositoryProviderAdapter,
  unavailableError: () => Error,
): RepositoryProviderAdapter {
  try {
    return build();
  } catch {
    const unavailable = (): Promise<never> =>
      Promise.reject(unavailableError());
    return {
      validateIdentity: unavailable,
      listAccessibleRepositories: unavailable,
      validateRepositoryAccess: unavailable,
      resolveCommit: unavailable,
      downloadArchive: unavailable,
    };
  }
}
