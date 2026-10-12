export const ASSESSMENT_FIELD_LIMITS = {
  nameMaxLength: 200,
  descriptionMaxLength: 1000,
} as const;

export const ASSESSMENT_NAME_MAX_LENGTH = ASSESSMENT_FIELD_LIMITS.nameMaxLength;
export const ASSESSMENT_DESCRIPTION_MAX_LENGTH =
  ASSESSMENT_FIELD_LIMITS.descriptionMaxLength;

export const ASSESSMENT_REPOSITORY_PROVIDERS = {
  github: "GITHUB",
  gitlab: "GITLAB",
  bitbucket: "BITBUCKET",
  azureDevOps: "AZURE_DEVOPS",
} as const;
export type AssessmentRepositoryProvider =
  (typeof ASSESSMENT_REPOSITORY_PROVIDERS)[keyof typeof ASSESSMENT_REPOSITORY_PROVIDERS];
