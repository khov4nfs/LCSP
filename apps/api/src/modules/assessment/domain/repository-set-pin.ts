/**
 * Business purpose: Decide whether a stored or submitted claim about "the repositories this assessment was
 * pinned to" still describes the assessment's current pinned repository set, so audit requests, reused
 * decisions and exports never rest on a different set of code.
 * Business rules:
 * - When both sides carry a set digest, the digest alone decides; it covers every repository, snapshot,
 *   commit and source scope of the set.
 * - Without a recorded digest the claim can only be checked by the primary commit, which proves nothing about
 *   additional repositories; it is therefore accepted only for an assessment pinned to a single repository.
 * - Commits compare case-insensitively; a missing commit never matches.
 * Execution flow:
 * 1. Compare digests when the claim and the case both have one.
 * 2. Otherwise reject when the case pins more than one repository.
 * 3. Otherwise compare the primary commit.
 * Failure cases:
 * - Returns false; the caller rejects with its own stale-revision or pins-not-ready problem.
 * Side effects:
 * - None; pure comparison.
 */
export function pinnedRepositorySetMatches(
  claim: {
    repositorySetDigest?: string | null;
    repositoryCommit?: string | null;
  },
  current: {
    repositorySetDigest?: string | null;
    repositoryCommit?: string | null;
    repositoryCount?: number | null;
  },
): boolean {
  if (claim.repositorySetDigest && current.repositorySetDigest) {
    return claim.repositorySetDigest === current.repositorySetDigest;
  }
  if ((current.repositoryCount ?? 1) > 1) return false;
  return (
    !!claim.repositoryCommit &&
    !!current.repositoryCommit &&
    claim.repositoryCommit.toLowerCase() ===
      current.repositoryCommit.toLowerCase()
  );
}

/**
 * Business purpose: View the assessment's pins through ONE of its repositories, so code written for a single
 * pinned repository (discovery, profile and interview checks) judges a record against that repository's own
 * snapshot, commit and source boundary and never against the primary repository's.
 * Business rules:
 * - Only a repository that is part of the pinned set can be selected; the set digest and rule-set pin are kept.
 * - The scalar repository fields are overridden by the selected repository; every other pin is untouched.
 * Execution flow:
 * 1. Find the pinned repository by snapshot id or key.
 * 2. Return the pins with that repository's coordinates in the scalar fields.
 * Failure cases:
 * - Returns null when the snapshot or key is not part of the set; the caller rejects with its own problem.
 * Side effects:
 * - None; pure projection.
 */
export function pinsForRepository<
  P extends {
    repositories: ReadonlyArray<{
      repositoryKey: string;
      repositoryId: string;
      repositorySnapshotId: string;
      repositoryScanJobId: string;
      repositoryCommit: string;
      sourcePathPrefix: string | null;
    }>;
  },
>(
  pins: P,
  selector: { snapshotId: string } | { repositoryKey: string },
): (P & { repositoryKey: string }) | null {
  const pin = pins.repositories.find((candidate) =>
    "snapshotId" in selector
      ? candidate.repositorySnapshotId === selector.snapshotId
      : candidate.repositoryKey === selector.repositoryKey,
  );
  if (!pin) return null;
  return {
    ...pins,
    repositoryKey: pin.repositoryKey,
    repositoryId: pin.repositoryId,
    repositorySnapshotId: pin.repositorySnapshotId,
    repositoryScanJobId: pin.repositoryScanJobId,
    repositoryCommit: pin.repositoryCommit,
    sourcePathPrefix: pin.sourcePathPrefix,
  };
}

/**
 * Business purpose: Resolve which pinned repository a piece of evidence or a tool call refers to, so every
 * source path and commit is judged against that repository's own boundary and never another's.
 * Business rules:
 * - An explicit key must name a repository pinned to the assessment.
 * - Without a key the target is unambiguous only when the assessment pins exactly one repository; with
 *   several repositories a missing key is rejected rather than guessed.
 * Execution flow:
 * 1. Look up the requested key among the pinned repositories.
 * 2. When no key was given, return the sole pinned repository if there is exactly one.
 * Failure cases:
 * - Returns null for an unknown key or an ambiguous missing key; the caller rejects with
 *   REPOSITORY_KEY_UNKNOWN.
 * Side effects:
 * - None; pure lookup.
 */
export function resolvePinnedRepository<T extends { repositoryKey: string }>(
  repositories: ReadonlyArray<T>,
  requestedKey: string | null | undefined,
): T | null {
  if (requestedKey) {
    return (
      repositories.find((pin) => pin.repositoryKey === requestedKey) ?? null
    );
  }
  return repositories.length === 1 ? (repositories[0] ?? null) : null;
}
