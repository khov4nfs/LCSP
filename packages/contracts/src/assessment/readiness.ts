export const ASSESSMENT_LOCK_REASONS = {
  evidenceRequired: "LOCKED_EVIDENCE_REQUIRED",
  legalReadinessRequired: "LOCKED_LEGAL_READINESS_REQUIRED",
} as const;

export const ASSESSMENT_MISSING_EVIDENCE_CODES = {
  technicalEvidenceReport: "technical_evidence_report",
  legalCorpusVersion: "LEGAL_CORPUS_VERSION",
  legalRetrievalIndex: "LEGAL_RETRIEVAL_INDEX",
  legalRuleCatalogVersion: "LEGAL_RULE_CATALOG_VERSION",
} as const;

export const ASSESSMENT_NEXT_ACTION_KEYS = {
  workflowRun: "pages.workspace.nextActions.workflowRun",
} as const;

export const READINESS_MODES = {
  selfDeclared: "SELF_DECLARED_READINESS",
} as const;

export type AssessmentLockReason =
  (typeof ASSESSMENT_LOCK_REASONS)[keyof typeof ASSESSMENT_LOCK_REASONS];

export type AssessmentMissingEvidenceCode =
  (typeof ASSESSMENT_MISSING_EVIDENCE_CODES)[keyof typeof ASSESSMENT_MISSING_EVIDENCE_CODES];

export type AssessmentNextActionKey =
  (typeof ASSESSMENT_NEXT_ACTION_KEYS)[keyof typeof ASSESSMENT_NEXT_ACTION_KEYS];

export type ReadinessMode =
  (typeof READINESS_MODES)[keyof typeof READINESS_MODES];
