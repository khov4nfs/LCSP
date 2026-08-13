import type { DocumentRequestStatus } from "@lcsp/contracts/document";

export interface DocumentCallbackRequest {
  document_request_id: string;
  status: DocumentRequestStatus;
  document_url?: string;
  error_code?: string;
  blocked_reason?: string;
}

export interface DocumentCallbackDto {
  processed: boolean;
  document_request_id: string;
  correlationId: string;
}
