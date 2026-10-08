import type {
  LegacyReevaluationCanaryCheck,
  LegacyReevaluationExclusion,
  LegacyReevaluationMode,
  LegacyReevaluationState,
  LegacyReevaluationStopReason,
} from "@lcsp/contracts/legacy-migration";

import type {
  CanaryCheckResult,
  PassLimits,
} from "../domain/legacy-reevaluation.js";

/** Operator-chosen bounds. Defaults are conservative and live in `LEGACY_REEVALUATION_DEFAULTS`. */
export type ReevaluationLimits = Omit<PassLimits, "maxTotal"> & {
  /** Pacing floor between two starts, and the base of the back-off after a failed start. */
  minStartIntervalMs: number;
  /** Failed starts tolerated in one invocation before it halts (no mass retries). */
  maxFailures: number;
};

export type ReevaluationStartOptions = {
  /** The completed, validated migration run this re-evaluation belongs to. */
  cutoverRunId: string;
  mode: LegacyReevaluationMode;
  /** Required and explicit for a CANARY; empty for a BATCH. */
  assessmentIds: readonly string[];
  /** BATCH: the size of this invocation. CANARY: derived from the ids. */
  maxTotal: number;
  limits: ReevaluationLimits;
  /** `provider/model` routes the operator declares the workers will use. */
  modelRoutes: readonly string[];
  /** Who authorized spending AI budget (operator or ticket). Recorded in the ledger and audit. */
  authorizedBy: string;
  confirmBulk: boolean;
  /** UNOBSERVABLE canary checks the operator verified out of band. */
  attestedChecks: readonly LegacyReevaluationCanaryCheck[];
  sampleSize: number;
};

export type ReevaluationPreflightOptions = {
  cutoverRunId: string;
  limits: ReevaluationLimits;
  /** Size of the intended invocation, for the upper-bound estimate. */
  maxTotal: number | null;
  modelRoutes: readonly string[];
  attestedChecks: readonly LegacyReevaluationCanaryCheck[];
  sampleSize: number;
};

export type ReevaluationPreflight = {
  generatedAt: string;
  cutoverRunId: string;
  gates: {
    cutoverValidated: boolean;
    blockingFailures: number;
    failingChecks: string[];
    restoreBoundaryClosed: boolean;
    modelRouteDeclared: boolean;
  };
  cohort: {
    migrated: number;
    byState: Partial<Record<LegacyReevaluationState, number>>;
    eligible: number;
    notReady: number;
    excluded: Partial<Record<LegacyReevaluationExclusion, number>>;
    alreadyScheduledOrFinished: number;
    startedByOperator: number;
    startedOtherwise: number;
  };
  perTenant: {
    tenantsTotal: number;
    top: { ownerId: string; eligible: number; inFlight: number }[];
  };
  concurrency: ReevaluationLimits & { maxTotal: number | null };
  currentLoad: { inFlight: number; queued: number };
  modelRoute: {
    declared: string[];
    observedPolicies: { role: string; route: string; policyVersion: string }[];
    observedUsage: {
      route: string;
      invocations: number;
      assessments: number;
    }[];
    undeclaredObservedRoutes: string[];
  };
  budget: {
    policy: string;
    walletConsultedByExecution: false;
    /** Root runs this invocation can start at most; model calls per run are NOT estimated. */
    upperBoundRootExecutions: number;
    modelInvocationsPerRoot: null;
    observedInvocationsPerAssessment: number | null;
    note: string;
  };
  canary: {
    canaryAssessments: number;
    verified: boolean;
    attestedChecks: string[];
  };
  blockers: string[];
};

export type ReevaluationStatus = {
  generatedAt: string;
  migrated: number;
  byState: Partial<Record<LegacyReevaluationState, number>>;
  startedByOperator: number;
  startedOtherwise: number;
  load: { inFlight: number; queued: number };
  runs: {
    runId: string;
    mode: LegacyReevaluationMode;
    startedBy: string;
    started: number;
    firstStartedAt: string;
  }[];
  assessments?: {
    assessmentId: string;
    state: LegacyReevaluationState;
    lifecycleState: string | null;
    startedVia: "OPERATOR_REEVALUATION" | "OTHER" | null;
  }[];
};

export type CanaryVerification = {
  generatedAt: string;
  canaryAssessments: number;
  verified: boolean;
  attestedChecks: string[];
  assessments: {
    assessmentId: string;
    lifecycleState: string | null;
    results: CanaryCheckResult[];
  }[];
};

export type ReevaluationStartResult = {
  runId: string;
  mode: LegacyReevaluationMode;
  requested: number;
  started: string[];
  /** Started earlier (by this tool, or by the customer) and left untouched: no second command. */
  alreadyStarted: string[];
  deferred: { assessmentId: string; reason: LegacyReevaluationStopReason }[];
  failed: { assessmentId: string; code: string }[];
  notReady: {
    assessmentId: string;
    reasons: LegacyReevaluationExclusion[];
  }[];
  stopReason: LegacyReevaluationStopReason;
  remainingEligible: number;
  load: { inFlight: number; queued: number };
};
