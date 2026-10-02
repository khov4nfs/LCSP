export const GITHUB_INTEGRATION_EVENT_TYPES = {
  snapshotCreated: "event.repository-snapshot.created.v1",
  snapshotCreatedAudit: "SNAPSHOT_CREATED",
  snapshotPinFailedAudit: "SNAPSHOT_PIN_FAILED",
  scanTriggered: "command.scan.requested.v1",
  targetedReanalysisRequested: "command.scan.targeted-reanalysis.v1",
  scanJobTriggeredAudit: "SCAN_JOB_TRIGGERED",
  scanTriggerRejectedAudit: "SCAN_TRIGGER_REJECTED",
  scanTriggerDuplicateAudit: "SCAN_TRIGGER_DUPLICATE",
  cliRepositoryDiscoverySucceeded: "GITHUB_CLI_REPOSITORY_DISCOVERY_SUCCEEDED",
  cliRepositoryConnected: "GITHUB_CLI_REPOSITORY_CONNECTED",
} as const;
