export interface RerunClassificationRequestDto {
  reason?: string;
}

export interface RerunClassificationResponseDto {
  legal_rule_match_id: string;
  status: ClassificationRerunStatus;
  correlation_id: string;
}
import type { ClassificationRerunStatus } from "@lcsp/contracts/scan";
