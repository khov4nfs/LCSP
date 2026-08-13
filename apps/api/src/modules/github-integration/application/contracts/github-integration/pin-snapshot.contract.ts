import type { RepositorySnapshotStatus } from "@lcsp/contracts/github-integration";

export interface PinSnapshotDto {
  snapshot_id: string;
  repository_full_name: string;
  commit_sha: string;
  branch: string | null;
  status: RepositorySnapshotStatus;
  created_at: string;
  correlationId: string;
}
