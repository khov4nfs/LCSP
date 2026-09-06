export const ASSESSMENT_ERROR_CODES = {
  invalidRequest: "INVALID_REQUEST",
  notFound: "ASSESSMENT_NOT_FOUND",
  repositorySetupIncomplete: "ASSESSMENT_REPOSITORY_SETUP_INCOMPLETE",
  repositorySetupStateInvalid: "ASSESSMENT_REPOSITORY_SETUP_STATE_INVALID",
  interviewTechnicalCoverageUnusable: "INTERVIEW_TECHNICAL_COVERAGE_UNUSABLE",
  interviewPartialCoverageLimitationsRequired:
    "INTERVIEW_PARTIAL_COVERAGE_LIMITATIONS_REQUIRED",
} as const;
