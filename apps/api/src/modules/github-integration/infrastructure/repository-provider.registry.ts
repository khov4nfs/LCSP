import {
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
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
  ) {}

  get(provider: CredentialProvider): RepositoryProviderAdapter {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new Error(`repository_provider_unavailable:${provider}`);
    }
    return adapter;
  }
}

export { CREDENTIAL_PROVIDERS };
