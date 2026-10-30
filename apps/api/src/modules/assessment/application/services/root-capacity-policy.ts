import {
  ROOT_CAPACITY_REASONS as Reasons,
  type RootCapacityDatabaseMetrics,
  type RootCapacityPolicy,
  type RootCapacityReason,
  type RootCapacityRuntimeMetrics,
} from "@lcsp/contracts/assessment-domain";

export interface CapacityControlState {
  desired: number;
  effective: number;
  healthySamples: number;
  idleSamples: number;
  lastScaleUpAt: Date | null;
  lastScaleDownAt: Date | null;
}
export interface CapacityDecision extends CapacityControlState {
  reason: RootCapacityReason;
}

/**
 * Business purpose: Choose safe new Root admission capacity without terminating admitted work.
 * Business rules:
 * - Unknown/stale core measurements suspend admission; all overrides obey resource/physical ceilings.
 * - Provider limits must be explicit before expansion above the conservative initial envelope.
 * - Safety reduction may cross the normal minimum; ordinary changes need consecutive samples and cooldown.
 * Execution flow:
 * 1. Validate freshness/consistency and derive the limiting resource ceiling.
 * 2. Apply emergency, drain and manual controls within that ceiling.
 * 3. Apply bounded demand changes with hysteresis and directional cooldowns.
 * Failure cases:
 * - Missing or inconsistent measurements produce zero effective slots, never invented healthy values.
 * Side effects:
 * - Pure calculation; active physical reservations are neither cancelled nor released.
 */
export function decideRootCapacity(
  policy: RootCapacityPolicy,
  state: CapacityControlState,
  runtime: RootCapacityRuntimeMetrics | null,
  database: RootCapacityDatabaseMetrics,
  now: Date,
): CapacityDecision {
  let ceiling = policy.maximum;
  let reason: RootCapacityReason = Reasons.physical;
  /**
   * Business purpose: Measure elapsed controller cooldown time.
   * Business rules:
   * - A never-scaled direction has no cooldown debt.
   * Execution flow:
   * 1. Compare the persisted timestamp to this evaluation's clock.
   * Failure cases:
   * - Missing timestamps return infinity so initial recovery can progress.
   * Side effects:
   * - Pure time calculation.
   */
  const secondsSince = (date: Date | null) =>
    date ? (now.getTime() - date.getTime()) / 1000 : Infinity;
  /**
   * Business purpose: Reject stale or future operational measurements.
   * Business rules:
   * - Five seconds of clock skew is tolerated; the configured TTL is an upper bound.
   * Execution flow:
   * 1. Compare the observation timestamp with the evaluation clock and TTL.
   * Failure cases:
   * - Missing or invalid timestamps cannot be fresh.
   * Side effects:
   * - Pure freshness predicate.
   */
  const fresh = (date: string | null) =>
    date !== null &&
    now.getTime() - Date.parse(date) >= -5000 &&
    secondsSince(new Date(date)) <= policy.metricTtlSeconds;
  /**
   * Business purpose: Keep the tightest measured resource ceiling and its explanation.
   * Business rules:
   * - Limits can only decrease the authorized ceiling; negative capacity becomes zero.
   * Execution flow:
   * 1. Apply a lower rounded capacity and record the bottleneck.
   * Failure cases:
   * - Larger limits grant no additional capacity.
   * Side effects:
   * - Updates only this pure evaluation's local ceiling/reason.
   */
  const limit = (value: number, cause: RootCapacityReason) => {
    if (value < ceiling) {
      ceiling = Math.max(0, Math.floor(value));
      reason = cause;
    }
  };
  if (
    !runtime ||
    !runtime.cgroupObserved ||
    !fresh(runtime.sampledAt) ||
    !fresh(database.sampledAt) ||
    !fresh(runtime.checkpointObservedAt) ||
    [
      runtime.cpuPressure,
      runtime.memoryAvailableBytes,
      runtime.diskAvailableBytes,
      runtime.diskPressure,
      runtime.sandboxMemoryBytes,
      runtime.largestSandboxMemoryBytes,
      runtime.sandboxCpuCores,
      runtime.activeSandboxes,
      runtime.processRssBytes,
      runtime.checkpointLatencyMs,
      runtime.checkpointFailureRate,
      runtime.provider429Count,
      runtime.budgetDenialCount,
    ].some((v) => v === null)
  ) {
    ceiling = 0;
    reason = Reasons.stale;
  } else if (
    runtime.reservedRootRuns !== database.activeReservations ||
    runtime.activeNativeRoots > runtime.reservedRootRuns ||
    runtime.activeNativeRuns > runtime.serverSlots ||
    database.dbConnectionRatio < 0 ||
    database.dbConnectionRatio > 1 ||
    runtime.cpuPressure! > 1 ||
    runtime.diskPressure! > 1
  ) {
    ceiling = 0;
    reason = Reasons.inconsistent;
  } else {
    const unrelatedRuns = Math.max(
      0,
      runtime.activeNativeRuns - runtime.activeNativeRoots,
    );
    limit(
      Math.min(
        runtime.workerSlots,
        runtime.serverSlots -
          unrelatedRuns -
          (runtime.brokerOtherReady !== null &&
          runtime.brokerOtherReady > 0 &&
          unrelatedRuns === 0
            ? 1
            : 0),
      ),
      Reasons.physical,
    );
    const memoryAvailable = Math.min(
      runtime.memoryAvailableBytes!,
      runtime.cgroupMemoryAvailableBytes ?? Infinity,
    );
    const perRoot = Math.max(
      policy.rootMemoryReserveBytes,
      runtime.largestSandboxMemoryBytes!,
    );
    // Credit only measured memory of currently reserved Root sandboxes. Unstarted
    // reservations and shared Python RSS never become invented free headroom.
    limit(
      Math.floor(
        (memoryAvailable -
          policy.memoryHeadroomBytes +
          (database.activeSandboxMemoryBytes ?? 0)) /
          perRoot,
      ),
      Reasons.memory,
    );
    if (memoryAvailable < policy.memoryHeadroomBytes) limit(0, Reasons.memory);
    if (
      runtime.diskAvailableBytes! < policy.diskHeadroomBytes ||
      runtime.diskPressure! >= policy.diskPressureLimit
    )
      limit(0, Reasons.disk);
    if (runtime.cpuPressure! >= policy.cpuPressureLimit)
      limit(Math.max(0, state.effective - policy.scaleDownStep), Reasons.cpu);
    if (
      database.dbConnectionRatio >= policy.dbConnectionLimitRatio ||
      database.dbLatencyMs >= policy.checkpointLatencyLimitMs
    )
      limit(0, Reasons.database);
    limit(
      Math.floor(
        (database.dbMaxConnections * policy.dbConnectionLimitRatio -
          database.dbUsedConnections +
          database.dbRootConnections) /
          policy.rootDatabaseConnectionsReserve,
      ),
      Reasons.database,
    );
    if (
      runtime.checkpointLatencyMs! >= policy.checkpointLatencyLimitMs ||
      runtime.checkpointFailureRate! > 0
    )
      limit(0, Reasons.checkpoint);
    if (runtime.provider429Count! > 0)
      limit(
        Math.max(0, state.effective - policy.scaleDownStep),
        Reasons.provider,
      );
    // A run-owned budget refusal cannot suspend unrelated customers' normal
    // envelope. It withholds expansion; the original paid-call gate still denies that run.
    if (runtime.budgetDenialCount! > 0) limit(policy.initial, Reasons.budget);
    if (
      policy.providerConcurrentLimit === null ||
      policy.providerRpmLimit === null ||
      policy.providerTpmLimit === null ||
      database.providerTokensLastMinute === null ||
      database.unknownModelOutcomes > 0 ||
      runtime.brokerReady === null ||
      runtime.brokerUnacknowledged === null ||
      runtime.brokerOtherReady === null ||
      !fresh(runtime.brokerObservedAt)
    ) {
      limit(policy.initial, Reasons.unknownProvider);
    } else {
      limit(policy.providerConcurrentLimit, Reasons.provider);
      if (
        database.activeModelRequests >= policy.providerConcurrentLimit ||
        database.providerRequestsLastMinute >= policy.providerRpmLimit ||
        database.providerTokensLastMinute >= policy.providerTpmLimit
      ) {
        limit(
          Math.max(0, state.effective - policy.scaleDownStep),
          Reasons.provider,
        );
      }
    }
  }
  if (policy.emergencyDisabled) {
    ceiling = 0;
    reason = Reasons.emergency;
  }
  if (runtime?.draining) {
    ceiling = 0;
    reason = Reasons.draining;
  }
  let desired = Math.min(state.desired, policy.maximum);
  let effective = Math.min(state.effective, ceiling);
  let healthySamples = state.healthySamples;
  let idleSamples = state.idleSamples;
  if (policy.manualOverride !== null || !policy.enabled) {
    desired = policy.manualOverride ?? policy.initial;
    effective = Math.min(desired, ceiling);
    healthySamples = idleSamples = 0;
    if (desired <= ceiling)
      reason =
        policy.manualOverride !== null ? Reasons.override : Reasons.disabled;
  } else if (ceiling < state.effective || ceiling === 0) {
    desired = Math.min(desired, ceiling);
    healthySamples = idleSamples = 0;
  } else if (
    state.lastScaleUpAt === null &&
    state.lastScaleDownAt === null &&
    state.effective === 0
  ) {
    desired = policy.initial;
    effective = Math.min(desired, ceiling);
    healthySamples = idleSamples = 0;
  } else {
    const pressure =
      database.queued > 0 &&
      (database.oldestWaitingSeconds >= policy.evaluationSeconds ||
        database.activeReservations >= effective);
    healthySamples = pressure && ceiling > effective ? healthySamples + 1 : 0;
    idleSamples =
      database.queued === 0 && database.activeReservations < effective
        ? idleSamples + 1
        : 0;
    reason = Reasons.cooldown;
    if (
      healthySamples >= policy.hysteresisSamples &&
      secondsSince(state.lastScaleUpAt) >= policy.scaleUpCooldownSeconds
    ) {
      desired = Math.min(
        ceiling,
        Math.max(policy.minimum, effective + policy.scaleUpStep),
      );
      effective = desired;
      reason = Reasons.backlog;
      healthySamples = 0;
    } else if (
      idleSamples >= policy.hysteresisSamples &&
      secondsSince(state.lastScaleDownAt) >= policy.scaleDownCooldownSeconds
    ) {
      desired = Math.max(policy.minimum, effective - policy.scaleDownStep);
      effective = Math.min(desired, ceiling);
      reason = Reasons.idle;
      idleSamples = 0;
    }
  }
  return {
    desired,
    effective,
    healthySamples,
    idleSamples,
    reason,
    lastScaleUpAt: effective > state.effective ? now : state.lastScaleUpAt,
    lastScaleDownAt: effective < state.effective ? now : state.lastScaleDownAt,
  };
}
