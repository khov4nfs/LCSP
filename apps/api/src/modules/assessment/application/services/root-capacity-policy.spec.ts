import {
  ROOT_CAPACITY_REASONS as Reasons,
  ROOT_CAPACITY_METRIC_SOURCES as Sources,
  rootCapacityPolicySchema,
  type RootCapacityRuntimeMetrics,
  type RootCapacityDatabaseMetrics,
} from "@lcsp/contracts/assessment-domain";
import {
  decideRootCapacity,
  type CapacityControlState,
} from "./root-capacity-policy.js";

const epoch = new Date("2026-10-29T12:00:00.000Z");
const gib = 1024 ** 3;
const policy = rootCapacityPolicySchema.parse({
  enabled: true,
  initial: 1,
  maximum: 4,
  hysteresisSamples: 2,
  scaleUpCooldownSeconds: 30,
  scaleDownCooldownSeconds: 30,
  providerConcurrentLimit: 8,
  providerRpmLimit: 100,
  providerTpmLimit: 100000,
});
function runtime(now = epoch): RootCapacityRuntimeMetrics {
  return {
    sampledAt: now.toISOString(),
    source: Sources.runtime,
    workerSlots: 8,
    serverSlots: 8,
    activeNativeRuns: 1,
    activeNativeRoots: 1,
    reservedRootRuns: 1,
    draining: false,
    cpuPressure: 0.05,
    memoryAvailableBytes: 24 * gib,
    cgroupMemoryAvailableBytes: 24 * gib,
    cgroupMemoryLimitBytes: 32 * gib,
    cgroupCpuLimitCores: 8,
    cgroupObserved: true,
    processRssBytes: gib / 2,
    diskAvailableBytes: 20 * gib,
    diskPressure: 0.01,
    sandboxMemoryBytes: gib,
    largestSandboxMemoryBytes: gib,
    sandboxCpuCores: 0.1,
    activeSandboxes: 1,
    sandboxSamples: [],
    checkpointLatencyMs: 10,
    checkpointFailureRate: 0,
    checkpointObservedAt: now.toISOString(),
    provider429Count: 0,
    budgetDenialCount: 0,
    brokerReady: 8,
    brokerUnacknowledged: 1,
    brokerOtherReady: 0,
    brokerObservedAt: now.toISOString(),
    brokerSource: Sources.broker,
  };
}
function database(now = epoch): RootCapacityDatabaseMetrics {
  return {
    sampledAt: now.toISOString(),
    source: Sources.database,
    queued: 8,
    oldestWaitingSeconds: 120,
    activeReservations: 1,
    activeModelRequests: 1,
    unknownModelOutcomes: 0,
    providerRequestsLastMinute: 2,
    providerTokensLastMinute: 1000,
    dbConnectionRatio: 0.1,
    dbMaxConnections: 100,
    dbUsedConnections: 10,
    dbRootConnections: 2,
    activeSandboxMemoryBytes: 0,
    dbLatencyMs: 5,
    completionsLastMinute: 1,
    dispatchWaitP50Ms: null,
    dispatchWaitP95Ms: null,
    reservedCredits: "100",
    settledCredits: null,
  };
}
function state(effective = 1): CapacityControlState {
  return {
    desired: effective,
    effective,
    healthySamples: 0,
    idleSamples: 0,
    lastScaleUpAt: null,
    lastScaleDownAt: null,
  };
}

describe("LCSP-364 bottleneck controller", () => {
  it.each([
    [{ serverSlots: 2 }, policy, Reasons.physical],
    [
      { memoryAvailableBytes: 6 * gib, cgroupMemoryAvailableBytes: 6 * gib },
      policy,
      Reasons.memory,
    ],
    [{}, { ...policy, maximum: 2 }, Reasons.full],
  ])(
    "explains a ceiling hold by its actual bottleneck rather than cooldown",
    (readings, envelope, reason) => {
      const next = decideRootCapacity(
        envelope,
        state(2),
        { ...runtime(), ...readings },
        database(),
        epoch,
      );
      expect(next.effective).toBe(2);
      expect(next.reason).toBe(reason);
    },
  );

  it("automatically progresses 1 -> 2 -> N -> 2 -> 1 with persisted cooldown/hysteresis", () => {
    let current = state();
    const capacities = [1];
    for (let tick = 0; tick < 12; tick++) {
      const now = new Date(epoch.getTime() + tick * 15000);
      current = decideRootCapacity(
        policy,
        current,
        runtime(now),
        database(now),
        now,
      );
      capacities.push(current.effective);
    }
    expect(capacities).toContain(2);
    expect(current.effective).toBe(4);
    for (let tick = 12; tick < 24; tick++) {
      const now = new Date(epoch.getTime() + tick * 15000);
      current = decideRootCapacity(
        policy,
        current,
        {
          ...runtime(now),
          activeNativeRuns: 0,
          activeNativeRoots: 0,
          reservedRootRuns: 0,
        },
        { ...database(now), queued: 0, activeReservations: 0 },
        now,
      );
      capacities.push(current.effective);
    }
    expect(capacities.slice(-12)).toContain(2);
    expect(current.effective).toBe(1);
  });

  it.each([
    [{ memoryAvailableBytes: gib }, {}, Reasons.memory],
    [{ diskAvailableBytes: gib }, {}, Reasons.disk],
    [{ diskPressure: 0.8 }, {}, Reasons.disk],
    [{}, { dbConnectionRatio: 0.9 }, Reasons.database],
    [{}, { dbLatencyMs: 2000 }, Reasons.database],
    [{ checkpointLatencyMs: 1500 }, {}, Reasons.checkpoint],
    [{ checkpointFailureRate: 0.1 }, {}, Reasons.checkpoint],
    [{ draining: true }, {}, Reasons.draining],
  ])(
    "suspends unsafe new admissions while retaining physical work: %o",
    (rt, db, reason) => {
      const next = decideRootCapacity(
        policy,
        state(2),
        { ...runtime(), ...rt },
        { ...database(), ...db },
        epoch,
      );
      expect(next.effective).toBe(0);
      expect(next.reason).toBe(reason);
      expect(database().activeReservations).toBe(1);
    },
  );

  it.each([
    "memoryAvailableBytes",
    "sandboxMemoryBytes",
    "cpuPressure",
    "checkpointLatencyMs",
  ] as const)("fails closed for unknown %s", (key) => {
    expect(
      decideRootCapacity(
        policy,
        state(),
        { ...runtime(), [key]: null },
        database(),
        epoch,
      ).effective,
    ).toBe(0);
  });
  it("fails closed for stale checkpoints, cgroup blindness, future clocks and inconsistent occupancy", () => {
    for (const rt of [
      null,
      { ...runtime(), cgroupObserved: false },
      {
        ...runtime(),
        checkpointObservedAt: new Date(epoch.getTime() - 61000).toISOString(),
      },
      {
        ...runtime(),
        sampledAt: new Date(epoch.getTime() + 10000).toISOString(),
      },
      { ...runtime(), reservedRootRuns: 0 },
    ]) {
      expect(
        decideRootCapacity(policy, state(), rt, database(), epoch).effective,
      ).toBe(0);
    }
  });
  it("healthy CPU cannot exceed Agent Server slots", () => {
    const next = decideRootCapacity(
      policy,
      { ...state(2), healthySamples: 10 },
      { ...runtime(), serverSlots: 2 },
      database(),
      epoch,
    );
    expect(next.effective).toBe(2);
  });
  it("reduces under 429, CPU and observed provider request/token saturation", () => {
    for (const [rt, db] of [
      [{ provider429Count: 1 }, {}],
      [{ cpuPressure: 0.9 }, {}],
      [{}, { providerRequestsLastMinute: 100 }],
      [{}, { providerTokensLastMinute: 100000 }],
    ]) {
      expect(
        decideRootCapacity(
          policy,
          state(3),
          { ...runtime(), ...rt },
          { ...database(), ...db },
          epoch,
        ).effective,
      ).toBe(2);
    }
  });
  it("run-owned budget denial withholds expansion without blocking unrelated funded customers", () => {
    const next = decideRootCapacity(
      policy,
      state(3),
      { ...runtime(), budgetDenialCount: 1 },
      database(),
      epoch,
    );
    expect(next.effective).toBe(policy.initial);
    expect(next.reason).toBe(Reasons.budget);
  });
  it("unknown provider limits/usage and broker observations cannot authorize expansion", () => {
    for (const [p, rt, db] of [
      [{ ...policy, providerTpmLimit: null }, runtime(), database()],
      [policy, runtime(), { ...database(), providerTokensLastMinute: null }],
      [policy, runtime(), { ...database(), unknownModelOutcomes: 1 }],
      [policy, { ...runtime(), brokerReady: null }, database()],
    ] as const) {
      const next = decideRootCapacity(
        p,
        { ...state(3), healthySamples: 10 },
        rt,
        db,
        epoch,
      );
      expect(next.effective).toBe(1);
    }
  });
  it("manual overrides and disabled mode still obey safety; emergency can cross minimum", () => {
    expect(
      decideRootCapacity(
        { ...policy, manualOverride: 4 },
        state(),
        { ...runtime(), serverSlots: 2 },
        database(),
        epoch,
      ).effective,
    ).toBe(2);
    expect(
      decideRootCapacity(
        { ...policy, manualOverride: 4 },
        state(),
        { ...runtime(), diskAvailableBytes: gib },
        database(),
        epoch,
      ).effective,
    ).toBe(0);
    expect(
      decideRootCapacity(
        { ...policy, enabled: false, initial: 2 },
        state(4),
        runtime(),
        database(),
        epoch,
      ).effective,
    ).toBe(2);
    expect(
      decideRootCapacity(
        { ...policy, emergencyDisabled: true },
        state(4),
        runtime(),
        database(),
        epoch,
      ).effective,
    ).toBe(0);
    expect(
      rootCapacityPolicySchema.safeParse({ ...policy, manualOverride: 5 })
        .success,
    ).toBe(false);
  });
  it("does not oscillate when transient demand breaks consecutive healthy samples", () => {
    let current = state();
    for (let tick = 0; tick < 30; tick++) {
      const now = new Date(epoch.getTime() + tick * 15000);
      current = decideRootCapacity(
        policy,
        current,
        runtime(now),
        { ...database(now), queued: tick % 2, oldestWaitingSeconds: 120 },
        now,
      );
      expect(current.effective).toBe(1);
    }
  });
  it("retains the full authorized initial envelope only after fresh measurements", () => {
    expect(
      decideRootCapacity(
        { ...policy, initial: 2 },
        state(0),
        runtime(),
        database(),
        epoch,
      ).effective,
    ).toBe(2);
    expect(
      decideRootCapacity(
        { ...policy, initial: 2 },
        state(0),
        null,
        database(),
        epoch,
      ).effective,
    ).toBe(0);
  });
  it("never creates negative capacity or crosses the authorized maximum", () => {
    let current = state();
    for (let tick = 0; tick < 500; tick++) {
      const now = new Date(epoch.getTime() + tick * 15000);
      current = decideRootCapacity(
        policy,
        current,
        {
          ...runtime(now),
          memoryAvailableBytes: tick % 7 === 0 ? 0 : 24 * gib,
          provider429Count: tick % 11 === 0 ? 1 : 0,
        },
        database(now),
        now,
      );
      expect(Number.isInteger(current.effective)).toBe(true);
      expect(current.effective).toBeGreaterThanOrEqual(0);
      expect(current.effective).toBeLessThanOrEqual(policy.maximum);
    }
  });
});
