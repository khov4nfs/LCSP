import { describe, expect, it } from "@jest/globals";

import {
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseAzureDevOpsRepositoryUrl,
} from "./github-cli-connect.support.js";

describe("parseGitHubRepositoryUrl", () => {
  it.each([
    "https://github.com/owner/repository",
    "https://github.com/owner/repository/",
    "https://github.com/owner/repository.git",
    "https://github.com/owner/repository.git/",
  ])("normalizes %s", (value) => {
    expect(parseGitHubRepositoryUrl(value)).toEqual({
      repositoryFullName: "owner/repository",
      canonicalUrl: "https://github.com/owner/repository",
    });
  });

  it.each([
    "http://github.com/owner/repository",
    "git@github.com:owner/repository.git",
    "ssh://git@github.com/owner/repository.git",
    "https://api.github.com/repos/owner/repository",
    "https://github.com/owner",
    "https://github.com/owner/repository/issues/1",
    "https://github.com/owner/repository/commit/abc",
    "https://github.com/owner/repository?tab=code",
    "https://github.com/owner/repository#readme",
    "https://github.com.attacker.tld/owner/repository",
    "https://fakegithub.com/owner/repository",
    "https://gitlab.com/owner/repository",
  ])("rejects unsafe locator %s", (value) => {
    expect(parseGitHubRepositoryUrl(value)).toBeNull();
  });
});

describe("parseGitLabRepositoryUrl", () => {
  it.each([
    "https://gitlab.com/group/project",
    "https://gitlab.com/org/platform/team/project/",
    "https://gitlab.com/org/platform/team/project.git",
  ])("normalizes nested project URL %s", (value) => {
    expect(parseGitLabRepositoryUrl(value)).toMatchObject({
      repositoryFullName: expect.stringContaining("/"),
      canonicalUrl: expect.stringMatching(/^https:\/\/gitlab\.com\//u),
    });
  });

  it.each([
    "http://gitlab.com/group/project",
    "https://gitlab.com.attacker.example/group/project",
    "https://fakegitlab.com/group/project",
    "https://gitlab.com/group/project/-/commit/abc",
    "https://gitlab.com/group/project/-/merge_requests/1",
    "https://gitlab.com/group/project?x=1",
  ])("rejects unsafe GitLab locator %s", (value) => {
    expect(parseGitLabRepositoryUrl(value)).toBeNull();
  });
});

describe("parseBitbucketRepositoryUrl", () => {
  it.each([
    "https://bitbucket.org/workspace-slug/repo-slug",
    "https://bitbucket.org/workspace-slug/repo-slug/",
    "https://bitbucket.org/workspace-slug/repo-slug.git",
  ])("normalizes Bitbucket project URL %s", (value) => {
    expect(parseBitbucketRepositoryUrl(value)).toEqual({
      repositoryFullName: "workspace-slug/repo-slug",
      canonicalUrl: "https://bitbucket.org/workspace-slug/repo-slug",
    });
  });

  it.each([
    "http://bitbucket.org/workspace/repo",
    "https://fakebitbucket.org/workspace/repo",
    "https://bitbucket.org.attacker.com/workspace/repo",
    "https://bitbucket.org/workspace",
    "https://bitbucket.org/workspace/repo/src/main",
  ])("rejects invalid Bitbucket locator %s", (value) => {
    expect(parseBitbucketRepositoryUrl(value)).toBeNull();
  });
});

describe("parseAzureDevOpsRepositoryUrl", () => {
  it.each([
    [
      "https://dev.azure.com/org-name/project-name/_git/repo-name",
      "org-name/project-name/repo-name",
      "https://dev.azure.com/org-name/project-name/_git/repo-name",
    ],
    [
      "https://dev.azure.com/org-name/project-name/_git/repo-name.git",
      "org-name/project-name/repo-name",
      "https://dev.azure.com/org-name/project-name/_git/repo-name",
    ],
    [
      "https://org-name.visualstudio.com/project-name/_git/repo-name",
      "org-name/project-name/repo-name",
      "https://dev.azure.com/org-name/project-name/_git/repo-name",
    ],
  ])(
    "normalizes Azure DevOps URL %s",
    (value, expectedFullName, expectedCanonical) => {
      expect(parseAzureDevOpsRepositoryUrl(value)).toEqual({
        repositoryFullName: expectedFullName,
        canonicalUrl: expectedCanonical,
      });
    },
  );

  it.each([
    "http://dev.azure.com/org/proj/_git/repo",
    "https://fakeazure.com/org/proj/_git/repo",
    "https://dev.azure.com/org/proj",
    "https://dev.azure.com/org/proj/_git/repo/branches",
  ])("rejects invalid Azure DevOps locator %s", (value) => {
    expect(parseAzureDevOpsRepositoryUrl(value)).toBeNull();
  });
});
