import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  LEGACY_REEVALUATION_CANARY_CHECKS,
  LEGACY_REEVALUATION_CHECK_STATUSES,
  LEGACY_REEVALUATION_EXCLUSIONS,
  LEGACY_REEVALUATION_STATES,
  LEGACY_REEVALUATION_STOP_REASONS,
  type LegacyReevaluationCanaryCheck,
  type LegacyReevaluationCheckStatus,
  type LegacyReevaluationExclusion,
  type LegacyReevaluationMode,
  type LegacyReevaluationState,
  type LegacyReevaluationStopReason,
} from "@lcsp/contracts/legacy-migration";

/**
 * Pure rules of the explicit re-evaluation phase. Nothing here reads or writes state: the scheduler
 * only coordinates STARTS, every fact below is derived from canonical lifecycle/runtime/accounting
 * rows, and the Assessment Root stays the sole semantic authority.
 */

const L = ASSESSMENT_LIFECYCLE_STATES;
const S = LEGACY_REEVALUATION_STATES;
const X = LEGACY_REEVALUATION_EXCLUSIONS;

export type ReevaluationFacts = {
  assessmentId: string;
  ownerId: string;
  lifecycleState: string | null;
  /** The Root has claimed its lease at least once (`AssessmentRuntime.startedAt`). */
  rootClaimed: boolean;
  /** `AssessmentRuntime.executionState` (null when the assessment has no runtime row). */
  executionState: string | null;
  hasSnapshotPin: boolean;
  /** Pinned snapshot is READY with a well-formed commit equal to the pinned commit. */
  snapshotUsable: boolean;
  connectionActive: boolean;
  /** One coverage row per engineering rule of the pinned portfolio, and the portfolio has rules. */
  coverageComplete: boolean;
  ledgerMode: LegacyReevaluationMode | null;
};

/** Reasons a migrated assessment cannot be started now. Empty = eligible. */
export function exclusionsOf(
  facts: ReevaluationFacts,
): LegacyReevaluationExclusion[] {
  if (facts.ledgerMode !== null) return [X.ALREADY_STARTED];
  if (facts.lifecycleState !== L.PREPARING) return [X.NOT_PREPARING];
  const reasons: LegacyReevaluationExclusion[] = [];
  if (!facts.hasSnapshotPin || !facts.snapshotUsable)
    reasons.push(X.NO_PINNED_SNAPSHOT);
  else if (!facts.connectionActive) reasons.push(X.CONNECTION_NOT_ACTIVE);
  if (!facts.coverageComplete) reasons.push(X.COVERAGE_INCOMPLETE);
  return reasons;
}

/** The scheduling state of a migrated assessment, derived only from canonical state. */
export function deriveReevaluationState(
  facts: ReevaluationFacts,
): LegacyReevaluationState {
  switch (facts.lifecycleState) {
    case L.PREPARING:
      return exclusionsOf({ ...facts, ledgerMode: null }).length === 0
        ? S.READY_NOT_STARTED
        : S.NOT_READY;
    case L.ACTIVE:
      if (facts.executionState === AGENT_EXECUTION_STATES.FAILED)
        return S.RETRYABLE_FAILURE;
      return facts.rootClaimed ? S.RUNNING : S.STARTED_QUEUED;
    case L.FINALIZING:
      return S.RUNNING;
    case L.WAITING_FOR_HUMAN:
    case L.WAITING_FOR_REQUIRED_INPUT:
      return S.WAITING;
    case L.PAUSED:
      return S.PAUSED;
    case L.COMPLETE:
      return S.COMPLETE;
    case L.FAILED:
      return S.FAILED;
    case L.BLOCKED:
      return S.BLOCKED;
    case L.CANCELLED:
      return S.CANCELLED;
    default:
      return S.NOT_READY;
  }
}

// ---- admission: global / per-tenant concurrency and queue back-pressure ---------------------------

export type PassLimits = {
  globalConcurrency: number;
  tenantConcurrency: number;
  /** Started-but-unclaimed Root runs tolerated before the scheduler stops (queue back-pressure). */
  maxBacklog: number;
  /** Starts allowed in this invocation. Never defaulted: an operator states the size of a batch. */
  maxTotal: number;
};

/** Canonical load, read in the same transaction that starts the assessment. */
export type CanonicalLoad = {
  /** ACTIVE + FINALIZING assessments, excluding terminal FAILED executions. */
  inFlight: number;
  /** ACTIVE assessments whose Root has not claimed yet. */
  queued: number;
  inFlightForTenant: number;
};

export type Admission =
  | { admit: true }
  | {
      admit: false;
      /** PASS = stop the whole invocation; TENANT = skip this assessment only. */
      scope: "PASS" | "TENANT";
      reason: LegacyReevaluationStopReason;
    };

const R = LEGACY_REEVALUATION_STOP_REASONS;

export function admitStart(
  limits: PassLimits,
  load: CanonicalLoad,
  startedThisPass: number,
): Admission {
  if (startedThisPass >= limits.maxTotal)
    return { admit: false, scope: "PASS", reason: R.MAX_TOTAL_REACHED };
  if (load.inFlight >= limits.globalConcurrency)
    return { admit: false, scope: "PASS", reason: R.GLOBAL_CAP_REACHED };
  if (load.queued >= limits.maxBacklog)
    return { admit: false, scope: "PASS", reason: R.BACKPRESSURE };
  if (load.inFlightForTenant >= limits.tenantConcurrency)
    return { admit: false, scope: "TENANT", reason: R.TENANT_CAP_REACHED };
  return { admit: true };
}

/** Delay before the next start: the pacing floor, or an exponential back-off after failures. */
export function nextDelayMs(
  minStartIntervalMs: number,
  consecutiveFailures: number,
  maxBackoffMs: number,
): number {
  if (consecutiveFailures === 0) return minStartIntervalMs;
  const base = Math.max(minStartIntervalMs, 1);
  return Math.min(maxBackoffMs, base * 2 ** consecutiveFailures);
}

// ---- canary verification ----------------------------------------------------------------------------

const C = LEGACY_REEVALUATION_CANARY_CHECKS;
const T = LEGACY_REEVALUATION_CHECK_STATUSES;

/** Everything a canary check needs, read from canonical state by the repository. */
export type CanaryEvidence = {
  assessmentId: string;
  ownerId: string;
  lifecycleState: string | null;
  runtime: {
    threadId: string;
    /** Runtime rows that carry this thread id across all assessments (must be 1). */
    threadRows: number;
    /** The fresh V2 thread the migration summary recorded for this assessment. */
    summaryThreadId: string | null;
    reusesV1Thread: boolean;
    checkpointId: string | null;
  } | null;
  /** null = the LangGraph checkpointer tables are not in this database. */
  checkpointerHasThread: boolean | null;
  events: { rootEvents: number; contiguous: boolean; wrongThread: number };
  usage: {
    events: number;
    routes: { provider: string; model: string }[];
    wrongOwner: number;
    charged: number;
    withReservation: number;
  };
  /** Billing reservations created for this assessment since the migration began. */
  reservations: number;
  coverage: { total: number; pending: number; resolvedWithoutDecision: number };
  artifacts: { finalReports: number; unsealed: number };
  v1Authority: { inFlightRows: number; undeliveredRetiredCommands: number };
};

export type CanaryCheckResult = {
  check: LegacyReevaluationCanaryCheck;
  status: LegacyReevaluationCheckStatus;
  observed: unknown;
};

const ACTIVE_STATES: readonly string[] = [L.PREPARING, L.ACTIVE];
const UNFINISHED_STATES: readonly string[] = [
  L.PREPARING,
  L.ACTIVE,
  L.WAITING_FOR_HUMAN,
  L.WAITING_FOR_REQUIRED_INPUT,
  L.PAUSED,
  L.FINALIZING,
];

const routeKey = (route: { provider: string; model: string }): string =>
  `${route.provider}/${route.model}`.toLowerCase();

/** "Not yet" while the Root can still produce the evidence; a hard failure once it cannot. */
function pendingOrFail(
  lifecycleState: string | null,
  states: readonly string[],
): LegacyReevaluationCheckStatus {
  return lifecycleState !== null && states.includes(lifecycleState)
    ? T.PENDING
    : T.FAIL;
}

export function evaluateCanary(
  evidence: CanaryEvidence,
  declaredRoutes: readonly string[],
): CanaryCheckResult[] {
  const declared = new Set(declaredRoutes.map((route) => route.toLowerCase()));
  const { runtime, lifecycleState } = evidence;
  const complete = lifecycleState === L.COMPLETE;
  const results: CanaryCheckResult[] = [];
  const add = (
    check: LegacyReevaluationCanaryCheck,
    status: LegacyReevaluationCheckStatus,
    observed: unknown,
  ) => results.push({ check, status, observed });

  add(
    C.THREAD_UNIQUE,
    runtime !== null &&
      runtime.threadRows === 1 &&
      runtime.threadId === runtime.summaryThreadId &&
      !runtime.reusesV1Thread
      ? T.PASS
      : T.FAIL,
    runtime,
  );

  const checkpointed =
    runtime?.checkpointId != null || evidence.checkpointerHasThread === true;
  add(
    C.CHECKPOINT_RECORDED,
    checkpointed
      ? T.PASS
      : evidence.checkpointerHasThread === null
        ? T.UNOBSERVABLE
        : pendingOrFail(lifecycleState, ACTIVE_STATES),
    {
      runtimeCheckpointId: runtime?.checkpointId ?? null,
      checkpointerHasThread: evidence.checkpointerHasThread,
    },
  );

  const eventsOk =
    evidence.events.rootEvents > 0 &&
    evidence.events.contiguous &&
    evidence.events.wrongThread === 0;
  add(
    C.EVENTS_RECORDED,
    eventsOk
      ? T.PASS
      : evidence.events.rootEvents === 0
        ? pendingOrFail(lifecycleState, ACTIVE_STATES)
        : T.FAIL,
    evidence.events,
  );

  const undeclared = evidence.usage.routes.filter(
    (route) => !declared.has(routeKey(route)),
  );
  add(
    C.MODEL_USAGE_RECORDED,
    evidence.usage.events > 0
      ? undeclared.length === 0 && declared.size > 0
        ? T.PASS
        : T.FAIL
      : pendingOrFail(lifecycleState, ACTIVE_STATES),
    {
      events: evidence.usage.events,
      routes: evidence.usage.routes.map(routeKey),
      declared: [...declared],
      undeclared: undeclared.map(routeKey),
    },
  );

  const accountingClean =
    evidence.usage.wrongOwner === 0 &&
    evidence.usage.charged === 0 &&
    evidence.usage.withReservation === 0 &&
    evidence.reservations === 0;
  add(
    C.ACCOUNTING_CONSISTENT,
    !accountingClean
      ? T.FAIL
      : evidence.usage.events > 0
        ? T.PASS
        : pendingOrFail(lifecycleState, ACTIVE_STATES),
    {
      usageEvents: evidence.usage.events,
      usageForAnotherOwner: evidence.usage.wrongOwner,
      usageWithCreditCharge: evidence.usage.charged,
      usageWithReservation: evidence.usage.withReservation,
      reservations: evidence.reservations,
    },
  );

  const decisionsOk =
    evidence.coverage.total > 0 &&
    evidence.coverage.pending === 0 &&
    evidence.coverage.resolvedWithoutDecision === 0;
  add(
    C.DECISIONS_RECORDED,
    complete
      ? decisionsOk
        ? T.PASS
        : T.FAIL
      : pendingOrFail(lifecycleState, UNFINISHED_STATES),
    evidence.coverage,
  );

  add(
    C.ARTIFACT_FLOW,
    complete
      ? evidence.artifacts.finalReports === 1 &&
        evidence.artifacts.unsealed === 0
        ? T.PASS
        : T.FAIL
      : pendingOrFail(lifecycleState, UNFINISHED_STATES),
    evidence.artifacts,
  );

  add(
    C.NO_V1_AUTHORITY,
    evidence.v1Authority.inFlightRows === 0 &&
      evidence.v1Authority.undeliveredRetiredCommands === 0
      ? T.PASS
      : T.FAIL,
    evidence.v1Authority,
  );
  return results;
}

export type CanaryVerdict = {
  assessmentId: string;
  results: CanaryCheckResult[];
};

/**
 * A canary set is verified only when every check passed on every canary assessment. An
 * UNOBSERVABLE check passes only when the operator explicitly attested that exact check.
 */
export function canaryVerified(
  verdicts: readonly CanaryVerdict[],
  attested: readonly string[],
): boolean {
  if (verdicts.length === 0) return false;
  return verdicts.every(
    (verdict) =>
      verdict.results.length > 0 &&
      verdict.results.every(
        (result) =>
          result.status === T.PASS ||
          (result.status === T.UNOBSERVABLE && attested.includes(result.check)),
      ),
  );
}
