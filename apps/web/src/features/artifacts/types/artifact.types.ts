import type { AssessmentStatus } from "@/features/workspace/types/workspace.types";

export const ARTIFACT_TYPES = {
  businessContext: "BUSINESS_CONTEXT",
  programEvidenceGraph: "PROGRAM_EVIDENCE_GRAPH",
  evidenceGraph: "EVIDENCE_GRAPH",
  findingsReport: "FINDINGS_REPORT",
  remediationPatch: "REMEDIATION_PATCH",
  finalReport: "FINAL_REPORT",
  verificationReport: "VERIFICATION_REPORT",
  investigationNotes: "INVESTIGATION_NOTES",
  technicalEvidence: "TECHNICAL_EVIDENCE",
  repositorySnapshot: "REPOSITORY_SNAPSHOT",
  scanJob: "SCAN_JOB",
  gapAnalysis: "GAP_ANALYSIS",
  readinessExport: "READINESS_EXPORT",
} as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[keyof typeof ARTIFACT_TYPES];

export const ARTIFACT_STATUSES = {
  ready: "READY",
  waiting: "WAITING",
  updating: "UPDATING",
  paused: "PAUSED",
  unavailable: "UNAVAILABLE",
} as const;

export type ArtifactStatus =
  (typeof ARTIFACT_STATUSES)[keyof typeof ARTIFACT_STATUSES];

export type ArtifactRef = {
  assessmentId: string;
  type: ArtifactType;
  resourceId?: string;
};

export type ArtifactListItemModel = {
  ref: ArtifactRef;
  title: string;
  context?: string;
  status: ArtifactStatus;
};

export type ArtifactGroup = {
  assessmentId: string;
  title: string;
  context?: string;
  updatedAt?: string;
  artifacts: ArtifactListItemModel[];
};

export const ARTIFACT_TABS = {
  all: "ALL",
  yours: "YOURS",
  sharedWithYou: "SHARED_WITH_YOU",
} as const;

export type ArtifactTab = (typeof ARTIFACT_TABS)[keyof typeof ARTIFACT_TABS];

export type ArtifactAssessmentSummary = {
  id: string;
  name: string;
  status: AssessmentStatus;
  created_at: string;
};
