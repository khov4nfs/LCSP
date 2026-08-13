import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

export type EvidenceSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface EvidenceFindingDto {
  finding_id: string;
  tool: string;
  finding_type: string;
  severity: EvidenceSeverity;
  description: string;
  file_path: string | null;
  line_number: number | null;
}

export interface EvidencePrivacyFlagsDto {
  containsSourceCode: false;
  secretsRedacted: true;
}

export interface EvidenceDetailDto {
  evidence_report_id: string;
  assessment_id: string;
  schema_version: string;
  tools_version: Record<string, string>;
  config_hash: Record<string, string>;
  findings: EvidenceFindingDto[];
  privacy_flags: EvidencePrivacyFlagsDto;
  status: typeof TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted;
  created_at: string;
  correlationId: string;
}
