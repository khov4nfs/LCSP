import type {
  RepositoryScanJobStatus,
  RepositoryScanTriggerSource,
} from "@lcsp/contracts/github-integration";

export interface ScanJobStatusDto {
  scan_job_id: string;
  assessment_id: string;
  status: RepositoryScanJobStatus;
  trigger_source: RepositoryScanTriggerSource;
  attempt_count: number;
  blocked_reason: string | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
  correlationId: string;
}
