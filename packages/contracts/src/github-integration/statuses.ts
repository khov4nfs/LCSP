export const REPOSITORY_CONNECTION_STATUSES = {
  active: "ACTIVE",
  revoked: "REVOKED",
} as const;

export const GITHUB_REPOSITORY_PERMISSION_LEVELS = {
  read: "READ",
} as const;

export type RepositoryConnectionStatus =
  (typeof REPOSITORY_CONNECTION_STATUSES)[keyof typeof REPOSITORY_CONNECTION_STATUSES];

export const CREDENTIAL_PROVIDERS = {
  github: "GITHUB",
  gitlab: "GITLAB",
  bitbucket: "BITBUCKET",
  azureDevOps: "AZURE_DEVOPS",
} as const;

export type CredentialProvider =
  (typeof CREDENTIAL_PROVIDERS)[keyof typeof CREDENTIAL_PROVIDERS];

export const PROVIDER_CREDENTIAL_STATUSES = {
  pending: "PENDING",
  active: "ACTIVE",
  invalid: "INVALID",
  expired: "EXPIRED",
  revoking: "REVOKING",
  revoked: "REVOKED",
  storageError: "STORAGE_ERROR",
} as const;

export type ProviderCredentialStatus =
  (typeof PROVIDER_CREDENTIAL_STATUSES)[keyof typeof PROVIDER_CREDENTIAL_STATUSES];

export const CREDENTIAL_AUTHORIZATION_STATUSES = {
  active: "ACTIVE",
  revoking: "REVOKING",
  revoked: "REVOKED",
} as const;

export type CredentialAuthorizationStatus =
  (typeof CREDENTIAL_AUTHORIZATION_STATUSES)[keyof typeof CREDENTIAL_AUTHORIZATION_STATUSES];

export const REPOSITORY_AUTHENTICATION_MODES = {
  githubApp: "GITHUB_APP",
  githubCliCredential: "GITHUB_CLI_CREDENTIAL",
  gitlabCliCredential: "GITLAB_CLI_CREDENTIAL",
  bitbucketCliCredential: "BITBUCKET_CLI_CREDENTIAL",
  azureDevOpsCliCredential: "AZURE_DEVOPS_CLI_CREDENTIAL",
} as const;

export type RepositoryAuthenticationMode =
  (typeof REPOSITORY_AUTHENTICATION_MODES)[keyof typeof REPOSITORY_AUTHENTICATION_MODES];

export const GITHUB_CREDENTIAL_OPERATIONS = {
  connect: "CONNECT",
  validate: "VALIDATE",
  discoverRepositories: "DISCOVER_REPOSITORIES",
  pinSnapshot: "PIN_SNAPSHOT",
  retrieveArchive: "RETRIEVE_ARCHIVE",
  rotate: "ROTATE",
  revoke: "REVOKE",
} as const;

export type GitHubCredentialOperation =
  (typeof GITHUB_CREDENTIAL_OPERATIONS)[keyof typeof GITHUB_CREDENTIAL_OPERATIONS];

export const GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES = {
  unverified: "UNVERIFIED",
  verified: "VERIFIED",
} as const;

export type GitHubArchiveRedirectValidationStatus =
  (typeof GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES)[keyof typeof GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES];

export const REPOSITORY_SNAPSHOT_STATUSES = {
  ready: "READY",
} as const;

export type RepositorySnapshotStatus =
  (typeof REPOSITORY_SNAPSHOT_STATUSES)[keyof typeof REPOSITORY_SNAPSHOT_STATUSES];

export const REPOSITORY_SCAN_JOB_STATUSES = {
  queued: "QUEUED",
  running: "RUNNING",
  completed: "COMPLETED",
  failed: "FAILED",
  blocked: "BLOCKED",
  pendingMapping: "PENDING_MAPPING",
  blockedMapping: "BLOCKED_MAPPING",
  waitingForContext: "WAITING_FOR_CONTEXT",
  readyToSnapshot: "READY_TO_SNAPSHOT",
} as const;

export type RepositoryScanJobStatus =
  (typeof REPOSITORY_SCAN_JOB_STATUSES)[keyof typeof REPOSITORY_SCAN_JOB_STATUSES];

export const REPOSITORY_SCAN_TRIGGER_SOURCES = {
  manual: "MANUAL",
  trusted: "TRUSTED",
} as const;

export type RepositoryScanTriggerSource =
  (typeof REPOSITORY_SCAN_TRIGGER_SOURCES)[keyof typeof REPOSITORY_SCAN_TRIGGER_SOURCES];
