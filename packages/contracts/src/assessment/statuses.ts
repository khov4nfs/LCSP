export const ASSESSMENT_STATUS_CODES = {
  wizardInProgress: "WIZARD_IN_PROGRESS",
  wizardSubmitted: "WIZARD_SUBMITTED",
  evidenceRequired: "EVIDENCE_REQUIRED",
  scanInProgress: "SCAN_IN_PROGRESS",
  classificationLocked: "CLASSIFICATION_LOCKED",
  readyForReview: "READY_FOR_REVIEW",
  /** Terminal: governed technical evidence proves the repository does not use AI. */
  aiNotDetected: "AI_NOT_DETECTED",
} as const;
