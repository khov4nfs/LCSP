import type { RepositoryScanJobStatus } from "@lcsp/contracts/github-integration";

export interface TriggerScanDto {
  scan_job_id: string;
  status: RepositoryScanJobStatus;
  is_new: boolean;
  correlationId: string;
}
