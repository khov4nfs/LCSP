import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import type { ArtifactRef } from "@/features/artifacts/types/artifact.types";
export {
  PROGRAM_EVIDENCE_METRIC_FORMATS,
  PROGRAM_EVIDENCE_UNAVAILABLE_REASONS,
  type ProgramEvidenceMetric,
  type ProgramEvidenceSummary,
} from "@/features/assessment-flow/types/assessment-flow.types";

export const INVESTIGATION_TRACE_STATUSES = {
  inProgress: "IN_PROGRESS",
  completed: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
  failed: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
  paused: "PAUSED",
} as const;

export type InvestigationTraceStatus =
  (typeof INVESTIGATION_TRACE_STATUSES)[keyof typeof INVESTIGATION_TRACE_STATUSES];

export type InvestigationTraceStep = {
  id: string;
  label: string;
};

export type InvestigationTraceViewModel = {
  status: InvestigationTraceStatus;
  steps: InvestigationTraceStep[];
  evidenceClaimCount: number | null;
  summary?: string | null;
  artifactRef?: ArtifactRef | null;
};

export const FINDING_PRIORITIES = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
} as const;

export type FindingPriority =
  (typeof FINDING_PRIORITIES)[keyof typeof FINDING_PRIORITIES];

export const ENGINEERING_RULE_EVALUATION_STATUSES = {
  compliant: "COMPLIANT",
  nonCompliant: "NON_COMPLIANT",
  unknown: "UNKNOWN",
} as const;

export type EngineeringRuleEvaluationStatus =
  (typeof ENGINEERING_RULE_EVALUATION_STATUSES)[keyof typeof ENGINEERING_RULE_EVALUATION_STATUSES];

export type EngineeringRuleFindingSource = {
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  ruleId?: string | null;
  symbolRef?: string | null;
};

export type EngineeringRuleFindingViewModel = {
  id: string;
  priority?: FindingPriority | null;
  status: EngineeringRuleEvaluationStatus;
  issue: string;
  whyItMatters: string;
  source: EngineeringRuleFindingSource;
  artifactRef?: ArtifactRef | null;
};

export type EngineeringRuleFindingsViewModel = {
  findings: EngineeringRuleFindingViewModel[];
  artifactRef?: ArtifactRef | null;
};
