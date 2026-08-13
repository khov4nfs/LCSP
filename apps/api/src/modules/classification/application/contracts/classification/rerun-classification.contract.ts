export interface RerunClassificationRequestDto {
  reason?: string;
}

export interface RerunClassificationResponseDto {
  legal_rule_match_id: string;
  status: ClassificationRerunStatus;
  correlationId: string;
}
import type { ClassificationRerunStatus } from "@lcsp/contracts/scan";
