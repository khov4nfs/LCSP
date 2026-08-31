/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { describe, expect, it } from "@jest/globals";
import { GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES } from "@lcsp/contracts/github-integration";

import { CredentialLease } from "../../application/security/credential-lease.js";
import { parseGitLabRepositoryUrl } from "../../application/commands/github-cli-connect.support.js";
import { GitLabCliRepositoryProvider } from "./gitlab-cli-repository.provider.js";
import { GitLabSecureArchiveHttpTransport } from "./gitlab-secure-archive-http.transport.js";
import { GitHubArchiveTransportError } from "../github/github-secure-archive-http.transport.js";

const token = process.env.LCSP_ACCEPTANCE_GITLAB_TOKEN;
const executablePath = process.env.GITLAB_CLI_EXECUTABLE_PATH;
const repositoryUrl = process.env.LCSP_ACCEPTANCE_GITLAB_REPOSITORY_URL;
const locator = repositoryUrl
  ? parseGitLabRepositoryUrl(repositoryUrl)
  : undefined;
const describeReal = token && locator ? describe : describe.skip;

describeReal("GitLab exact-SHA archive transport (opt-in real GitLab)", () => {
  it("streams a private exact-SHA archive without exposing redirect metadata", async () => {
    const lease = new CredentialLease(token!, {
      internalCredentialId: "real-gitlab-archive-acceptance",
      credentialVersion: 1,
      repositoryFullName: locator!.repositoryFullName,
      expiresAt: new Date(Date.now() + 120_000),
    });
    try {
      const provider = new GitLabCliRepositoryProvider({
        executablePath: executablePath!,
        timeoutMs: 60_000,
        maxJsonOutputBytes: 2 * 1024 * 1024,
      });
      const project = await provider.validateRepositoryAccess(
        lease,
        locator!.repositoryFullName,
      );
      const commit = await provider.resolveCommit(
        lease,
        project.fullName,
        project.defaultBranch,
      );
      let result;
      try {
        result = await new GitLabSecureArchiveHttpTransport({
          timeoutMs: 120_000,
          maxArchiveBytes: 100 * 1024 * 1024,
        }).downloadArchive({
          credentialLease: lease,
          repositoryId: project.id,
          repositoryFullName: project.fullName,
          commitSha: commit.sha,
        });
      } catch (error) {
        if (error instanceof GitHubArchiveTransportError) {
          throw new Error(
            `gitlab_archive_failed status=${error.status ?? "unknown"}`,
          );
        }
        throw error;
      }
      let bytes = 0;
      for await (const chunk of result.stream) bytes += chunk.length;
      expect(bytes).toBeGreaterThan(0);
      expect(result.redirectValidation).toBe(
        GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified,
      );
      expect(result.validatedHost).toBe("gitlab.com");
    } finally {
      lease.dispose();
    }
  });
});
