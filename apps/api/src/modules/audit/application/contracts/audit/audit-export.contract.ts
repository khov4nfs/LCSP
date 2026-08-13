import type {
  AUDIT_EXPORT_STATUSES,
  AuditExportStatus,
} from "@lcsp/contracts/audit";

export interface AuditExportRequestDto {
  export_request_id: string;
  status: AuditExportStatus;
  from_date: string;
  to_date: string;
  version: number;
  generated_at: string | null;
  correlationId: string;
}

export interface AuditExportStatusDto extends AuditExportRequestDto {
  checksum_sha256: string | null;
  requested_at: string;
  completed_at: string | null;
  download_url: string | null;
  download_url_expires_at: string | null;
}

export interface AuditExportArtifactEvent {
  event_id: string;
  event_type: string;
  actor_id: string | null;
  organization_id: string;
  decision: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
}

export interface AuditExportArtifact {
  export_request_id: string;
  organization_id: string;
  version: number;
  generated_at: string;
  filter_criteria: {
    from_date: string;
    to_date: string;
  };
  total_events: number;
  checksum_sha256: string;
  events: AuditExportArtifactEvent[];
}

export type AuditExportReadyStatus = (typeof AUDIT_EXPORT_STATUSES)["ready"];
