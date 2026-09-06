import type { AssessmentRepositoryProvider } from "@lcsp/contracts/assessment";
import type { ToolActivityStatus } from "@/features/workspace/types/assessment-chat.types";

export type RepositoryHistory = {
  provider: string;
  repositoryFullName: string;
  commitSha: string;
};

export const PROGRAM_EVIDENCE_METRIC_FORMATS = {
  count: "count",
  percent: "percent",
} as const;

export const PROGRAM_EVIDENCE_UNAVAILABLE_REASONS = {
  missingCanonicalMetric: "missing_canonical_metric",
} as const;

export type ProgramEvidenceMetric = {
  value: number | null;
  format: (typeof PROGRAM_EVIDENCE_METRIC_FORMATS)[keyof typeof PROGRAM_EVIDENCE_METRIC_FORMATS];
  unavailableReason?: (typeof PROGRAM_EVIDENCE_UNAVAILABLE_REASONS)[keyof typeof PROGRAM_EVIDENCE_UNAVAILABLE_REASONS];
};

export type ProgramEvidenceSummary = {
  servicesScanned: ProgramEvidenceMetric;
  codeSymbolsIndexed: ProgramEvidenceMetric;
  aiProviderCallPaths: ProgramEvidenceMetric;
  evidenceMappedScope: ProgramEvidenceMetric;
};

export type ScannerActivityItem = {
  id: string;
  labelKey: string;
  runningLabelKey?: string;
  status: ToolActivityStatus;
};

export type GitProviderValue = AssessmentRepositoryProvider;
