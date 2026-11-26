import { describe, expect, it } from "@jest/globals";
import {
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "../../src/github-integration/repository-url.js";

describe("shared provider repository URL locators", () => {
  it.each([
    ["https://bitbucket.org/workspace/repository", "workspace/repository"],
    ["https://bitbucket.org/workspace/repository.git/", "workspace/repository"],
  ])("parses Bitbucket URL %s", (url, repositoryFullName) => {
    expect(parseBitbucketRepositoryUrl(url)).toEqual({
      repositoryFullName,
      canonicalUrl: `https://bitbucket.org/${repositoryFullName}`,
    });
  });

  it.each([
    [
      "https://dev.azure.com/acme/Project%20North/_git/Policy%20Repo",
      "acme/Project North/Policy Repo",
      "https://dev.azure.com/acme/Project%20North/_git/Policy%20Repo",
    ],
    [
      "https://acme.visualstudio.com/Project%20North/_git/Policy%20Repo.git/",
      "acme/Project North/Policy Repo",
      "https://dev.azure.com/acme/Project%20North/_git/Policy%20Repo",
    ],
  ])("parses Azure URL %s", (url, repositoryFullName, canonicalUrl) => {
    expect(parseAzureDevOpsRepositoryUrl(url)).toEqual({
      repositoryFullName,
      canonicalUrl,
    });
  });

  it.each([
    "https://bitbucket.org/workspace/%2e%2e",
    "https://bitbucket.org/workspace/repo%2Fother",
    "https://bitbucket.org/workspace/repo%252Fother",
    "https://user:secret@bitbucket.org/workspace/repo",
    "https://bitbucket.org:443/workspace/repo",
    "https://bitbucket.org/workspace/repo?download=1",
    "https://bitbucket.org/workspace/repo#readme",
    "https://bitbucket.org.evil.invalid/workspace/repo",
    "https://bitbucket.org/workspace\\repo",
    "https://bitbucket.org/workspace/%E0%A4%A",
  ])("rejects unsafe Bitbucket locator %s", (url) => {
    expect(parseBitbucketRepositoryUrl(url)).toBeNull();
  });

  it.each([
    "https://dev.azure.com/acme/../_git/repo",
    "https://dev.azure.com/acme/%2e%2e/_git/repo",
    "https://dev.azure.com/acme/project/_git/repo%2Fother",
    "https://dev.azure.com/acme/project/_git/repo%252Fother",
    "https://acme.visualstudio.com/project/_git/repo/branches",
    "https://dev.azure.com/acme/project/_git/repo?path=/secret",
    "https://user@dev.azure.com/acme/project/_git/repo",
    "https://dev.azure.com:443/acme/project/_git/repo",
    "https://acme.evil.visualstudio.com/project/_git/repo",
    "https://acme.visualstudio.com/project\\_git\\repo",
    "https://dev.azure.com/acme/project/_git/%00repo",
    "https://dev.azure.com/acme/project/_git/%E0%A4%A",
  ])("rejects unsafe Azure locator %s", (url) => {
    expect(parseAzureDevOpsRepositoryUrl(url)).toBeNull();
  });

  it("keeps GitHub and GitLab URL behavior intact", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/acme/policy.git"),
    ).toMatchObject({ repositoryFullName: "acme/policy" });
    expect(
      parseGitLabRepositoryUrl("https://gitlab.com/org/team/policy"),
    ).toMatchObject({ repositoryFullName: "org/team/policy" });
  });

  it.each([
    "https://github.com/acme/policy",
    "https://gitlab.com/acme/policy",
    "https://bitbucket.org/acme/policy",
  ])("does not parse cross-provider URL as Azure: %s", (url) => {
    expect(parseAzureDevOpsRepositoryUrl(url)).toBeNull();
  });
});
