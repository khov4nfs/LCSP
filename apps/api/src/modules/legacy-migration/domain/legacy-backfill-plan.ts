import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  LEGACY_BACKFILL_REASONS,
  type LegacyBackfillReason,
} from "@lcsp/contracts/legacy-migration";

export type LegacySnapshotCandidate = {
  id: string;
  status: string;
  commitSha: string;
  /** Status of the snapshot's repository connection; null when the connection row is gone. */
  connectionStatus: string | null;
  repositoryId: string;
  repositoryFullName: string;
  connectionRepositoryId: string | null;
  connectionRepositoryFullName: string | null;
  createdAt: Date;
};

export type LegacyBackfillPlan = {
  /** Snapshot to pin for the fresh V2 run, or null when the customer must finish repository setup. */
  pinSnapshotId: string | null;
  reason: LegacyBackfillReason;
};

const COMMIT = /^[0-9a-f]{40,64}$/iu;

/**
 * Deterministic pin selection for a non-terminal V1 assessment. It never judges legal or technical
 * meaning: it only picks the newest snapshot that is READY, has a well-formed commit and a live
 * repository connection with matching repository identity. Missing inputs remain visibly waiting,
 * never a ready assessment. Ownership/provenance are scoped by the repository query before selection.
 */
export function planLegacyBackfill(
  snapshots: readonly LegacySnapshotCandidate[],
): LegacyBackfillPlan {
  if (snapshots.length === 0)
    return { pinSnapshotId: null, reason: LEGACY_BACKFILL_REASONS.NO_SNAPSHOT };
  const usable = snapshots
    .filter(
      (snapshot) =>
        snapshot.status === REPOSITORY_SNAPSHOT_STATUSES.ready &&
        COMMIT.test(snapshot.commitSha) &&
        snapshot.repositoryId.trim().length > 0 &&
        snapshot.repositoryFullName.trim().length > 0 &&
        snapshot.connectionStatus === REPOSITORY_CONNECTION_STATUSES.active &&
        snapshot.repositoryId === snapshot.connectionRepositoryId &&
        snapshot.repositoryFullName === snapshot.connectionRepositoryFullName,
    )
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    );
  const chosen = usable[0];
  return chosen
    ? {
        pinSnapshotId: chosen.id,
        reason: LEGACY_BACKFILL_REASONS.PINNED_LATEST_READY_SNAPSHOT,
      }
    : {
        pinSnapshotId: null,
        reason: LEGACY_BACKFILL_REASONS.NO_USABLE_SNAPSHOT,
      };
}

export const legacyBackfillLifecycle = (plan: LegacyBackfillPlan) =>
  plan.pinSnapshotId === null
    ? ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT
    : ASSESSMENT_LIFECYCLE_STATES.PREPARING;
