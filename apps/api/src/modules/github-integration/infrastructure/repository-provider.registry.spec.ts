import { describe, expect, it } from "@jest/globals";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
} from "@lcsp/contracts/github-integration";

import { ConfiguredRepositoryProviderRegistry } from "./repository-provider.registry.js";

describe("ConfiguredRepositoryProviderRegistry", () => {
  const github = {
    validateIdentity: () =>
      Promise.resolve({ id: "1", login: "owner", htmlUrl: "" }),
    listAccessibleRepositories: () => Promise.resolve([]),
    validateRepositoryAccess: () =>
      Promise.resolve({
        id: "repo",
        name: "repo",
        fullName: "owner/repo",
        defaultBranch: "main",
        private: true,
      }),
    resolveCommit: () =>
      Promise.resolve({
        sha: "a".repeat(40),
        repositoryFullName: "owner/repo",
        htmlUrl: "",
        authorDate: null,
        committerDate: null,
      }),
    downloadArchive: () => Promise.reject(new Error("not used")),
  };

  it("returns an explicitly registered provider", () => {
    const registry = new ConfiguredRepositoryProviderRegistry(
      new Map([[CREDENTIAL_PROVIDERS.github, github]]),
    );

    expect(registry.get(CREDENTIAL_PROVIDERS.github)).toBe(github);
    expect(registry.isEnabled(CREDENTIAL_PROVIDERS.github)).toBe(true);
    expect(registry.isAvailable(CREDENTIAL_PROVIDERS.github)).toBe(true);
  });

  it.each([CREDENTIAL_PROVIDERS.bitbucket, CREDENTIAL_PROVIDERS.azureDevOps])(
    "fails closed for a provider not enabled for customer operations %s",
    (provider) => {
      const registry = new ConfiguredRepositoryProviderRegistry(
        new Map([[CREDENTIAL_PROVIDERS.github, github]]),
      );

      expect(() => registry.get(provider)).toThrow(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
      expect(registry.isEnabled(provider)).toBe(false);
      expect(registry.isAvailable(provider)).toBe(false);
    },
  );

  it.each([CREDENTIAL_PROVIDERS.bitbucket, CREDENTIAL_PROVIDERS.azureDevOps])(
    "keeps registered target adapters inaccessible until activation (%s)",
    (provider) => {
      const registry = new ConfiguredRepositoryProviderRegistry(
        new Map([
          [CREDENTIAL_PROVIDERS.github, github],
          [provider, github],
        ]),
        new Set([provider]),
      );

      expect(() => registry.get(provider)).toThrow(
        GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
      );
      expect(registry.isEnabled(provider)).toBe(false);
    },
  );

  it("reports a registered adapter as unavailable when its local runtime is unavailable", () => {
    const registry = new ConfiguredRepositoryProviderRegistry(
      new Map([
        [CREDENTIAL_PROVIDERS.gitlab, { ...github, isRuntimeAvailable: false }],
      ]),
    );
    expect(registry.isEnabled(CREDENTIAL_PROVIDERS.gitlab)).toBe(true);
    expect(registry.isAvailable(CREDENTIAL_PROVIDERS.gitlab)).toBe(false);
    expect(() => registry.get(CREDENTIAL_PROVIDERS.gitlab)).toThrow(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  });
});
