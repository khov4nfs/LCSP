export const DOCUMENT_ERROR_CODES = {
  alreadyQueued: "DOCUMENT_ALREADY_QUEUED",
  assessmentNotFound: "ASSESSMENT_NOT_FOUND",
  classificationGuardrailNotPassed: "CLASSIFICATION_GUARDRAIL_NOT_PASSED",
  classificationRequired: "CLASSIFICATION_REQUIRED",
  documentNotFound: "DOCUMENT_NOT_FOUND",
  downloadUrlInvalid: "DOCUMENT_DOWNLOAD_URL_INVALID",
  finalReportRequiresAssessmentArtifact:
    "FINAL_REPORT_REQUIRES_ASSESSMENT_ARTIFACT",
} as const;
