import { z } from "zod";

/** Frozen V2 contract. No legacy aliases; adoption and deletion occur in later waves.
 * Schemas validate structure only. API boundaries must authenticate tenant/actor,
 * server-owned assessment/thread/execution lineage, source/HMAC/citation provenance,
 * current pins and revisions, leases, billing, and transactional event ordering.
 */
export const ASSESSMENT_LIFECYCLE_STATES = {
  CREATED: "CREATED",
  PREPARING: "PREPARING",
  ACTIVE: "ACTIVE",
  WAITING_FOR_HUMAN: "WAITING_FOR_HUMAN",
  WAITING_FOR_REQUIRED_INPUT: "WAITING_FOR_REQUIRED_INPUT",
  PAUSED: "PAUSED",
  FINALIZING: "FINALIZING",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type AssessmentLifecycleState =
  (typeof ASSESSMENT_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_LIFECYCLE_STATES];

export const AGENT_EXECUTION_STATES = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  INTERRUPTED: "INTERRUPTED",
  PAUSED: "PAUSED",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type AgentExecutionState =
  (typeof AGENT_EXECUTION_STATES)[keyof typeof AGENT_EXECUTION_STATES];

export const DECISION_RESOLUTION_STATES = {
  PENDING: "PENDING",
  INVESTIGATING: "INVESTIGATING",
  WAITING_FOR_INPUT: "WAITING_FOR_INPUT",
  RESOLVED: "RESOLVED",
  INVALIDATED: "INVALIDATED",
} as const;
export type DecisionResolutionState =
  (typeof DECISION_RESOLUTION_STATES)[keyof typeof DECISION_RESOLUTION_STATES];

export const ARTIFACT_LIFECYCLE_STATES = {
  BUILDING: "BUILDING",
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
  INVALID: "INVALID",
} as const;
export type ArtifactLifecycleState =
  (typeof ARTIFACT_LIFECYCLE_STATES)[keyof typeof ARTIFACT_LIFECYCLE_STATES];

export const BLOCKER_REASONS = {
  HUMAN_FACT_UNRESOLVABLE: "HUMAN_FACT_UNRESOLVABLE",
  REQUIRED_DOCUMENT_UNAVAILABLE: "REQUIRED_DOCUMENT_UNAVAILABLE",
  REQUIRED_RUNTIME_INPUT_UNAVAILABLE: "REQUIRED_RUNTIME_INPUT_UNAVAILABLE",
  LEGAL_PORTFOLIO_UNAVAILABLE: "LEGAL_PORTFOLIO_UNAVAILABLE",
  REPOSITORY_SNAPSHOT_UNAVAILABLE: "REPOSITORY_SNAPSHOT_UNAVAILABLE",
} as const;
export type BlockerReason =
  (typeof BLOCKER_REASONS)[keyof typeof BLOCKER_REASONS];

export const RULE_DECISION_APPLICABILITIES = {
  APPLICABLE: "APPLICABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type RuleDecisionApplicability =
  (typeof RULE_DECISION_APPLICABILITIES)[keyof typeof RULE_DECISION_APPLICABILITIES];

export const RULE_DECISION_CRITERION_OUTCOMES = {
  MET: "MET",
  NOT_MET: "NOT_MET",
} as const;
export type RuleDecisionCriterionOutcome =
  (typeof RULE_DECISION_CRITERION_OUTCOMES)[keyof typeof RULE_DECISION_CRITERION_OUTCOMES];

export const RULE_DECISION_COMPLIANCE_OUTCOMES = {
  COMPLIANT: "COMPLIANT",
  NON_COMPLIANT: "NON_COMPLIANT",
} as const;
export type RuleDecisionComplianceOutcome =
  (typeof RULE_DECISION_COMPLIANCE_OUTCOMES)[keyof typeof RULE_DECISION_COMPLIANCE_OUTCOMES];

export const HUMAN_RESOLUTION_REQUEST_STATUSES = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  SUPERSEDED: "SUPERSEDED",
  CANCELLED: "CANCELLED",
} as const;
export type HumanResolutionRequestStatus =
  (typeof HUMAN_RESOLUTION_REQUEST_STATUSES)[keyof typeof HUMAN_RESOLUTION_REQUEST_STATUSES];

export const AGENTIC_ASSESSMENT_EVENT_TYPES = {
  ACTIVITY_RECORDED: "ACTIVITY_RECORDED",
  ASSESSMENT_LIFECYCLE_CHANGED: "ASSESSMENT_LIFECYCLE_CHANGED",
  EXECUTION_STATE_CHANGED: "EXECUTION_STATE_CHANGED",
  EVIDENCE_ACCEPTED: "EVIDENCE_ACCEPTED",
  DECISION_ACCEPTED: "DECISION_ACCEPTED",
  HUMAN_RESOLUTION_CHANGED: "HUMAN_RESOLUTION_CHANGED",
  ARTIFACT_CHANGED: "ARTIFACT_CHANGED",
} as const;
export type AssessmentEventType =
  (typeof AGENTIC_ASSESSMENT_EVENT_TYPES)[keyof typeof AGENTIC_ASSESSMENT_EVENT_TYPES];

export const ASSESSMENT_EVENT_ACTOR_TYPES = {
  RUNTIME: "RUNTIME",
  ASSESSMENT_ROOT: "ASSESSMENT_ROOT",
  SUBAGENT: "SUBAGENT",
  TOOL: "TOOL",
  API: "API",
} as const;
export type AssessmentEventActorType =
  (typeof ASSESSMENT_EVENT_ACTOR_TYPES)[keyof typeof ASSESSMENT_EVENT_ACTOR_TYPES];

export const ASSESSMENT_ACTIVITY_KINDS = {
  MODEL: "MODEL",
  TOOL: "TOOL",
  TASK: "TASK",
  DOMAIN: "DOMAIN",
} as const;
export type AssessmentActivityKind =
  (typeof ASSESSMENT_ACTIVITY_KINDS)[keyof typeof ASSESSMENT_ACTIVITY_KINDS];

export const RULE_DECISION_REFERENCE_TYPES = {
  ASSESSMENT_EVIDENCE: "ASSESSMENT_EVIDENCE",
  CONFIRMED_FACT: "CONFIRMED_FACT",
} as const;
export type RuleDecisionReferenceType =
  (typeof RULE_DECISION_REFERENCE_TYPES)[keyof typeof RULE_DECISION_REFERENCE_TYPES];

export const AGENTIC_RUNTIME_TRANSITION_GUARDS = {
  AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT:
    "AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT",
  RUNTIME_EXECUTION_AUTHORITY: "RUNTIME_EXECUTION_AUTHORITY",
  DECISION_COVERAGE_AUTHORITY: "DECISION_COVERAGE_AUTHORITY",
  ARTIFACT_OWNER_AUTHORITY: "ARTIFACT_OWNER_AUTHORITY",
  HUMAN_RESOLUTION_AUTHORITY: "HUMAN_RESOLUTION_AUTHORITY",
  PINNED_RUNTIME_INPUTS_READY: "PINNED_RUNTIME_INPUTS_READY",
  ALL_CHECKPOINT_BLOCKERS_RESOLVED: "ALL_CHECKPOINT_BLOCKERS_RESOLVED",
  SAME_ASSESSMENT_ROOT_THREAD: "SAME_ASSESSMENT_ROOT_THREAD",
  OPEN_MATERIAL_HUMAN_REQUEST: "OPEN_MATERIAL_HUMAN_REQUEST",
  OUTSTANDING_REQUIRED_INPUT: "OUTSTANDING_REQUIRED_INPUT",
  EXPLICIT_SAFE_PAUSE: "EXPLICIT_SAFE_PAUSE",
  COMPLETION_GATE_ZERO_BLOCKERS: "COMPLETION_GATE_ZERO_BLOCKERS",
  ARTIFACT_PERSISTED_AND_VALIDATED: "ARTIFACT_PERSISTED_AND_VALIDATED",
  DEPENDENCY_PERMANENTLY_UNOBTAINABLE: "DEPENDENCY_PERMANENTLY_UNOBTAINABLE",
  EXPLICIT_NEW_RESOLVABLE_INPUT_ACCEPTED:
    "EXPLICIT_NEW_RESOLVABLE_INPUT_ACCEPTED",
  GOVERNED_RETRY: "GOVERNED_RETRY",
  UNRECOVERABLE_RUNTIME_FAILURE: "UNRECOVERABLE_RUNTIME_FAILURE",
  EXPLICIT_CANCELLATION_BEFORE_PUBLICATION:
    "EXPLICIT_CANCELLATION_BEFORE_PUBLICATION",
  ACCEPTED_COMPLETE_RULE_DECISION: "ACCEPTED_COMPLETE_RULE_DECISION",
  VALIDATED_ARTIFACT: "VALIDATED_ARTIFACT",
  VALIDATED_AUDITED_PORTFOLIO_ROLLBACK: "VALIDATED_AUDITED_PORTFOLIO_ROLLBACK",
  VALID_SUFFICIENT_FACT_ANSWER: "VALID_SUFFICIENT_FACT_ANSWER",
  QUESTION_NO_LONGER_MATERIAL: "QUESTION_NO_LONGER_MATERIAL",
  ASSESSMENT_CANCELLED: "ASSESSMENT_CANCELLED",
} as const;
export type AgenticRuntimeTransitionGuard =
  (typeof AGENTIC_RUNTIME_TRANSITION_GUARDS)[keyof typeof AGENTIC_RUNTIME_TRANSITION_GUARDS];

/** Guard names are obligations, not client/agent-supplied attestations.
 * Only the owning server boundary supplies verifiedGuards from authoritative state.
 * Missing guard evidence fails closed; this helper neither writes state nor judges facts.
 */
export type AgenticRuntimeTransitionTable<State extends string> = {
  readonly [From in State]: Readonly<
    Partial<Record<State, readonly AgenticRuntimeTransitionGuard[]>>
  >;
};

export function isAgenticRuntimeTransitionAllowed<State extends string>(
  table: AgenticRuntimeTransitionTable<State>,
  fromState: State,
  toState: State,
  verifiedGuards: readonly AgenticRuntimeTransitionGuard[],
): boolean {
  const guards = table[fromState]?.[toState];
  return (
    Array.isArray(guards) &&
    guards.every((guard) => verifiedGuards.includes(guard))
  );
}

export const ASSESSMENT_LIFECYCLE_TRANSITIONS = {
  [ASSESSMENT_LIFECYCLE_STATES.CREATED]: {
    [ASSESSMENT_LIFECYCLE_STATES.PREPARING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.UNRECOVERABLE_RUNTIME_FAILURE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.PREPARING]: {
    [ASSESSMENT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.OUTSTANDING_REQUIRED_INPUT,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.BLOCKED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DEPENDENCY_PERMANENTLY_UNOBTAINABLE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.UNRECOVERABLE_RUNTIME_FAILURE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.ACTIVE]: {
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.OPEN_MATERIAL_HUMAN_REQUEST,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.OUTSTANDING_REQUIRED_INPUT,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.PAUSED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_SAFE_PAUSE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.FINALIZING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.COMPLETION_GATE_ZERO_BLOCKERS,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.BLOCKED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DEPENDENCY_PERMANENTLY_UNOBTAINABLE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.UNRECOVERABLE_RUNTIME_FAILURE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN]: {
    [ASSESSMENT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.OUTSTANDING_REQUIRED_INPUT,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.PAUSED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_SAFE_PAUSE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.BLOCKED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DEPENDENCY_PERMANENTLY_UNOBTAINABLE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT]: {
    [ASSESSMENT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.OPEN_MATERIAL_HUMAN_REQUEST,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.PAUSED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_SAFE_PAUSE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.BLOCKED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DEPENDENCY_PERMANENTLY_UNOBTAINABLE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.PAUSED]: {
    [ASSESSMENT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.OPEN_MATERIAL_HUMAN_REQUEST,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.OUTSTANDING_REQUIRED_INPUT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.FINALIZING]: {
    [ASSESSMENT_LIFECYCLE_STATES.COMPLETE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_PERSISTED_AND_VALIDATED,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.UNRECOVERABLE_RUNTIME_FAILURE,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.COMPLETE]: {},
  [ASSESSMENT_LIFECYCLE_STATES.BLOCKED]: {
    [ASSESSMENT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_NEW_RESOLVABLE_INPUT_ACCEPTED,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.FAILED]: {
    [ASSESSMENT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.PINNED_RUNTIME_INPUTS_READY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ALL_CHECKPOINT_BLOCKERS_RESOLVED,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.SAME_ASSESSMENT_ROOT_THREAD,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.GOVERNED_RETRY,
    ],
    [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  },
  [ASSESSMENT_LIFECYCLE_STATES.CANCELLED]: {},
} as const satisfies AgenticRuntimeTransitionTable<AssessmentLifecycleState>;

export const AGENT_EXECUTION_TRANSITIONS = {
  [AGENT_EXECUTION_STATES.QUEUED]: {
    [AGENT_EXECUTION_STATES.RUNNING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
  },
  [AGENT_EXECUTION_STATES.RUNNING]: {
    [AGENT_EXECUTION_STATES.INTERRUPTED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.PAUSED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.SUCCEEDED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
  },
  [AGENT_EXECUTION_STATES.INTERRUPTED]: {
    [AGENT_EXECUTION_STATES.RUNNING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.PAUSED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
  },
  [AGENT_EXECUTION_STATES.PAUSED]: {
    [AGENT_EXECUTION_STATES.RUNNING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.FAILED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
    [AGENT_EXECUTION_STATES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.RUNTIME_EXECUTION_AUTHORITY,
    ],
  },
  [AGENT_EXECUTION_STATES.SUCCEEDED]: {},
  [AGENT_EXECUTION_STATES.FAILED]: {},
  [AGENT_EXECUTION_STATES.CANCELLED]: {},
} as const satisfies AgenticRuntimeTransitionTable<AgentExecutionState>;

export const DECISION_RESOLUTION_TRANSITIONS = {
  [DECISION_RESOLUTION_STATES.PENDING]: {
    [DECISION_RESOLUTION_STATES.INVESTIGATING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
    ],
  },
  [DECISION_RESOLUTION_STATES.INVESTIGATING]: {
    [DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
    ],
    [DECISION_RESOLUTION_STATES.RESOLVED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ACCEPTED_COMPLETE_RULE_DECISION,
    ],
    [DECISION_RESOLUTION_STATES.INVALIDATED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
    ],
  },
  [DECISION_RESOLUTION_STATES.WAITING_FOR_INPUT]: {
    [DECISION_RESOLUTION_STATES.INVESTIGATING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
    ],
    [DECISION_RESOLUTION_STATES.RESOLVED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ACCEPTED_COMPLETE_RULE_DECISION,
    ],
    [DECISION_RESOLUTION_STATES.INVALIDATED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
    ],
  },
  [DECISION_RESOLUTION_STATES.RESOLVED]: {
    [DECISION_RESOLUTION_STATES.INVALIDATED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
    ],
  },
  [DECISION_RESOLUTION_STATES.INVALIDATED]: {
    [DECISION_RESOLUTION_STATES.INVESTIGATING]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.DECISION_COVERAGE_AUTHORITY,
    ],
  },
} as const satisfies AgenticRuntimeTransitionTable<DecisionResolutionState>;

export const ARTIFACT_LIFECYCLE_TRANSITIONS = {
  [ARTIFACT_LIFECYCLE_STATES.BUILDING]: {
    [ARTIFACT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_OWNER_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.VALIDATED_ARTIFACT,
    ],
    [ARTIFACT_LIFECYCLE_STATES.INVALID]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_OWNER_AUTHORITY,
    ],
  },
  [ARTIFACT_LIFECYCLE_STATES.ACTIVE]: {
    [ARTIFACT_LIFECYCLE_STATES.SUPERSEDED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_OWNER_AUTHORITY,
    ],
    [ARTIFACT_LIFECYCLE_STATES.INVALID]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_OWNER_AUTHORITY,
    ],
  },
  [ARTIFACT_LIFECYCLE_STATES.SUPERSEDED]: {
    [ARTIFACT_LIFECYCLE_STATES.ACTIVE]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_OWNER_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.VALIDATED_ARTIFACT,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.VALIDATED_AUDITED_PORTFOLIO_ROLLBACK,
    ],
    [ARTIFACT_LIFECYCLE_STATES.INVALID]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_OWNER_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.VALIDATED_AUDITED_PORTFOLIO_ROLLBACK,
    ],
  },
  [ARTIFACT_LIFECYCLE_STATES.INVALID]: {},
} as const satisfies AgenticRuntimeTransitionTable<ArtifactLifecycleState>;

export const HUMAN_RESOLUTION_REQUEST_TRANSITIONS = {
  [HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN]: {
    [HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.HUMAN_RESOLUTION_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.VALID_SUFFICIENT_FACT_ANSWER,
    ],
    [HUMAN_RESOLUTION_REQUEST_STATUSES.SUPERSEDED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.HUMAN_RESOLUTION_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.QUESTION_NO_LONGER_MATERIAL,
    ],
    [HUMAN_RESOLUTION_REQUEST_STATUSES.CANCELLED]: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.HUMAN_RESOLUTION_AUTHORITY,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.ASSESSMENT_CANCELLED,
    ],
  },
  [HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED]: {},
  [HUMAN_RESOLUTION_REQUEST_STATUSES.SUPERSEDED]: {},
  [HUMAN_RESOLUTION_REQUEST_STATUSES.CANCELLED]: {},
} as const satisfies AgenticRuntimeTransitionTable<HumanResolutionRequestStatus>;

const uuidSchema = z.uuid();
const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const identifierSchema = z.string().trim().min(1).max(200);
const privateTextSchema = z.string().trim().min(1).max(10000);

export const assessmentLifecycleStateSchema = z.enum(
  ASSESSMENT_LIFECYCLE_STATES,
);
export const agentExecutionStateSchema = z.enum(AGENT_EXECUTION_STATES);
export const decisionResolutionStateSchema = z.enum(DECISION_RESOLUTION_STATES);
export const artifactLifecycleStateSchema = z.enum(ARTIFACT_LIFECYCLE_STATES);
export const blockerReasonSchema = z.enum(BLOCKER_REASONS);
export const humanResolutionRequestStatusSchema = z.enum(
  HUMAN_RESOLUTION_REQUEST_STATUSES,
);

export const assessmentBlockerSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    reason: z.literal(BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE),
    reference: z.strictObject({ humanResolutionRequestId: uuidSchema }),
  }),
  z.strictObject({
    reason: z.literal(BLOCKER_REASONS.REQUIRED_DOCUMENT_UNAVAILABLE),
    reference: z.strictObject({ documentRequestId: uuidSchema }),
  }),
  z.strictObject({
    reason: z.literal(BLOCKER_REASONS.REQUIRED_RUNTIME_INPUT_UNAVAILABLE),
    reference: z.strictObject({ requiredInputId: uuidSchema }),
  }),
  z.strictObject({
    reason: z.literal(BLOCKER_REASONS.LEGAL_PORTFOLIO_UNAVAILABLE),
    // A dependency may be unobtainable before a version exists. The API verifies
    // the required input's kind and assessment ownership, never inventing a pin.
    reference: z.union([
      z.strictObject({ legalPortfolioVersionId: uuidSchema }),
      z.strictObject({ requiredInputId: uuidSchema }),
    ]),
  }),
  z.strictObject({
    reason: z.literal(BLOCKER_REASONS.REPOSITORY_SNAPSHOT_UNAVAILABLE),
    reference: z.union([
      z.strictObject({ repositorySnapshotId: uuidSchema }),
      z.strictObject({ requiredInputId: uuidSchema }),
    ]),
  }),
]);
export type AssessmentBlocker = z.infer<typeof assessmentBlockerSchema>;

export const assessmentLifecycleSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal(ASSESSMENT_LIFECYCLE_STATES.BLOCKED),
    assessmentRevision: revisionSchema,
    blocker: assessmentBlockerSchema,
  }),
  z.strictObject({
    state: assessmentLifecycleStateSchema.exclude([
      ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
    ]),
    assessmentRevision: revisionSchema,
  }),
]);
export type AssessmentLifecycle = z.infer<typeof assessmentLifecycleSchema>;

export const confirmedFactReferenceSchema = z.strictObject({
  type: z.literal(RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT),
  factId: uuidSchema,
  caseRevision: revisionSchema,
});
export type ConfirmedFactReference = z.infer<
  typeof confirmedFactReferenceSchema
>;

export const ruleDecisionReferenceSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal(RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE),
    evidenceId: uuidSchema,
  }),
  confirmedFactReferenceSchema,
]);
export type RuleDecisionReference = z.infer<typeof ruleDecisionReferenceSchema>;

const decisionReferencesSchema = z.array(ruleDecisionReferenceSchema).min(1);
export const ruleDecisionCriterionSchema = z.strictObject({
  criterionId: identifierSchema,
  outcome: z.enum(RULE_DECISION_CRITERION_OUTCOMES),
  rationale: privateTextSchema,
  references: decisionReferencesSchema,
});
export type RuleDecisionCriterion = z.infer<typeof ruleDecisionCriterionSchema>;

export const ruleDecisionLegalContextReferenceSchema = z.strictObject({
  legalContextId: identifierSchema,
});
export type RuleDecisionLegalContextReference = z.infer<
  typeof ruleDecisionLegalContextReferenceSchema
>;

const decisionScopeShape = {
  engineeringRuleId: identifierSchema,
  engineeringRuleVersion: identifierSchema,
  scopeId: identifierSchema,
  legalPortfolioVersionId: uuidSchema,
  repositorySnapshotId: uuidSchema,
  repositoryCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  caseRevision: revisionSchema,
  legalContextRefs: z.array(ruleDecisionLegalContextReferenceSchema).min(1),
};

/** Root-authored private domain data. Required criterion IDs and reference authority
 * must be checked against the pinned portfolio/ledger by DecisionValidator, not
 * trusted from this packet. No semantic outcome is derived by this schema.
 */
export const ruleDecisionSchema = z
  .discriminatedUnion("applicability", [
    z.strictObject({
      ...decisionScopeShape,
      applicability: z.literal(RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE),
      rationale: privateTextSchema,
      references: decisionReferencesSchema,
      criteria: z.array(ruleDecisionCriterionSchema).length(0),
      compliance: z.null(),
    }),
    z.strictObject({
      ...decisionScopeShape,
      applicability: z.literal(RULE_DECISION_APPLICABILITIES.APPLICABLE),
      rationale: privateTextSchema,
      references: decisionReferencesSchema,
      criteria: z.array(ruleDecisionCriterionSchema).min(1),
      compliance: z.enum(RULE_DECISION_COMPLIANCE_OUTCOMES),
    }),
  ])
  .superRefine((decision, ctx) => {
    if (decision.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE) {
      const hasUnmetCriterion = decision.criteria.some(
        (criterion) =>
          criterion.outcome === RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
      );
      if (
        (decision.compliance ===
          RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT) !==
        hasUnmetCriterion
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["compliance"],
          message:
            "Compliance must cohere with the submitted criterion outcomes",
        });
      }
    }
    if (
      new Set(decision.criteria.map((criterion) => criterion.criterionId))
        .size !== decision.criteria.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Criterion IDs must be unique",
      });
    }
    for (const reference of [
      ...decision.references,
      ...decision.criteria.flatMap((criterion) => criterion.references),
    ]) {
      if (
        reference.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT &&
        reference.caseRevision !== decision.caseRevision
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["references"],
          message: "Fact revision must match decision case revision",
        });
      }
    }
  });
export type RuleDecision = z.infer<typeof ruleDecisionSchema>;

const humanQuestionShape = {
  engineeringRuleId: identifierSchema,
  criterionIds: z.array(identifierSchema),
  question: privateTextSchema,
  unresolvedFact: privateTextSchema,
  decisionImpact: z.array(privateTextSchema).min(1),
  resolutionAttempts: z.array(privateTextSchema).min(1),
  controlType: identifierSchema,
  choices: z.array(
    z.strictObject({
      value: identifierSchema,
      label: privateTextSchema,
    }),
  ),
};

/** Root proposes a material fact question after investigation. API supplies all
 * identities and validates privacy, authority, current revision and provenance.
 */
export const openHumanResolutionRequestSchema = z.strictObject({
  ...humanQuestionShape,
  expectedCaseRevision: revisionSchema,
});
export type OpenHumanResolutionRequest = z.infer<
  typeof openHumanResolutionRequestSchema
>;

/** An answer supplies facts only, never a verdict or request/lifecycle status.
 * doesNotKnow=true is recorded without resolving the OPEN request. A known answer
 * still requires server validation of sufficiency before resolution.
 */
export const answerHumanResolutionRequestSchema = z.discriminatedUnion(
  "doesNotKnow",
  [
    z.strictObject({
      expectedCaseRevision: revisionSchema,
      doesNotKnow: z.literal(true),
    }),
    z.strictObject({
      expectedCaseRevision: revisionSchema,
      doesNotKnow: z.literal(false),
      answer: privateTextSchema,
    }),
  ],
);
export type AnswerHumanResolutionRequest = z.infer<
  typeof answerHumanResolutionRequestSchema
>;

const humanResolutionAnswerSchema = z.discriminatedUnion("doesNotKnow", [
  z.strictObject({
    doesNotKnow: z.literal(true),
    answeredAt: z.iso.datetime(),
  }),
  z.strictObject({
    doesNotKnow: z.literal(false),
    answer: privateTextSchema,
    answeredAt: z.iso.datetime(),
  }),
]);

const humanRequestShape = {
  ...humanQuestionShape,
  requestId: uuidSchema,
  assessmentId: uuidSchema,
  threadId: uuidSchema,
  caseRevision: revisionSchema,
  createdAt: z.iso.datetime(),
};
export const humanResolutionRequestSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...humanRequestShape,
      status: z.literal(HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED),
      answers: z.array(humanResolutionAnswerSchema).min(1),
      resolvedFactRef: confirmedFactReferenceSchema,
      resolvedAt: z.iso.datetime(),
    }),
    z.strictObject({
      ...humanRequestShape,
      answers: z.array(humanResolutionAnswerSchema),
      status: humanResolutionRequestStatusSchema.exclude([
        HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
      ]),
    }),
  ])
  .superRefine((request, ctx) => {
    if (
      request.status === HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED &&
      request.resolvedFactRef.caseRevision !== request.caseRevision
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["resolvedFactRef", "caseRevision"],
        message: "Resolved fact revision must match request case revision",
      });
    }
    if (
      request.answers.at(-1)?.doesNotKnow === true &&
      request.status === HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "An unknown answer cannot resolve the request",
      });
    }
  });
export type HumanResolutionRequest = z.infer<
  typeof humanResolutionRequestSchema
>;

/** Customer-safe activity uses a catalog key, not free-form agent/provider text. */
export const assessmentActivityPayloadSchema = z.strictObject({
  kind: z.enum(ASSESSMENT_ACTIVITY_KINDS),
  labelKey: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/)
    .max(200),
});
export type AssessmentActivityPayload = z.infer<
  typeof assessmentActivityPayloadSchema
>;

// Topology checks for persisted events do not re-run historical server guards.
function hasTransition<State extends string>(
  table: AgenticRuntimeTransitionTable<State>,
  fromState: State,
  toState: State,
): boolean {
  return (
    Object.hasOwn(table, fromState) && Object.hasOwn(table[fromState], toState)
  );
}

const lifecycleChangeShape = {
  fromState: assessmentLifecycleStateSchema,
  assessmentRevision: revisionSchema,
};
export const assessmentLifecycleChangedPayloadSchema = z
  .discriminatedUnion("toState", [
    z.strictObject({
      ...lifecycleChangeShape,
      toState: z.literal(ASSESSMENT_LIFECYCLE_STATES.BLOCKED),
      blocker: assessmentBlockerSchema,
    }),
    z.strictObject({
      ...lifecycleChangeShape,
      toState: assessmentLifecycleStateSchema.exclude([
        ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
      ]),
    }),
  ])
  .refine(
    (value) =>
      hasTransition<AssessmentLifecycleState>(
        ASSESSMENT_LIFECYCLE_TRANSITIONS,
        value.fromState,
        value.toState,
      ),
    {
      message: "Illegal assessment lifecycle transition",
    },
  );

export const executionStateChangedPayloadSchema = z
  .strictObject({
    fromState: agentExecutionStateSchema,
    toState: agentExecutionStateSchema,
  })
  .refine(
    (value) =>
      hasTransition<AgentExecutionState>(
        AGENT_EXECUTION_TRANSITIONS,
        value.fromState,
        value.toState,
      ),
    {
      message:
        "Illegal execution transition; retry requires a new execution ID",
    },
  );

export const humanResolutionChangedPayloadSchema = z
  .strictObject({
    requestId: uuidSchema,
    fromStatus: humanResolutionRequestStatusSchema.nullable(),
    toStatus: humanResolutionRequestStatusSchema,
    caseRevision: revisionSchema,
  })
  .refine(
    (value) =>
      value.fromStatus === null
        ? value.toStatus === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN
        : hasTransition<HumanResolutionRequestStatus>(
            HUMAN_RESOLUTION_REQUEST_TRANSITIONS,
            value.fromStatus,
            value.toStatus,
          ),
    {
      message: "Illegal human request transition",
    },
  );

export const artifactChangedPayloadSchema = z
  .strictObject({
    artifactId: uuidSchema,
    fromState: artifactLifecycleStateSchema.nullable(),
    toState: artifactLifecycleStateSchema,
  })
  .refine(
    (value) =>
      value.fromState === null
        ? value.toState === ARTIFACT_LIFECYCLE_STATES.BUILDING
        : hasTransition<ArtifactLifecycleState>(
            ARTIFACT_LIFECYCLE_TRANSITIONS,
            value.fromState,
            value.toState,
          ),
    {
      message: "Illegal artifact transition",
    },
  );

export const assessmentEventTokenUsageSchema = z
  .strictObject({
    invocationId: identifierSchema,
    promptTokens: revisionSchema,
    completionTokens: revisionSchema,
    totalTokens: revisionSchema,
    cost: z.number().nonnegative().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .refine(
    (value) => (value.cost === undefined) === (value.currency === undefined),
    {
      message: "Cost and currency must be supplied together",
    },
  );
export type AssessmentEventTokenUsage = z.infer<
  typeof assessmentEventTokenUsageSchema
>;

/** Output-only server envelope. Never use this schema as command ingress.
 * API constructs identity/order/actor fields from authenticated persisted state;
 * UUID syntax is not proof of ownership. Usage comes only from trusted metrics.
 */
const assessmentEventEnvelopeShape = {
  eventId: uuidSchema,
  assessmentId: uuidSchema,
  threadId: uuidSchema,
  sequence: revisionSchema,
  timestamp: z.iso.datetime(),
  actorType: z.enum(ASSESSMENT_EVENT_ACTOR_TYPES),
  executionId: uuidSchema.optional(),
  parentExecutionId: uuidSchema.optional(),
  taskId: identifierSchema.optional(),
  toolCallId: identifierSchema.optional(),
  tokenUsage: assessmentEventTokenUsageSchema.optional(),
  technicalDetailsRef: uuidSchema.optional(),
};

const assessmentEventBodySchema = z
  .discriminatedUnion("eventType", [
    z.strictObject({
      ...assessmentEventEnvelopeShape,
      eventType: z.literal(AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED),
      payload: assessmentActivityPayloadSchema,
    }),
    z.strictObject({
      ...assessmentEventEnvelopeShape,
      actorType: z.literal(ASSESSMENT_EVENT_ACTOR_TYPES.API),
      eventType: z.literal(
        AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
      ),
      payload: assessmentLifecycleChangedPayloadSchema,
    }),
    z.strictObject({
      ...assessmentEventEnvelopeShape,
      actorType: z.literal(ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME),
      executionId: uuidSchema,
      eventType: z.literal(
        AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
      ),
      payload: executionStateChangedPayloadSchema,
    }),
    z.strictObject({
      ...assessmentEventEnvelopeShape,
      actorType: z.literal(ASSESSMENT_EVENT_ACTOR_TYPES.API),
      eventType: z.literal(AGENTIC_ASSESSMENT_EVENT_TYPES.EVIDENCE_ACCEPTED),
      payload: z.strictObject({
        evidenceId: uuidSchema,
        caseRevision: revisionSchema,
      }),
    }),
    z.strictObject({
      ...assessmentEventEnvelopeShape,
      actorType: z.literal(ASSESSMENT_EVENT_ACTOR_TYPES.API),
      eventType: z.literal(AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED),
      payload: z.strictObject({
        decisionId: uuidSchema,
        engineeringRuleId: identifierSchema,
        decisionRevision: revisionSchema,
      }),
    }),
    z.strictObject({
      ...assessmentEventEnvelopeShape,
      actorType: z.literal(ASSESSMENT_EVENT_ACTOR_TYPES.API),
      eventType: z.literal(
        AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
      ),
      payload: humanResolutionChangedPayloadSchema,
    }),
    z.strictObject({
      ...assessmentEventEnvelopeShape,
      actorType: z.literal(ASSESSMENT_EVENT_ACTOR_TYPES.API),
      eventType: z.literal(AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED),
      payload: artifactChangedPayloadSchema,
    }),
  ])
  .superRefine((event, ctx) => {
    const isChild =
      event.actorType === ASSESSMENT_EVENT_ACTOR_TYPES.SUBAGENT ||
      event.parentExecutionId !== undefined ||
      event.taskId !== undefined;
    if (
      isChild &&
      (!event.executionId || !event.parentExecutionId || !event.taskId)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Child events require executionId, parentExecutionId and taskId",
      });
    }
    if (event.executionId && event.executionId === event.parentExecutionId) {
      ctx.addIssue({
        code: "custom",
        path: ["parentExecutionId"],
        message: "An execution cannot be its own parent",
      });
    }
  });
// Preserve required SUBAGENT lineage in the TypeScript type as well as validation.
export const assessmentEventSchema = assessmentEventBodySchema.and(
  z.discriminatedUnion("actorType", [
    z.object({
      actorType: z.literal(ASSESSMENT_EVENT_ACTOR_TYPES.SUBAGENT),
      executionId: uuidSchema,
      parentExecutionId: uuidSchema,
      taskId: identifierSchema,
    }),
    z.object({
      actorType: z
        .enum(ASSESSMENT_EVENT_ACTOR_TYPES)
        .exclude([ASSESSMENT_EVENT_ACTOR_TYPES.SUBAGENT]),
    }),
  ]),
);
export type AssessmentEvent = z.infer<typeof assessmentEventSchema>;
