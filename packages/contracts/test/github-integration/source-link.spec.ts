import { describe, expect, it } from "@jest/globals";
import { CREDENTIAL_PROVIDERS } from "../../src/github-integration/statuses.ts";
import {
  buildCanonicalRepositoryUrl,
  buildRepositorySourceLink,
} from "../../src/github-integration/source-link.ts";

const sha = "a".repeat(40);

describe("provider-pinned source links", () => {
  it.each([
    [CREDENTIAL_PROVIDERS.github, "owner/repo", "https://github.com/owner/repo/blob/" + sha + "/src/file.ts#L4-L8"],
    [CREDENTIAL_PROVIDERS.gitlab, "group/subgroup/repo", "https://gitlab.com/group/subgroup/repo/-/blob/" + sha + "/src/file.ts#L4-8"],
    [CREDENTIAL_PROVIDERS.bitbucket, "workspace/repo", "https://bitbucket.org/workspace/repo/src/" + sha + "/src/file.ts?fileviewer=file-view-default#file.ts-4"],
    [CREDENTIAL_PROVIDERS.azureDevOps, "org/Project Space/repo name", "https://dev.azure.com/org/Project%20Space/_git/repo%20name?path=%2Fsrc%2Ffile.ts&version=GC" + sha + "&_a=contents&line=4&lineEnd=8&lineStartColumn=1&lineEndColumn=1"],
  ] as const)("builds a pinned link for %s", (provider, fullName, expected) => {
    const canonicalRepositoryUrl = buildCanonicalRepositoryUrl(provider, fullName);
    expect(canonicalRepositoryUrl).not.toBeNull();
    expect(
      buildRepositorySourceLink({
        provider,
        canonicalRepositoryUrl: canonicalRepositoryUrl as string,
        commitSha: sha,
        path: "src/file.ts",
        startLine: 4,
        endLine: 8,
      }),
    ).toBe(expected);
  });

  it.each([
    "../secret.ts",
    "/absolute.ts",
    "src\\file.ts",
    "C:/repo/file.ts",
    "src//file.ts",
  ])("rejects unsafe source paths: %s", (path) => {
    expect(
      buildRepositorySourceLink({
        provider: CREDENTIAL_PROVIDERS.github,
        canonicalRepositoryUrl: "https://github.com/owner/repo",
        commitSha: sha,
        path,
        startLine: 1,
        endLine: 1,
      }),
    ).toBeNull();
  });

  it("rejects provider mismatch, incomplete provenance, and invalid line ranges", () => {
    expect(buildCanonicalRepositoryUrl(CREDENTIAL_PROVIDERS.azureDevOps, "project/repo")).toBeNull();
    expect(
      buildRepositorySourceLink({
        provider: CREDENTIAL_PROVIDERS.bitbucket,
        canonicalRepositoryUrl: "https://dev.azure.com/org/project/_git/repo",
        commitSha: sha,
        path: "src/file.ts",
      }),
    ).toBeNull();
    expect(
      buildRepositorySourceLink({
        provider: CREDENTIAL_PROVIDERS.github,
        canonicalRepositoryUrl: "https://github.com/owner/repo",
        commitSha: "branch-name",
        path: "src/file.ts",
      }),
    ).toBeNull();
    expect(
      buildRepositorySourceLink({
        provider: CREDENTIAL_PROVIDERS.github,
        canonicalRepositoryUrl: "https://github.com/owner/repo",
        commitSha: sha,
        path: "src/file.ts",
        startLine: 5,
        endLine: 2,
      }),
    ).toBeNull();
  });
});
