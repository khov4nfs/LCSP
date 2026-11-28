import {
  ASSESSMENT_DISCOVERY_RUN_STATUSES,
  type AssessmentDiscoveryRunView,
} from "@lcsp/contracts/assessment-domain";

/**
 * Business purpose: Tell whether any repository of the latest discovery batch is still being scanned, so the
 * customer cannot start another scan or choose rules from a half-finished picture.
 * Business rules:
 * - A batch is busy while at least one of its repository runs is queued or running.
 * - An empty batch is not busy; an absent discovery is an explicit empty state, never a running scan.
 * Execution flow:
 * 1. Check every run's status against the active statuses.
 * Failure cases:
 * - None; pure projection.
 * Side effects:
 * - None; pure calculation.
 */
export function discoveryBatchIsActive(
  runs: readonly Pick<AssessmentDiscoveryRunView, "status">[],
): boolean {
  return runs.some(
    (run) =>
      run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.queued ||
      run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.running,
  );
}

/**
 * Business purpose: Choose which repository's discovery results the customer is looking at.
 * Business rules:
 * - A repository the customer picked wins while it is still part of the batch.
 * - Otherwise the batch's primary run (the first) is shown, which is also the only run of a single repository.
 * Execution flow:
 * 1. Look for the picked repository key among the runs.
 * 2. Fall back to the first run.
 * Failure cases:
 * - Returns null for an empty batch.
 * Side effects:
 * - None; pure selection.
 */
export function selectDiscoveryRun<
  T extends Pick<AssessmentDiscoveryRunView, "repositoryKey">,
>(runs: readonly T[], pickedKey: string | null): T | null {
  return (
    (pickedKey
      ? runs.find((run) => run.repositoryKey === pickedKey)
      : undefined) ??
    runs[0] ??
    null
  );
}

/**
 * Business purpose: Decide whether the batch needs a retry because a repository scan failed.
 * Business rules:
 * - One failed repository makes the whole discovery incomplete; a retry starts a new batch for every repository.
 * Execution flow:
 * 1. Look for a failed run.
 * Failure cases:
 * - None; pure projection.
 * Side effects:
 * - None; pure calculation.
 */
export function discoveryBatchHasFailure(
  runs: readonly Pick<AssessmentDiscoveryRunView, "status">[],
): boolean {
  return runs.some(
    (run) => run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.failed,
  );
}
