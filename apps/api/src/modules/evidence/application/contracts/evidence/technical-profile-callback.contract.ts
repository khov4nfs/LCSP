export interface TechnicalProfileCallbackRequest {
  evidence_report_id: string;
  assessment_id: string;
  schema_version: string;
  provider_version: string;
  profile_data: Record<string, unknown>;
  privacy_flags: Record<string, unknown>;
}

export interface TechnicalProfileCallbackDto {
  accepted: boolean;
  technical_profile_id: string;
  correlationId: string;
}
