import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";
import {
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  type AssessmentContextAnswerField,
  type AssessmentContextInclude,
} from "@lcsp/contracts/evidence";

export {
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  type AssessmentContextAnswerField,
  type AssessmentContextInclude,
};

export type AssessmentContextResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlationId: string;
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
