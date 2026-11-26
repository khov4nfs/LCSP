import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  type CredentialProvider,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";

import type {
  RepositoryProviderAdapter,
  RepositoryProviderRegistry,
} from "../application/ports/github-repository-provider.port.js";

/** Explicit provider registry; no provider fallback is performed. */
export class ConfiguredRepositoryProviderRegistry implements RepositoryProviderRegistry {
  constructor(
    private readonly providers: ReadonlyMap<
      CredentialProvider,
      RepositoryProviderAdapter
    >,
    private readonly disabledProviders: ReadonlySet<CredentialProvider> = new Set(),
  ) {}

  /**
   * Business purpose: Select an explicitly registered adapter for one repository provider.
   * Business rules: A disabled, absent, or locally unavailable provider is rejected and cannot inherit another provider's adapter.
   * Execution flow: Look up the exact provider key and return only its registered adapter.
   * Failure cases: Missing keys raise the stable providerClientUnavailable category.
   * Side effects: Pure registry lookup with no credential resolution or network operation.
   */
  get(provider: CredentialProvider): RepositoryProviderAdapter {
    if (
      this.disabledProviders.has(provider) ||
      this.providers.get(provider)?.isRuntimeAvailable === false
    ) {
      throw new RepositoryProviderUnavailableError();
    }
    const adapter = this.providers.get(provider);
    if (!adapter) throw new RepositoryProviderUnavailableError();
    return adapter;
  }

  /**
   * Business purpose: Report whether an explicitly registered provider is enabled by deployment configuration.
   * Business rules: Missing adapters and providers in the deployment denylist are disabled; local runtime health is reported separately.
   * Execution flow: Look up the exact provider key and exclude only deployment-disabled providers.
   * Failure cases: Missing or disabled provider keys return false.
   * Side effects: Pure configuration lookup with no credential access or network operation.
   */
  isEnabled(provider: CredentialProvider): boolean {
    return (
      this.providers.has(provider) && !this.disabledProviders.has(provider)
    );
  }

  /**
   * Business purpose: Report whether a registered provider is enabled and its local adapter runtime is available.
   * Business rules: Disabled or missing providers and adapters whose startup dependency failed validation are unavailable; no provider network probe may change this result.
   * Execution flow: 1. Look up the exact provider. 2. Check deployment disablement and the adapter's local runtime marker.
   * Failure cases: Missing adapters, disabled targets, and unavailable CLI runtimes return false.
   * Side effects: Pure configuration lookup with no network request or credential access.
   */
  isAvailable(provider: CredentialProvider): boolean {
    const adapter = this.providers.get(provider);
    return Boolean(
      this.isEnabled(provider) &&
      adapter &&
      adapter.isRuntimeAvailable !== false,
    );
  }
}

/** Safe local error used when deployment readiness excludes a provider. */
export class RepositoryProviderUnavailableError extends Error {
  readonly category: GitHubCredentialErrorCode =
    GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable;

  constructor() {
    super(GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable);
    this.name = "RepositoryProviderUnavailableError";
  }
}

export { CREDENTIAL_PROVIDERS };
