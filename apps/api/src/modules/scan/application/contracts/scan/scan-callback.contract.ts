import type { ScanCallbackStatus } from "@lcsp/contracts/scan";

export interface ScanCallbackRequest {
  scan_job_id: string;
  tools_version?: Record<string, unknown>;
  config_hash?: Record<string, unknown>;
  evidence_payload?: Record<string, unknown>;
  privacy_flags: Record<string, unknown>;
  schema_version: string;
  status: ScanCallbackStatus;
  error_code?: string;
  is_artifact_reference?: boolean;
  artifact_manifest?: {
    artifact_id: string;
    total_size: number;
    hash: string;
    chunks: string[];
  };
}

export interface ScanCallbackDto {
  accepted: boolean;
  evidence_report_id: string;
  correlationId: string;
}
