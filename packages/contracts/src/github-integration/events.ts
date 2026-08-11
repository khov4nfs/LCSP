export const GITHUB_INTEGRATION_EVENT_TYPES = {
  appInstallStarted: "GITHUB_APP_INSTALL_STARTED",
  appConnected: "GITHUB_APP_CONNECTED",
  appConnectionRejected: "GITHUB_APP_CONNECTION_REJECTED",
  snapshotCreated: "event.repository-snapshot.created.v1",
  snapshotCreatedAudit: "SNAPSHOT_CREATED",
  snapshotPinFailedAudit: "SNAPSHOT_PIN_FAILED",
  scanTriggered: "command.scan.requested.v1",
  targetedReanalysisRequested: "command.scan.targeted-reanalysis.v1",
  scanJobTriggeredAudit: "SCAN_JOB_TRIGGERED",
  scanTriggerRejectedAudit: "SCAN_TRIGGER_REJECTED",
  scanTriggerDuplicateAudit: "SCAN_TRIGGER_DUPLICATE",
} as const;
