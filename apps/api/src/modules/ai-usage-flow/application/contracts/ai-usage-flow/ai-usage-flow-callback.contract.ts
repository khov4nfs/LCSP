export interface AIUsageFlowClaimRequest {
  claim_id: string;
  claim_type: string;
  confidence: string;
  evidence_refs: string[];
  uncertainty_reason: string | null;
  description: string;
  is_material: boolean;
}

export interface AIUsageFlowCallbackRequest {
  technical_profile_id: string;
  assessment_id: string;
  schema_version: string;
  provider_version: string;
  claims: AIUsageFlowClaimRequest[];
  unknown_usages: Record<string, unknown>[];
  privacy_flags: Record<string, unknown>;
  /**
   * Sanitized deterministic worker artifact used to preserve rich claim
   * field/value/lifecycle/confidence metadata. The API joins its claims to the
   * compact callback claims by claim_id before persistence; it is not a second
   * source of truth and must pass the same privacy validation.
   */
  flow_data?: Record<string, unknown>;
}

export interface AIUsageFlowCallbackDto {
  accepted: boolean;
  ai_usage_flow_id: string;
  correlation_id: string;
}
