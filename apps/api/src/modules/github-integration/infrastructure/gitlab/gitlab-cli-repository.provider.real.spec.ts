import { beforeAll, describe, expect, it } from "@jest/globals";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { parseGitLabRepositoryUrl } from "../../application/commands/github-cli-connect.support.js";
import { GitLabCliRepositoryProvider } from "./gitlab-cli-repository.provider.js";

const token = process.env.LCSP_ACCEPTANCE_GITLAB_TOKEN;
const executablePath = process.env.GITLAB_CLI_EXECUTABLE_PATH;
const repositoryUrl = process.env.LCSP_ACCEPTANCE_GITLAB_REPOSITORY_URL;
const locator = repositoryUrl
  ? parseGitLabRepositoryUrl(repositoryUrl)
  : undefined;
const enabled = Boolean(token && executablePath && locator);
const describeReal = enabled ? describe : describe.skip;

describeReal("GitLab CLI repository provider (opt-in real GitLab)", () => {
  let provider: GitLabCliRepositoryProvider;

  beforeAll(() => {
    provider = new GitLabCliRepositoryProvider({
      executablePath: executablePath!,
      timeoutMs: 60_000,
      maxJsonOutputBytes: 2 * 1024 * 1024,
    });
  });

  it("validates identity with isolated glab state", async () => {
    await withLease(async (lease) => {
      const identity = await provider.validateIdentity(lease);
      expect(identity.id).toMatch(/^\d+$/u);
      expect(identity.login.length).toBeGreaterThan(0);
    });
  });

  it("resolves authoritative project metadata", async () => {
    await withLease(async (lease) => {
      const project = await provider.validateRepositoryAccess(
        lease,
        locator!.repositoryFullName,
      );
      expect(project.id).toMatch(/^\d+$/u);
      expect(project.fullName.toLowerCase()).toBe(
        locator!.repositoryFullName.toLowerCase(),
      );
      expect(project.defaultBranch.length).toBeGreaterThan(0);
      expect(project.private).toBe(true);
    });
  });

  it("resolves the default branch to an exact commit SHA", async () => {
    await withLease(async (lease) => {
      const project = await provider.validateRepositoryAccess(
        lease,
        locator!.repositoryFullName,
      );
      const commit = await provider.resolveCommit(
        lease,
        project.fullName,
        project.defaultBranch,
      );
      expect(commit.sha).toMatch(/^[0-9a-f]{40}$/u);
    });
  });
});

async function withLease(
  operation: (lease: CredentialLease) => Promise<void>,
): Promise<void> {
  const lease = new CredentialLease(token!, {
    internalCredentialId: "real-gitlab-provider-acceptance",
    credentialVersion: 1,
    repositoryFullName: locator!.repositoryFullName,
    expiresAt: new Date(Date.now() + 120_000),
  });
  try {
    await operation(lease);
  } finally {
    lease.dispose();
  }
}
