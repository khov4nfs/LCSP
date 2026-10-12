export const GITHUB_INTEGRATION_EVENT_TYPES = {
  snapshotCreated: "event.repository-snapshot.created.v1",
  snapshotCreatedAudit: "SNAPSHOT_CREATED",
  snapshotPinFailedAudit: "SNAPSHOT_PIN_FAILED",
  cliRepositoryDiscoverySucceeded: "GITHUB_CLI_REPOSITORY_DISCOVERY_SUCCEEDED",
  cliRepositoryConnected: "GITHUB_CLI_REPOSITORY_CONNECTED",
} as const;
