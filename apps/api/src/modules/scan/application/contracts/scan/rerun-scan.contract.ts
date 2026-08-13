export interface RerunScanRequestDto {
  snapshot_id: string;
  idempotency_key: string;
  reason?: string;
}

export interface RerunScanResponseDto {
  scan_job_id: string;
  status: string;
  replaces_scan_job_id?: string;
  correlationId: string;
}
