import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const WIZARD_CLAIM_FIELDS = {
  provider: "PROVIDER",
  aiUsageType: "AI_USAGE_TYPE",
  humanReview: "HUMAN_REVIEW",
  deploymentContext: "DEPLOYMENT_CONTEXT",
  decisionPath: "DECISION_PATH",
} as const;

export type WizardClaimField =
  (typeof WIZARD_CLAIM_FIELDS)[keyof typeof WIZARD_CLAIM_FIELDS];

export const WIZARD_CLAIM_EXPECTED_VALUES = {
  openai: "OPENAI",
  google: "GOOGLE",
  anthropic: "ANTHROPIC",
  providerApi: "PROVIDER_API",
  humanReviewPresent: "HUMAN_REVIEW_PRESENT",
  production: "PRODUCTION",
  present: "PRESENT",
} as const;

export type WizardClaimExpectedValue =
  (typeof WIZARD_CLAIM_EXPECTED_VALUES)[keyof typeof WIZARD_CLAIM_EXPECTED_VALUES];

export const WIZARD_CLAIM_COMPARISON_SCOPES = {
  assessment: "ASSESSMENT",
  target: "TARGET",
  pathPrefix: "PATH_PREFIX",
} as const;

export type WizardClaimComparisonScope =
  (typeof WIZARD_CLAIM_COMPARISON_SCOPES)[keyof typeof WIZARD_CLAIM_COMPARISON_SCOPES];

export const WIZARD_CLAIM_VERDICTS = {
  supported: "SUPPORTED",
  contradicted: "CONTRADICTED",
  notFound: "NOT_FOUND",
  unknown: "UNKNOWN",
  outOfCoverage: "OUT_OF_COVERAGE",
} as const;

export type WizardClaimVerdict =
  (typeof WIZARD_CLAIM_VERDICTS)[keyof typeof WIZARD_CLAIM_VERDICTS];

export type CompareWizardClaimResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlationId: string;
  artifact_versions: {
    wizard_profile_id: string;
    technical_evidence_report_id: string;
  };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    verdict: WizardClaimVerdict;
    compared_attributes: {
      target_ref: string;
      claim_field: WizardClaimField;
      expected_value: WizardClaimExpectedValue;
      comparison_scope: WizardClaimComparisonScope;
    };
    evidence_refs: string[];
    coverage_state: AgenticToolCoverageState;
    missing_evidence_explanation?: string;
    conflict_candidate_ref?: string;
  };
};
