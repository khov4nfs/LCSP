import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

export function isRepositoryScanJobActive(status: string): boolean {
  return (
    status === REPOSITORY_SCAN_JOB_STATUSES.queued ||
    status === REPOSITORY_SCAN_JOB_STATUSES.running
  );
}
