export const SCAN_CALLBACK_STATUSES = {
  success: "SUCCESS",
  partial: "PARTIAL",
  failed: "FAILED",
} as const;

export type ScanCallbackStatus =
  (typeof SCAN_CALLBACK_STATUSES)[keyof typeof SCAN_CALLBACK_STATUSES];

export const TECHNICAL_EVIDENCE_REPORT_STATUSES = {
  accepted: "ACCEPTED",
  rejected: "REJECTED",
} as const;

export type TechnicalEvidenceReportStatus =
  (typeof TECHNICAL_EVIDENCE_REPORT_STATUSES)[keyof typeof TECHNICAL_EVIDENCE_REPORT_STATUSES];

export const TECHNICAL_PROFILE_STATUSES = {
  accepted: "ACCEPTED",
  rejected: "REJECTED",
} as const;

export type TechnicalProfileStatus =
  (typeof TECHNICAL_PROFILE_STATUSES)[keyof typeof TECHNICAL_PROFILE_STATUSES];

export const AI_USAGE_FLOW_STATUSES = {
  accepted: "ACCEPTED",
  rejected: "REJECTED",
} as const;

export type AIUsageFlowStatus =
  (typeof AI_USAGE_FLOW_STATUSES)[keyof typeof AI_USAGE_FLOW_STATUSES];

export const CONFLICT_RECORD_STATUSES = {
  pending: "PENDING",
  resolved: "RESOLVED",
  dismissed: "DISMISSED",
} as const;

export type ConflictRecordStatus =
  (typeof CONFLICT_RECORD_STATUSES)[keyof typeof CONFLICT_RECORD_STATUSES];

export const VERIFIED_PROFILE_STATUSES = {
  pendingApproval: "PENDING_APPROVAL",
  approved: "APPROVED",
  autoApproved: "AUTO_APPROVED",
} as const;

export type VerifiedProfileStatus =
  (typeof VERIFIED_PROFILE_STATUSES)[keyof typeof VERIFIED_PROFILE_STATUSES];

export const LEGAL_RULE_MATCH_STATUSES = {
  accepted: "ACCEPTED",
  rejected: "REJECTED",
} as const;

export type LegalRuleMatchStatus =
  (typeof LEGAL_RULE_MATCH_STATUSES)[keyof typeof LEGAL_RULE_MATCH_STATUSES];

export const LEGAL_RULE_MATCH_GUARDRAIL_STATUSES = {
  passed: "PASSED",
  blocked: "BLOCKED",
} as const;

export type LegalRuleMatchGuardrailStatus =
  (typeof LEGAL_RULE_MATCH_GUARDRAIL_STATUSES)[keyof typeof LEGAL_RULE_MATCH_GUARDRAIL_STATUSES];

export const CLASSIFICATION_RESULT_STATUSES = {
  accepted: "ACCEPTED",
  rejected: "REJECTED",
} as const;

export type ClassificationResultStatus =
  (typeof CLASSIFICATION_RESULT_STATUSES)[keyof typeof CLASSIFICATION_RESULT_STATUSES];

export const CLASSIFICATION_RERUN_STATUSES = {
  queued: "QUEUED",
} as const;

export type ClassificationRerunStatus =
  (typeof CLASSIFICATION_RERUN_STATUSES)[keyof typeof CLASSIFICATION_RERUN_STATUSES];

export const CLASSIFICATION_GUARDRAIL_STATUSES = {
  passed: "PASSED",
  degraded: "DEGRADED",
  blocked: "BLOCKED",
} as const;

export type ClassificationGuardrailStatus =
  (typeof CLASSIFICATION_GUARDRAIL_STATUSES)[keyof typeof CLASSIFICATION_GUARDRAIL_STATUSES];

export const OVERALL_COVERAGE_STATUSES = {
  noCitation: "NO_CITATION",
  partialCitation: "PARTIAL_CITATION",
  completeCitation: "COMPLETE_CITATION",
} as const;

export type OverallCoverageStatus =
  (typeof OVERALL_COVERAGE_STATUSES)[keyof typeof OVERALL_COVERAGE_STATUSES];

export const LEGAL_MATCH_TYPES = {
  primaryMatch: "PRIMARY_MATCH",
  parentContext: "PARENT_CONTEXT",
  referencedContext: "REFERENCED_CONTEXT",
} as const;

export type LegalMatchType =
  (typeof LEGAL_MATCH_TYPES)[keyof typeof LEGAL_MATCH_TYPES];

export const SCAN_EVIDENCE_SCHEMA_VERSIONS = ["1.0.0"] as const;
export const TECHNICAL_PROFILE_SCHEMA_VERSIONS = ["1.0.0"] as const;
export const AI_USAGE_FLOW_SCHEMA_VERSIONS = ["1.0.0"] as const;
export const CONFLICT_DETECTION_SCHEMA_VERSIONS = ["1.0.0"] as const;
export const VERIFIED_PROFILE_SCHEMA_VERSIONS = ["1.0.0"] as const;
export const LEGAL_RULE_MATCH_SCHEMA_VERSIONS = ["1.0.0"] as const;
export const CLASSIFICATION_RESULT_SCHEMA_VERSIONS = ["1.0.0"] as const;

export const SCAN_EVENT_TYPES = {
  evidenceAccepted: "event.technical-evidence.accepted.v1",
  technicalProfileReady: "event.technical-profile.ready.v1",
  aiUsageFlowReady: "event.ai-usage-flow.ready.v1",
  reconciliationConflictsDetected: "event.reconciliation.conflicts-detected.v1",
  reconciliationNoConflicts: "event.reconciliation.no-conflicts.v1",
  reconciliationAllConflictsResolved:
    "event.reconciliation.all-conflicts-resolved.v1",
  verifiedProfileReady: "event.verified-profile.ready.v1",
  legalRuleMatchReady: "event.legal-rule-match.ready.v1",
  classificationResultReady: "event.classification-result.ready.v1",
  evidenceAcceptedAudit: "SCAN_EVIDENCE_ACCEPTED",
  evidenceRejectedAudit: "SCAN_EVIDENCE_REJECTED",
  technicalProfileAcceptedAudit: "TECHNICAL_PROFILE_ACCEPTED",
  aiUsageFlowAcceptedAudit: "AI_USAGE_FLOW_ACCEPTED",
  conflictDetectedAudit: "CONFLICT_DETECTED",
  conflictResolvedAudit: "CONFLICT_RESOLVED",
  conflictDismissedAudit: "CONFLICT_DISMISSED",
  noConflictsDetectedAudit: "NO_CONFLICTS_DETECTED",
  verifiedProfileAcceptedAudit: "VERIFIED_PROFILE_ACCEPTED",
  verifiedProfileApprovedAudit: "VERIFIED_PROFILE_APPROVED",
  legalRuleMatchAcceptedAudit: "LEGAL_RULE_MATCH_ACCEPTED",
  legalRuleMatchBlockedAudit: "LEGAL_RULE_MATCH_BLOCKED",
  classificationAcceptedAudit: "CLASSIFICATION_ACCEPTED",
  classificationBlockedAudit: "CLASSIFICATION_BLOCKED",
  classificationRerunTriggeredAudit: "CLASSIFICATION_RERUN_TRIGGERED",
  scanRerunTriggeredAudit: "SCAN_RERUN_TRIGGERED",
  targetedReanalysisQueuedAudit: "TARGETED_REANALYSIS_QUEUED",
  targetedReanalysisRunningAudit: "TARGETED_REANALYSIS_RUNNING",
  targetedReanalysisRetryAudit: "TARGETED_REANALYSIS_RETRY_SCHEDULED",
  targetedReanalysisTerminalAudit: "TARGETED_REANALYSIS_TERMINAL",
} as const;
