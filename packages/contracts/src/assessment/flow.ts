export const ASSESSMENT_FLOW_STAGES = {
  repositorySetup: "REPOSITORY_SETUP",
  scanner: "SCANNER",
  interview: "INTERVIEW",
} as const;

export type AssessmentFlowStage =
  (typeof ASSESSMENT_FLOW_STAGES)[keyof typeof ASSESSMENT_FLOW_STAGES];

export const ASSESSMENT_REPOSITORY_PROVIDERS = {
  github: "GITHUB",
  gitlab: "GITLAB",
  bitbucket: "BITBUCKET",
  azureDevOps: "AZURE_DEVOPS",
} as const;

export type AssessmentRepositoryProvider =
  (typeof ASSESSMENT_REPOSITORY_PROVIDERS)[keyof typeof ASSESSMENT_REPOSITORY_PROVIDERS];
