import { describe, expect, it } from "@jest/globals";

import {
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
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
