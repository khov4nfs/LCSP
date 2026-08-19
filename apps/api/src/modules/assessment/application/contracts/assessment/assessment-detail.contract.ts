export { ASSESSMENT_ERROR_CODES as ASSESSMENT_DETAIL_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ERROR_CODES as ASSESSMENT_DETAIL_ERROR_CODES,
  WIZARD_STATUS_CODES,
  type AssessmentLockReason,
  type AssessmentMissingEvidenceCode,
  type AssessmentNextActionKey,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";
import type {
  ClassificationGuardrailStatus,
  EngineeringRuleEvaluationStatus,
} from "@lcsp/contracts/scan";

export type AssessmentDetailErrorCode =
  (typeof ASSESSMENT_DETAIL_ERROR_CODES)[keyof typeof ASSESSMENT_DETAIL_ERROR_CODES];

export type WizardStatus =
  (typeof WIZARD_STATUS_CODES)[keyof typeof WIZARD_STATUS_CODES];

export interface ReadinessState {
  classification_locked: boolean;
  lock_reason: AssessmentLockReason | null;
  missing_evidence: AssessmentMissingEvidenceCode[];
}

export interface TechnicalEvidenceDisplayDto {
  kind: string;
  label: string;
  file_path: string | null;
  symbol_ref: string | null;
  start_line: number | null;
  end_line: number | null;
}

export interface LegalProvisionDisplayDto {
  document_id: string;
  locator: string;
  article_number: string | null;
  clause_number: string | null;
  point_code: string | null;
  content: string;
}

export interface EngineeringRuleEvaluationDto {
  engineering_rule_id: string;
  legal_rule_id: string;
  concept: string;
  status: EngineeringRuleEvaluationStatus;
  reason: string;
  evidence_refs: string[];
  technical_evidence: TechnicalEvidenceDisplayDto[];
  source_chunk_ids: string[];
  source_locators: string[];
  legal_provisions: LegalProvisionDisplayDto[];
  confidence: number;
  limitations: string[];
}

export interface ClassificationResultSummaryDto {
  mode: string | null;
  status: string | null;
  engineering_summary: {
    compliant: number;
    non_compliant: number;
    unknown: number;
    total: number;
  };
  evaluations: EngineeringRuleEvaluationDto[];
  limitations: string[];
  legal_rule_catalog_version_id: string | null;
  legal_corpus_version_id: string | null;
  technical_evidence_report_id: string | null;
  snapshot_id: string | null;
  // Legacy display fields remain nullable while web consumers migrate.
  risk_level: string | null;
  applicability_assessment: string | null;
  citation_basis: string[];
  rationale: string | null;
}

export interface AssessmentDetailDto {
  assessment_id: string;
  name: string;
  status: AssessmentStatusCode;
  owner_id: string;
  organization_id: string;
  wizard_status: WizardStatus;
  readiness_state: ReadinessState;
  guardrail_status: ClassificationGuardrailStatus | null;
  classification_result: ClassificationResultSummaryDto | null;
  /** Legacy display fields are empty in the canonical direct runtime. */
  legal_rule_match_guardrail_status: null;
  legal_rule_match_diagnostics: null;
  verified_profile_review: null;
  can_rerun_classification: boolean;
  next_action: AssessmentNextActionKey;
  created_at: string;
  updated_at: string;
  correlationId: string;
}
