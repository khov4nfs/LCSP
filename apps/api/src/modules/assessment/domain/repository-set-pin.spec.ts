import { describe, expect, it } from "@jest/globals";
import { pinnedRepositorySetMatches } from "./repository-set-pin.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const commit = "c".repeat(40);

describe("pinnedRepositorySetMatches", () => {
  it("decides by digest when both sides carry one", () => {
    const current = { repositorySetDigest: digestA, repositoryCommit: commit };
    expect(
      pinnedRepositorySetMatches({ repositorySetDigest: digestA }, current),
    ).toBe(true);
    expect(
      pinnedRepositorySetMatches(
        { repositorySetDigest: digestB, repositoryCommit: commit },
        current,
      ),
    ).toBe(false);
  });

  it("falls back to the primary commit for a single repository", () => {
    expect(
      pinnedRepositorySetMatches(
        { repositoryCommit: commit.toUpperCase() },
        { repositorySetDigest: digestA, repositoryCommit: commit, repositoryCount: 1 },
      ),
    ).toBe(true);
    expect(
      pinnedRepositorySetMatches(
        { repositoryCommit: "d".repeat(40) },
        { repositoryCommit: commit },
      ),
    ).toBe(false);
  });

  it("never accepts a commit-only claim once several repositories are pinned", () => {
    expect(
      pinnedRepositorySetMatches(
        { repositoryCommit: commit },
        { repositorySetDigest: digestA, repositoryCommit: commit, repositoryCount: 2 },
      ),
    ).toBe(false);
  });

  it("rejects a missing commit", () => {
    expect(pinnedRepositorySetMatches({}, { repositoryCommit: commit })).toBe(false);
    expect(pinnedRepositorySetMatches({ repositoryCommit: commit }, {})).toBe(false);
  });
});
