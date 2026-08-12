import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const ASSESSMENT_CONTEXT_INCLUDES = {
  targetIds: "TARGET_IDS",
  pinnedArtifacts: "PINNED_ARTIFACTS",
  submittedAnswers: "SUBMITTED_ANSWERS",
} as const;

export type AssessmentContextInclude =
  (typeof ASSESSMENT_CONTEXT_INCLUDES)[keyof typeof ASSESSMENT_CONTEXT_INCLUDES];

export const ASSESSMENT_CONTEXT_ANSWER_FIELDS = {
  systemPurpose: "SYSTEM_PURPOSE",
  aiUsageType: "AI_USAGE_TYPE",
  providerDeclaration: "PROVIDER_DECLARATION",
  humanReviewDeclaration: "HUMAN_REVIEW_DECLARATION",
  deploymentDeclaration: "DEPLOYMENT_DECLARATION",
} as const;

export type AssessmentContextAnswerField =
  (typeof ASSESSMENT_CONTEXT_ANSWER_FIELDS)[keyof typeof ASSESSMENT_CONTEXT_ANSWER_FIELDS];

export type AssessmentContextResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
  artifact_versions: {
    wizard_profile_id: string;
    technical_evidence_report_id?: string;
  };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    wizard: {
      assessment_id: string;
      profile_ref: string;
      version: string;
      status: string;
      submitted_at: string | null;
      answers?: Partial<Record<AssessmentContextAnswerField, string | boolean>>;
      target_ids?: string[];
    };
    artifact_versions?: {
      technical_evidence_report_id?: string;
    };
  };
};
