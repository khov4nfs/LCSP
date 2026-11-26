/** Validation issue codes of the repository setup form; the UI maps each to an i18n message key. */
export const REPOSITORY_SETUP_ISSUES = {
  providerNotSupported: "provider-not-supported",
  repositoryUrlInvalid: "repository-url-invalid",
  duplicateRepository: "repository-duplicate",
  limitReached: "repository-limit-reached",
} as const;

export type RepositorySetupIssue =
  (typeof REPOSITORY_SETUP_ISSUES)[keyof typeof REPOSITORY_SETUP_ISSUES];

/** i18n key shown for each issue code. */
export const REPOSITORY_SETUP_ISSUE_MESSAGE_KEYS = {
  [REPOSITORY_SETUP_ISSUES.providerNotSupported]:
    "pages.assessmentFlow.errors.repositoryUrl",
  [REPOSITORY_SETUP_ISSUES.repositoryUrlInvalid]:
    "pages.assessmentFlow.errors.repositoryUrl",
  [REPOSITORY_SETUP_ISSUES.duplicateRepository]:
    "pages.assessmentFlow.errors.duplicateRepository",
  [REPOSITORY_SETUP_ISSUES.limitReached]:
    "pages.assessmentFlow.errors.repositoryLimit",
} as const;
