export const SCAN_JOB_GUIDANCE = {
  queuedNextAction: "No action is needed while the scan is waiting to start.",
  runningNextAction: "No action is needed while the scan is in progress.",
  waitingForCreditsNextAction: "Add funds, then continue the paused assessment.",
  failedNextAction:
    "Start the scan again. Contact support if the problem continues.",
  blockedNextAction: "Complete the required setup, then start the scan again.",
  blockedReason:
    "The scan cannot continue until the required setup is complete.",
  pendingMappingNextAction:
    "Connect the required repository details, then start the scan again.",
  pendingMappingReason:
    "LCSP needs the repository mapping details before the scan can start.",
  blockedMappingNextAction:
    "Resolve the repository mapping issue, then start the scan again.",
  blockedMappingReason:
    "LCSP could not safely match the repository context for this scan.",
  waitingForContextNextAction:
    "Wait for the remaining repository context, then retry the scan.",
  waitingForContextReason:
    "LCSP is waiting for the remaining repository context before the scan can start.",
  readyToSnapshotNextAction:
    "Start the scan again to create the pinned snapshot and continue.",
  readyToSnapshotReason:
    "The repository context is ready for snapshot creation.",
} as const;
