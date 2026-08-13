import type {
  DocumentRequestStatus,
  DocumentType,
} from "@lcsp/contracts/document";

export interface FinalReportRequestDto {
  document_request_id: string;
  status: DocumentRequestStatus;
  document_type: DocumentType;
  correlationId: string;
}
