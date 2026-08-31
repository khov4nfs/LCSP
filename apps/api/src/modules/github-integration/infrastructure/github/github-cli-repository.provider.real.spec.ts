import { beforeAll, describe, expect, it } from "@jest/globals";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { GitHubCliRepositoryProvider } from "./github-cli-repository.provider.js";

const credential = process.env.GH_TOKEN;
const executablePath = process.env.GITHUB_CLI_EXECUTABLE_PATH;
const repositoryFullName = process.env.LCSP_REAL_GITHUB_ARCHIVE_REPOSITORY;
const enabled = Boolean(credential && executablePath && repositoryFullName);
const describeReal = enabled ? describe : describe.skip;

describeReal("GitHub CLI repository provider (opt-in real GitHub)", () => {
  let provider: GitHubCliRepositoryProvider;

  beforeAll(() => {
    provider = new GitHubCliRepositoryProvider({
      executablePath: executablePath!,
      metadataTimeoutMs: 30_000,
      discoveryTimeoutMs: 60_000,
      archiveTimeoutMs: 120_000,
      maxJsonOutputBytes: 1024 * 1024,
      maxDiscoveryOutputBytes: 10 * 1024 * 1024,
      maxStderrBytes: 8 * 1024,
      maxArchiveBytes: 100 * 1024 * 1024,
      maxConcurrentMetadataProcesses: 2,
      maxConcurrentArchiveProcesses: 1,
    });
  });

  it("validates identity without global GitHub CLI state", async () => {
    await withLease(async (lease) => {
      const identity = await provider.validateIdentity(lease);
      expect(identity.id).toMatch(/^\d+$/u);
      expect(identity.login.length).toBeGreaterThan(0);
    });
  });

  it("discovers the selected accessible repository", async () => {
    await withLease(async (lease) => {
      const repositories = await provider.listAccessibleRepositories(lease, {
        perPage: 100,
        maxPages: 10,
        maxRepositories: 1_000,
        startPage: 1,
      });
      expect(
        repositories.some(
          (repository) => repository.fullName === repositoryFullName,
        ),
      ).toBe(true);
    });
  });

  it("validates metadata and resolves the default branch to an exact SHA", async () => {
    await withLease(async (lease) => {
      const repository = await provider.validateRepositoryAccess(
        lease,
        repositoryFullName!,
      );
      expect(repository.fullName).toBe(repositoryFullName);
      expect(repository.defaultBranch.length).toBeGreaterThan(0);

      const commit = await provider.resolveCommit(
        lease,
        repository.fullName,
        repository.defaultBranch,
      );
      expect(commit.sha).toMatch(/^[0-9a-f]{40}$/u);
    });
  });
});

async function withLease(
  operation: (lease: CredentialLease) => Promise<void>,
): Promise<void> {
  const lease = new CredentialLease(credential!, {
    internalCredentialId: "real-github-provider-acceptance",
    credentialVersion: 1,
    repositoryFullName: repositoryFullName!,
    expiresAt: new Date(Date.now() + 120_000),
  });
  try {
    await operation(lease);
  } finally {
    lease.dispose();
  }
}
