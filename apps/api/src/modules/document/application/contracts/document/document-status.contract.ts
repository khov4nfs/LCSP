import type {
  DocumentRequestStatus,
  DocumentType,
} from "@lcsp/contracts/document";

export interface DocumentStatusDto {
  document_request_id: string;
  document_type: DocumentType;
  status: DocumentRequestStatus;
  blocked_reason: string | null;
  guardrail_status: string | null;
  download_url: string | null;
  download_url_expires_at: string | null;
  requested_at: string;
  completed_at: string | null;
  correlationId: string;
}
