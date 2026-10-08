import { describe, expect, it } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES as L,
} from "@lcsp/contracts/assessment";
import {
  LEGACY_REEVALUATION_CANARY_CHECKS as CHECK,
  LEGACY_REEVALUATION_CHECK_STATUSES as STATUS,
  LEGACY_REEVALUATION_DEFAULTS,
  LEGACY_REEVALUATION_EXCLUSIONS as EXCLUDED,
  LEGACY_REEVALUATION_MAX_BACKOFF_MS,
  LEGACY_REEVALUATION_MODES,
  LEGACY_REEVALUATION_STATES as STATE,
  LEGACY_REEVALUATION_STOP_REASONS as STOP,
} from "@lcsp/contracts/legacy-migration";

import {
  admitStart,
  canaryVerified,
  deriveReevaluationState,
  evaluateCanary,
  exclusionsOf,
  nextDelayMs,
  type CanaryEvidence,
  type PassLimits,
  type ReevaluationFacts,
} from "./legacy-reevaluation.js";

const facts = (
  overrides: Partial<ReevaluationFacts> = {},
): ReevaluationFacts => ({
  assessmentId: "a-1",
  ownerId: "tenant-1",
  lifecycleState: L.PREPARING,
  rootClaimed: false,
  executionState: null,
  hasSnapshotPin: true,
  snapshotUsable: true,
  connectionActive: true,
  coverageComplete: true,
  ledgerMode: null,
  ...overrides,
});

describe("re-evaluation eligibility and derived state", () => {
  it("a prepared, pinned, covered migrated assessment is READY_NOT_STARTED and eligible", () => {
    expect(exclusionsOf(facts())).toEqual([]);
    expect(deriveReevaluationState(facts())).toBe(STATE.READY_NOT_STARTED);
  });

  it("reports every reason it cannot start, never guessing", () => {
    expect(exclusionsOf(facts({ hasSnapshotPin: false }))).toEqual([
      EXCLUDED.NO_PINNED_SNAPSHOT,
    ]);
    expect(exclusionsOf(facts({ snapshotUsable: false }))).toEqual([
      EXCLUDED.NO_PINNED_SNAPSHOT,
    ]);
    expect(exclusionsOf(facts({ connectionActive: false }))).toEqual([
      EXCLUDED.CONNECTION_NOT_ACTIVE,
    ]);
    expect(
      exclusionsOf(facts({ connectionActive: false, coverageComplete: false })),
    ).toEqual([EXCLUDED.CONNECTION_NOT_ACTIVE, EXCLUDED.COVERAGE_INCOMPLETE]);
    expect(deriveReevaluationState(facts({ hasSnapshotPin: false }))).toBe(
      STATE.NOT_READY,
    );
  });

  it("an operator-started assessment is never eligible again, whatever its lifecycle", () => {
    for (const lifecycleState of [L.PREPARING, L.ACTIVE, L.COMPLETE, L.FAILED])
      expect(
        exclusionsOf(
          facts({
            lifecycleState,
            ledgerMode: LEGACY_REEVALUATION_MODES.CANARY,
          }),
        ),
      ).toEqual([EXCLUDED.ALREADY_STARTED]);
  });

  it("an assessment that left PREPARING by another path (the customer) is not startable", () => {
    expect(exclusionsOf(facts({ lifecycleState: L.ACTIVE }))).toEqual([
      EXCLUDED.NOT_PREPARING,
    ]);
  });

  it("derives the scheduling state from canonical lifecycle and runtime only", () => {
    const derive = (lifecycleState: string | null, rootClaimed = false) =>
      deriveReevaluationState(facts({ lifecycleState, rootClaimed }));
    expect(derive(L.ACTIVE, false)).toBe(STATE.STARTED_QUEUED);
    expect(derive(L.ACTIVE, true)).toBe(STATE.RUNNING);
    // A failed execution under an ACTIVE lifecycle is surfaced, never hidden as "running".
    expect(
      deriveReevaluationState(
        facts({
          lifecycleState: L.ACTIVE,
          rootClaimed: true,
          executionState: AGENT_EXECUTION_STATES.FAILED,
        }),
      ),
    ).toBe(STATE.RETRYABLE_FAILURE);
    expect(derive(L.FINALIZING, true)).toBe(STATE.RUNNING);
    expect(derive(L.WAITING_FOR_HUMAN)).toBe(STATE.WAITING);
    expect(derive(L.WAITING_FOR_REQUIRED_INPUT)).toBe(STATE.WAITING);
    expect(derive(L.PAUSED)).toBe(STATE.PAUSED);
    expect(derive(L.COMPLETE)).toBe(STATE.COMPLETE);
    expect(derive(L.FAILED)).toBe(STATE.FAILED);
    expect(derive(L.BLOCKED)).toBe(STATE.BLOCKED);
    expect(derive(L.CANCELLED)).toBe(STATE.CANCELLED);
    expect(derive(null)).toBe(STATE.NOT_READY);
  });
});

describe("bounded concurrency and back-pressure", () => {
  const limits: PassLimits = {
    globalConcurrency: 2,
    tenantConcurrency: 1,
    maxBacklog: 2,
    maxTotal: 5,
  };
  const idle = { inFlight: 0, queued: 0, inFlightForTenant: 0 };

  it("defaults are conservative", () => {
    expect(LEGACY_REEVALUATION_DEFAULTS.GLOBAL_CONCURRENCY).toBeLessThanOrEqual(
      2,
    );
    expect(LEGACY_REEVALUATION_DEFAULTS.TENANT_CONCURRENCY).toBe(1);
    expect(LEGACY_REEVALUATION_DEFAULTS.MAX_BACKLOG).toBeLessThanOrEqual(2);
    expect(LEGACY_REEVALUATION_DEFAULTS.MIN_START_INTERVAL_MS).toBeGreaterThan(
      0,
    );
    expect(LEGACY_REEVALUATION_DEFAULTS.MAX_CANARY_SIZE).toBeLessThanOrEqual(5);
  });

  it("admits while every bound has room", () => {
    expect(admitStart(limits, idle, 0)).toEqual({ admit: true });
  });

  it("stops the whole pass at the size the operator asked for", () => {
    expect(admitStart(limits, idle, 5)).toEqual({
      admit: false,
      scope: "PASS",
      reason: STOP.MAX_TOTAL_REACHED,
    });
  });

  it("stops the whole pass at the global cap, counting work any actor started", () => {
    expect(admitStart(limits, { ...idle, inFlight: 2 }, 0)).toEqual({
      admit: false,
      scope: "PASS",
      reason: STOP.GLOBAL_CAP_REACHED,
    });
  });

  it("applies back-pressure when started Root runs have not been claimed yet", () => {
    expect(admitStart(limits, { ...idle, inFlight: 1, queued: 2 }, 0)).toEqual({
      admit: false,
      scope: "PASS",
      reason: STOP.BACKPRESSURE,
    });
  });

  it("defers only the over-cap tenant, so one tenant cannot starve another", () => {
    expect(
      admitStart(limits, { ...idle, inFlight: 1, inFlightForTenant: 1 }, 0),
    ).toEqual({
      admit: false,
      scope: "TENANT",
      reason: STOP.TENANT_CAP_REACHED,
    });
  });

  it("never admits past any cap however many candidates are offered", () => {
    let inFlight = 0;
    let queued = 0;
    let started = 0;
    for (let candidate = 0; candidate < 1_000; candidate += 1) {
      const decision = admitStart(
        { ...limits, maxTotal: 1_000 },
        { inFlight, queued, inFlightForTenant: 0 },
        started,
      );
      if (!decision.admit) break;
      started += 1;
      inFlight += 1;
      queued += 1;
      expect(inFlight).toBeLessThanOrEqual(limits.globalConcurrency);
      expect(queued).toBeLessThanOrEqual(limits.maxBacklog);
    }
    expect(started).toBe(2);
  });

  it("paces starts and backs off exponentially after failures, up to a cap", () => {
    expect(nextDelayMs(5_000, 0, LEGACY_REEVALUATION_MAX_BACKOFF_MS)).toBe(
      5_000,
    );
    expect(nextDelayMs(5_000, 1, LEGACY_REEVALUATION_MAX_BACKOFF_MS)).toBe(
      10_000,
    );
    expect(nextDelayMs(5_000, 2, LEGACY_REEVALUATION_MAX_BACKOFF_MS)).toBe(
      20_000,
    );
    expect(nextDelayMs(5_000, 30, LEGACY_REEVALUATION_MAX_BACKOFF_MS)).toBe(
      LEGACY_REEVALUATION_MAX_BACKOFF_MS,
    );
    expect(nextDelayMs(0, 3, LEGACY_REEVALUATION_MAX_BACKOFF_MS)).toBe(8);
  });
});

describe("canary verification", () => {
  const declared = ["openai/gpt-x"];
  const completed = (
    overrides: Partial<CanaryEvidence> = {},
  ): CanaryEvidence => ({
    assessmentId: "a-1",
    ownerId: "tenant-1",
    lifecycleState: L.COMPLETE,
    runtime: {
      threadId: "t-v2",
      threadRows: 1,
      summaryThreadId: "t-v2",
      reusesV1Thread: false,
      checkpointId: "cp-1",
    },
    checkpointerHasThread: null,
    events: { rootEvents: 7, contiguous: true, wrongThread: 0 },
    usage: {
      events: 3,
      routes: [{ provider: "OPENAI", model: "gpt-x" }],
      wrongOwner: 0,
      charged: 0,
      withReservation: 0,
    },
    reservations: 0,
    coverage: { total: 4, pending: 0, resolvedWithoutDecision: 0 },
    artifacts: { finalReports: 1, unsealed: 0 },
    v1Authority: { inFlightRows: 0, undeliveredRetiredCommands: 0 },
    ...overrides,
  });
  const statusOf = (
    results: ReturnType<typeof evaluateCanary>,
    check: string,
  ) => results.find((result) => result.check === check)?.status;

  it("passes a finished canary that left every kind of evidence", () => {
    const results = evaluateCanary(completed(), declared);
    expect(results.map((result) => result.check).sort()).toEqual(
      Object.values(CHECK).sort(),
    );
    expect(results.every((result) => result.status === STATUS.PASS)).toBe(true);
    expect(canaryVerified([{ assessmentId: "a-1", results }], [])).toBe(true);
  });

  it("is PENDING, not passed, while the Root has not produced the evidence yet", () => {
    const running = completed({
      lifecycleState: L.ACTIVE,
      runtime: { ...completed().runtime!, checkpointId: null },
      checkpointerHasThread: false,
      events: { rootEvents: 0, contiguous: true, wrongThread: 0 },
      usage: {
        events: 0,
        routes: [],
        wrongOwner: 0,
        charged: 0,
        withReservation: 0,
      },
      coverage: { total: 4, pending: 4, resolvedWithoutDecision: 0 },
      artifacts: { finalReports: 0, unsealed: 0 },
    });
    const results = evaluateCanary(running, declared);
    for (const check of [
      CHECK.CHECKPOINT_RECORDED,
      CHECK.EVENTS_RECORDED,
      CHECK.MODEL_USAGE_RECORDED,
      CHECK.ACCOUNTING_CONSISTENT,
      CHECK.DECISIONS_RECORDED,
      CHECK.ARTIFACT_FLOW,
    ])
      expect(statusOf(results, check)).toBe(STATUS.PENDING);
    expect(statusOf(results, CHECK.THREAD_UNIQUE)).toBe(STATUS.PASS);
    expect(canaryVerified([{ assessmentId: "a-1", results }], [])).toBe(false);
  });

  it("fails once a terminal canary cannot produce the evidence", () => {
    const failed = completed({
      lifecycleState: L.FAILED,
      usage: {
        events: 0,
        routes: [],
        wrongOwner: 0,
        charged: 0,
        withReservation: 0,
      },
      artifacts: { finalReports: 0, unsealed: 0 },
    });
    const results = evaluateCanary(failed, declared);
    expect(statusOf(results, CHECK.MODEL_USAGE_RECORDED)).toBe(STATUS.FAIL);
    expect(statusOf(results, CHECK.ARTIFACT_FLOW)).toBe(STATUS.FAIL);
    expect(canaryVerified([{ assessmentId: "a-1", results }], [])).toBe(false);
  });

  it("fails a model route the operator never declared (visibility of what is actually spent)", () => {
    const results = evaluateCanary(
      completed({
        usage: {
          events: 2,
          routes: [{ provider: "anthropic", model: "expensive" }],
          wrongOwner: 0,
          charged: 0,
          withReservation: 0,
        },
      }),
      declared,
    );
    expect(statusOf(results, CHECK.MODEL_USAGE_RECORDED)).toBe(STATUS.FAIL);
  });

  it("fails accounting that debits credits, reserves, or attributes usage to another tenant", () => {
    for (const usage of [
      { charged: 1 },
      { withReservation: 1 },
      { wrongOwner: 1 },
    ]) {
      const results = evaluateCanary(
        completed({
          usage: { ...completed().usage, ...usage },
        }),
        declared,
      );
      expect(statusOf(results, CHECK.ACCOUNTING_CONSISTENT)).toBe(STATUS.FAIL);
    }
    expect(
      statusOf(
        evaluateCanary(completed({ reservations: 1 }), declared),
        CHECK.ACCOUNTING_CONSISTENT,
      ),
    ).toBe(STATUS.FAIL);
  });

  it("fails a reused or duplicated thread and any surviving V1 authority", () => {
    const reused = evaluateCanary(
      completed({ runtime: { ...completed().runtime!, reusesV1Thread: true } }),
      declared,
    );
    expect(statusOf(reused, CHECK.THREAD_UNIQUE)).toBe(STATUS.FAIL);
    const duplicated = evaluateCanary(
      completed({ runtime: { ...completed().runtime!, threadRows: 2 } }),
      declared,
    );
    expect(statusOf(duplicated, CHECK.THREAD_UNIQUE)).toBe(STATUS.FAIL);
    const authority = evaluateCanary(
      completed({
        v1Authority: { inFlightRows: 1, undeliveredRetiredCommands: 0 },
      }),
      declared,
    );
    expect(statusOf(authority, CHECK.NO_V1_AUTHORITY)).toBe(STATUS.FAIL);
  });

  it("reports a checkpoint that lives outside the database as UNOBSERVABLE; only an exact attestation passes it", () => {
    const results = evaluateCanary(
      completed({
        runtime: { ...completed().runtime!, checkpointId: null },
        checkpointerHasThread: null,
      }),
      declared,
    );
    expect(statusOf(results, CHECK.CHECKPOINT_RECORDED)).toBe(
      STATUS.UNOBSERVABLE,
    );
    const verdicts = [{ assessmentId: "a-1", results }];
    expect(canaryVerified(verdicts, [])).toBe(false);
    expect(canaryVerified(verdicts, [CHECK.EVENTS_RECORDED])).toBe(false);
    expect(canaryVerified(verdicts, [CHECK.CHECKPOINT_RECORDED])).toBe(true);
  });

  it("an empty canary set, or an assessment with no evidence at all, is never verified", () => {
    expect(canaryVerified([], [])).toBe(false);
    expect(canaryVerified([{ assessmentId: "gone", results: [] }], [])).toBe(
      false,
    );
  });
});
