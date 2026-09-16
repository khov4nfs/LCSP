export const ASSESSMENT_ARTIFACT_TYPES = {
  businessContext: "BUSINESS_CONTEXT",
  investigationNotes: "INVESTIGATION_NOTES",
} as const;

export type AssessmentArtifactType =
  (typeof ASSESSMENT_ARTIFACT_TYPES)[keyof typeof ASSESSMENT_ARTIFACT_TYPES];

export const ASSESSMENT_ARTIFACT_STATUSES = {
  notAvailable: "NOT_AVAILABLE",
  pending: "PENDING",
  ready: "READY",
  failed: "FAILED",
} as const;

export type AssessmentArtifactStatus =
  (typeof ASSESSMENT_ARTIFACT_STATUSES)[keyof typeof ASSESSMENT_ARTIFACT_STATUSES];

export const BUSINESS_CONTEXT_DIMENSION_STATUSES = {
  confirmed: "CONFIRMED",
  unknown: "UNKNOWN",
} as const;

export type BusinessContextDimensionStatus =
  (typeof BUSINESS_CONTEXT_DIMENSION_STATUSES)[keyof typeof BUSINESS_CONTEXT_DIMENSION_STATUSES];

export const BUSINESS_CONTEXT_DIMENSIONS = {
  aiUsage: "AI_USAGE",
  operationalProcess: "OPERATIONAL_PROCESS",
  decisionInfluence: "DECISION_INFLUENCE",
  humanOversight: "HUMAN_OVERSIGHT",
  affectedSubjects: "AFFECTED_SUBJECTS",
  dataCategories: "DATA_CATEGORIES",
} as const;

export type BusinessContextDimension =
  (typeof BUSINESS_CONTEXT_DIMENSIONS)[keyof typeof BUSINESS_CONTEXT_DIMENSIONS];

export type BusinessContextArtifactStatement = {
  statement: string;
  topic: string;
  normalizedValue?: unknown;
  scope: string;
  evidenceRefs: string[];
  confirmedAt: string;
};

export type BusinessContextArtifactDimension = {
  dimension: BusinessContextDimension;
  status: BusinessContextDimensionStatus;
};

export type BusinessContextArtifactContent = {
  dimensions: BusinessContextArtifactDimension[];
  confirmedStatements: BusinessContextArtifactStatement[];
  unknownDimensions: BusinessContextDimension[];
};

export type BusinessContextArtifact = {
  type: typeof ASSESSMENT_ARTIFACT_TYPES.businessContext;
  status: AssessmentArtifactStatus;
  identity: {
    assessmentId: string;
    contextRevision: number | null;
    sourceVersion: string | null;
    pgeVersion: string | null;
  };
  generatedAt: string | null;
  updatedAt: string | null;
  content: BusinessContextArtifactContent | null;
};

export const INVESTIGATION_EXECUTION_STATUSES = {
  inProgress: "IN_PROGRESS",
  completed: "COMPLETED",
  interrupted: "INTERRUPTED",
} as const;

export type InvestigationExecutionStatus =
  (typeof INVESTIGATION_EXECUTION_STATUSES)[keyof typeof INVESTIGATION_EXECUTION_STATUSES];

export const INVESTIGATION_ASSESSMENT_OUTCOMES = {
  compliant: "COMPLIANT",
  nonCompliant: "NON_COMPLIANT",
  unknown: "UNKNOWN",
} as const;

export type InvestigationAssessmentOutcome =
  (typeof INVESTIGATION_ASSESSMENT_OUTCOMES)[keyof typeof INVESTIGATION_ASSESSMENT_OUTCOMES];

export const INVESTIGATION_EVIDENCE_QUALITIES = {
  evidenceBacked: "EVIDENCE_BACKED",
  insufficientEvidence: "INSUFFICIENT_EVIDENCE",
} as const;

export type InvestigationEvidenceQuality =
  (typeof INVESTIGATION_EVIDENCE_QUALITIES)[keyof typeof INVESTIGATION_EVIDENCE_QUALITIES];

export const INVESTIGATION_RULE_OUTCOMES = {
  requirementMet: "REQUIREMENT_MET",
  requirementNotMet: "REQUIREMENT_NOT_MET",
  unresolved: "UNRESOLVED",
  runtimeError: "RUNTIME_ERROR",
  waitingForContext: "WAITING_FOR_CONTEXT",
  pending: "PENDING",
  notApplicable: "NOT_APPLICABLE",
} as const;

export type InvestigationRuleOutcome =
  (typeof INVESTIGATION_RULE_OUTCOMES)[keyof typeof INVESTIGATION_RULE_OUTCOMES];

export type InvestigationRuleNote = {
  key: string;
  title: string | null;
  outcome: InvestigationRuleOutcome;
  findingSummary: string | null;
  evidenceRefs: string[];
  sourceAnchors: string[];
  limitations: string[];
  customerContextRequested: boolean;
  customerContextResolved: boolean;
  runtimeFailureCode: string | null;
};

export type InvestigationNotesArtifactContent = {
  summary: {
    candidateRules: number;
    selectedRules: number;
    investigatedRules: number;
    pendingRules: number;
    waitingRules: number;
    domainLimitedRules: number;
    runtimeFailedRules: number;
  };
  executionStatus: InvestigationExecutionStatus;
  assessmentOutcome: InvestigationAssessmentOutcome;
  evidenceQuality: InvestigationEvidenceQuality;
  rules: InvestigationRuleNote[];
  limitations: string[];
};

export type InvestigationNotesArtifact = {
  type: typeof ASSESSMENT_ARTIFACT_TYPES.investigationNotes;
  status: AssessmentArtifactStatus;
  identity: {
    assessmentId: string;
    workflowRunId: string | null;
    planningBatchId: string | null;
    contextRevisionUsed: number | null;
    technicalEvidenceReportId: string | null;
    snapshotId: string | null;
  };
  generatedAt: string | null;
  updatedAt: string | null;
  content: InvestigationNotesArtifactContent | null;
};

export type AssessmentArtifactAvailabilityProjection = {
  businessContext: Pick<
    BusinessContextArtifact,
    "type" | "status" | "identity" | "generatedAt" | "updatedAt"
  >;
  investigationNotes: Pick<
    InvestigationNotesArtifact,
    "type" | "status" | "identity" | "generatedAt" | "updatedAt"
  >;
};
