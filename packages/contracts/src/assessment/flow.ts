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

export const ASSESSMENT_REPOSITORY_RELATION_TYPES = {
  runtimeApiInteraction: "RUNTIME_API_INTERACTION",
  buildPackageDependency: "BUILD_PACKAGE_DEPENDENCY",
  dataEventFlow: "DATA_EVENT_FLOW",
  sharedLibrary: "SHARED_LIBRARY",
} as const;

export type AssessmentRepositoryRelationType =
  (typeof ASSESSMENT_REPOSITORY_RELATION_TYPES)[keyof typeof ASSESSMENT_REPOSITORY_RELATION_TYPES];

export const ASSESSMENT_SETUP_CONFIRMATION_STATUSES = {
  draft: "DRAFT",
  confirmed: "CONFIRMED",
} as const;

export type AssessmentSetupConfirmationStatus =
  (typeof ASSESSMENT_SETUP_CONFIRMATION_STATUSES)[keyof typeof ASSESSMENT_SETUP_CONFIRMATION_STATUSES];

export const ASSESSMENT_GRAPH_STATES = {
  notReady: "NOT_READY",
  ready: "READY",
} as const;

export type AssessmentGraphState =
  (typeof ASSESSMENT_GRAPH_STATES)[keyof typeof ASSESSMENT_GRAPH_STATES];
