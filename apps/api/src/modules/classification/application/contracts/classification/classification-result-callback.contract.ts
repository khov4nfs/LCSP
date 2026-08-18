import type { ClassificationGuardrailStatus } from "@lcsp/contracts/scan";

export interface AcceptClassificationDto {
  technical_evidence_report_id: string;
  assessment_id: string;
  schema_version: string;
  classification_data: Record<string, unknown>;
  guardrail_status: ClassificationGuardrailStatus;
  /** Historical v1 fields only; the direct EngineeringRule runtime does not use them. */
  legal_rule_match_id?: string | null;
  verified_profile_id?: string | null;
}

export interface ClassificationResultCallbackResponseDto {
  accepted: boolean;
  classification_result_id: string;
  guardrail_status: ClassificationGuardrailStatus;
  correlationId?: string;
}
