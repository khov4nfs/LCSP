import type { ClassificationRerunStatus } from "@lcsp/contracts/scan";

export interface RerunClassificationRequestDto {
  reason?: string;
}

export interface RerunClassificationResponseDto {
  technical_evidence_report_id: string;
  status: ClassificationRerunStatus;
  correlationId: string;
}
