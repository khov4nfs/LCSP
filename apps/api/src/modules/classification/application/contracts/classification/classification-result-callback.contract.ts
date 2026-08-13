import type { ClassificationGuardrailStatus } from "@lcsp/contracts/scan";

export interface AcceptClassificationDto {
  legal_rule_match_id: string;
  verified_profile_id: string;
  assessment_id: string;
  schema_version: string;
  classification_data: Record<string, unknown>;
  guardrail_status: ClassificationGuardrailStatus;
}

export interface ClassificationResultCallbackResponseDto {
  accepted: boolean;
  classification_result_id: string;
  guardrail_status: ClassificationGuardrailStatus;
  correlationId?: string;
}
