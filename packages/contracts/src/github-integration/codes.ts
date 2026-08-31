export const GITHUB_INTEGRATION_ERROR_CODES = {
  connectionNotFound: "CONNECTION_NOT_FOUND",
  invalidRedirectUri: "INVALID_REDIRECT_URI",
  githubStateInvalid: "GITHUB_STATE_INVALID",
  githubCallbackInvalid: "GITHUB_CALLBACK_INVALID",
  permissionsInsufficient: "PERMISSIONS_INSUFFICIENT",
  refNotResolvable: "REF_NOT_RESOLVABLE",
  refOutOfScope: "REF_OUT_OF_SCOPE",
  snapshotScanMismatch: "SNAPSHOT_SCAN_MISMATCH",
  snapshotNotFound: "SNAPSHOT_NOT_FOUND",
  snapshotRetrievalFailed: "SNAPSHOT_RETRIEVAL_FAILED",
  assessmentStateInvalid: "ASSESSMENT_STATE_INVALID",
  scanBlockedMapping: "SCAN_BLOCKED_MAPPING",
  scanIdempotencyConflict: "IDEMPOTENCY_CONFLICT",
  scanIdempotencyKeyRequired: "IDEMPOTENCY_KEY_REQUIRED",
  scanTriggerSourceInvalid: "SCAN_TRIGGER_SOURCE_INVALID",
  cliConnectDisabled: "GITHUB_CLI_CONNECT_DISABLED",
  connectionAlreadyExists: "REPOSITORY_CONNECTION_ALREADY_EXISTS",
  credentialRequestInvalid: "GITHUB_CREDENTIAL_REQUEST_INVALID",
  cliSnapshotPinningDisabled: "GITHUB_CLI_SNAPSHOT_PINNING_DISABLED",
  cliArchiveRetrievalDisabled: "GITHUB_CLI_ARCHIVE_RETRIEVAL_DISABLED",
} as const;

/** Safe categories emitted by credential and GitHub CLI infrastructure. */
export const GITHUB_CREDENTIAL_ERROR_CODES = {
  credentialRequired: "PROVIDER_CREDENTIAL_REQUIRED",
  credentialInvalid: "CREDENTIAL_INVALID",
  credentialExpired: "CREDENTIAL_EXPIRED",
  repositoryAccessDenied: "REPOSITORY_ACCESS_DENIED",
  repositoryUnavailable: "REPOSITORY_UNAVAILABLE",
  credentialApprovalRequired: "CREDENTIAL_APPROVAL_REQUIRED",
  providerRateLimited: "PROVIDER_RATE_LIMITED",
  providerTimeout: "PROVIDER_TIMEOUT",
  operationCancelled: "OPERATION_CANCELLED",
  providerClientUnavailable: "PROVIDER_CLIENT_UNAVAILABLE",
  providerResponseInvalid: "PROVIDER_RESPONSE_INVALID",
} as const;

/** Safe failures specific to the hardened GitHub archive HTTP transport. */
export const GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES = {
  redirectValidationFailed: "ARCHIVE_REDIRECT_VALIDATION_FAILED",
  tooManyRedirects: "ARCHIVE_TOO_MANY_REDIRECTS",
  archiveTooLarge: "ARCHIVE_TOO_LARGE",
} as const;
