import {
  computeRepositorySetDigest,
  deriveRepositoryKey,
  type RepositoryPin,
} from "@lcsp/contracts/assessment-domain";

/**
 * Test helper: extends a scalar single-repository pin with the repository-set fields every
 * PinnedCase now carries (a set of one at ordinal 0).
 */
export function withSingleRepositorySet<
  T extends {
    repositoryId: string;
    repositorySnapshotId: string;
    repositoryScanJobId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
  },
>(
  pins: T,
): T & {
  repositorySetDigest: string;
  repositories: RepositoryPin[];
  repositorySetRecorded: boolean;
} {
  const repositories: RepositoryPin[] = [
    {
      repositoryKey: deriveRepositoryKey(`acme/${pins.repositoryId}`, []),
      ordinal: 0,
      connectionId: "connection-fixture",
      repositoryId: pins.repositoryId,
      repositoryFullName: `acme/${pins.repositoryId}`,
      repositorySnapshotId: pins.repositorySnapshotId,
      repositoryScanJobId: pins.repositoryScanJobId,
      repositoryCommit: pins.repositoryCommit,
      sourcePathPrefix: pins.sourcePathPrefix,
    },
  ];
  return {
    ...pins,
    repositorySetDigest: computeRepositorySetDigest(repositories),
    repositories,
    repositorySetRecorded: true,
  };
}
