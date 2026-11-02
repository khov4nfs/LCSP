import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  DECISION_RESOLUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  assessmentEventSchema,
  type AgentExecutionState,
  type AssessmentEvent,
  type AssessmentLifecycleState,
  type HumanResolutionRequestStatus,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  assessmentDetailSchema,
  assessmentHumanRequestViewSchema,
  type AssessmentDetail,
  type AssessmentHumanRequestView,
} from "@lcsp/contracts/assessment-domain";

export const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";
export const THREAD_ID = "22222222-2222-4222-8222-222222222222";
export const EXECUTION_ID = "33333333-3333-4333-8333-333333333333";
export const RULE_SET_ID = "44444444-4444-4444-8444-444444444444";
export const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
export const DECISION_ID = "66666666-6666-4666-8666-666666666666";
export const ARTIFACT_ID = "77777777-7777-4777-8777-777777777777";
export const EVIDENCE_ID = "88888888-8888-4888-8888-888888888888";
export const SNAPSHOT_ID = "99999999-9999-4999-8999-999999999999";
export const COMMIT = `c14f518${"0".repeat(33)}`;

const LABELS = ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (seconds: number) =>
  new Date(Date.UTC(2026, 9, 11, 10, 0, seconds)).toISOString();

/** Builds events the way the API emits them, validated against the canonical contract. */
export const events = {
  lifecycle(
    sequence: number,
    seconds: number,
    fromState: AssessmentLifecycleState,
    toState: AssessmentLifecycleState,
    blocker?: unknown,
  ): AssessmentEvent {
    return assessmentEventSchema.parse({
      eventId: uuid(sequence),
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence,
      timestamp: at(seconds),
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
      payload: {
        fromState,
        toState,
        assessmentRevision: sequence,
        ...(blocker ? { blocker } : {}),
      },
    });
  },
  execution(
    sequence: number,
    seconds: number,
    fromState: AgentExecutionState,
    toState: AgentExecutionState,
  ): AssessmentEvent {
    return assessmentEventSchema.parse({
      eventId: uuid(sequence),
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence,
      timestamp: at(seconds),
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
      executionId: EXECUTION_ID,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
      payload: { fromState, toState },
    });
  },
  activity(
    sequence: number,
    seconds: number,
    labelKey: string,
    usage?: { id: string; input: number; output: number },
  ): AssessmentEvent {
    return assessmentEventSchema.parse({
      eventId: uuid(sequence),
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence,
      timestamp: at(seconds),
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.ASSESSMENT_ROOT,
      executionId: EXECUTION_ID,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
      payload: { kind: "MODEL", labelKey },
      ...(usage
        ? {
            tokenUsage: {
              invocationId: usage.id,
              promptTokens: usage.input,
              completionTokens: usage.output,
              totalTokens: usage.input + usage.output,
            },
          }
        : {}),
    });
  },
  humanOpened(sequence: number, seconds: number): AssessmentEvent {
    return assessmentEventSchema.parse({
      eventId: uuid(sequence),
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence,
      timestamp: at(seconds),
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED,
      payload: {
        requestId: REQUEST_ID,
        fromStatus: null,
        toStatus: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
        caseRevision: 1,
      },
    });
  },
  decision(sequence: number, seconds: number): AssessmentEvent {
    return assessmentEventSchema.parse({
      eventId: uuid(sequence),
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence,
      timestamp: at(seconds),
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED,
      payload: {
        decisionId: DECISION_ID,
        assessmentRuleId: "ER-RET",
        decisionRevision: 1,
      },
    });
  },
};

export const LABEL = LABELS;

export function request(
  status: HumanResolutionRequestStatus = HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
  overrides: Partial<AssessmentHumanRequestView> = {},
): AssessmentHumanRequestView {
  return assessmentHumanRequestViewSchema.parse({
    requestId: REQUEST_ID,
    requestRevision: 1,
    openedCaseRevision: 1,
    status,
    checkpointId: null,
    resolvedFactId: null,
    answers: [],
    assessmentRuleId: "ER-RET",
    criterionIds: ["C-1"],
    question: "Is the service publicly accessible?",
    unresolvedFact: "Whether the service is reachable from the internet.",
    decisionImpact: ["Decides whether the retention duty applies."],
    resolutionAttempts: ["Searched deployment manifests."],
    controlType: HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT,
    choices: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
    ...overrides,
  });
}

type DetailOptions = {
  lifecycle?: AssessmentLifecycleState;
  execution?: AgentExecutionState;
  decisions?: boolean;
  artifact?: boolean;
  usage?: { invocationCount: number; totalTokens: number; partial?: boolean };
  resolved?: number;
};

export function detail(options: DetailOptions = {}): AssessmentDetail {
  const lifecycle = options.lifecycle ?? ASSESSMENT_LIFECYCLE_STATES.ACTIVE;
  const decision = {
    decisionId: DECISION_ID,
    assessmentId: ASSESSMENT_ID,
    assessmentRuleId: "ER-RET",
    scopeId: "ASSESSMENT",
    decisionRevision: 1,
    state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
    createdAt: at(40),
    decision: {
      assessmentRuleId: "ER-RET",
      assessmentRuleVersion: "2026.10",
      ruleSetVersionId: RULE_SET_ID,
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
      scopeId: "ASSESSMENT",
      caseRevision: 1,
      legalContextRefs: [{ legalContextId: "LC-1" }],
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
      rationale:
        "Deletion is based on the draft timestamp instead of the receipt timestamp.",
      references: [
        {
          type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
          evidenceId: EVIDENCE_ID,
        },
      ],
      criteria: [
        {
          criterionId: "C-1",
          outcome: RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
          rationale: "Retention uses the wrong timestamp.",
          references: [
            {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_ID,
            },
          ],
        },
      ],
    },
  };
  return assessmentDetailSchema.parse({
    assessment_id: ASSESSMENT_ID,
    name: "Synthetic notice service",
    owner_id: "owner-1",
    lifecycle:
      lifecycle === ASSESSMENT_LIFECYCLE_STATES.BLOCKED
        ? {
            state: lifecycle,
            assessmentRevision: 3,
            blocker: {
              reason: "COMPLIANCE_RULE_SET_UNAVAILABLE",
              reference: { requiredInputId: REQUEST_ID },
            },
          }
        : { state: lifecycle, assessmentRevision: 3 },
    runtime: {
      threadId: THREAD_ID,
      rootAgentVersion: "root-1",
      checkpointNamespace: "88888888-8888-4888-8888-888888888889",
      checkpointId: "ckpt-1",
      currentExecutionId: EXECUTION_ID,
      executionState: options.execution ?? AGENT_EXECUTION_STATES.RUNNING,
      eventSequence: 12,
      startedAt: at(0),
      lastResumedAt: null,
      updatedAt: at(50),
    },
    usage: options.usage ? { partial: false, ...options.usage } : undefined,
    case: {
      caseRevision: 1,
      auditRequestRevision: 0,
      auditMode: ASSESSMENT_AUDIT_MODES.LEGACY_FULL,
      ruleSetVersionId: RULE_SET_ID,
      ruleSet: {
        ruleSetVersionId: RULE_SET_ID,
        version: "2026.10.p1",
        legalSourceVersion: "2026.10",
        legalRequirementCount: 37,
        assessmentRuleCount: 62,
      },
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryScanJobId: "job-1",
      repositoryCommit: COMMIT,
      coverage: [
        {
          assessmentRuleId: "ER-RET",
          assessmentRuleVersion: "2026.10",
          concept: "Notice retention",
          resolutionState: options.decisions
            ? DECISION_RESOLUTION_STATES.RESOLVED
            : DECISION_RESOLUTION_STATES.PENDING,
          currentDecisionId: options.decisions ? DECISION_ID : null,
          decisionRevision: options.decisions ? 1 : 0,
        },
        {
          assessmentRuleId: "ER-DEF",
          assessmentRuleVersion: "2026.10",
          concept: "Notice definition",
          resolutionState: DECISION_RESOLUTION_STATES.PENDING,
          currentDecisionId: null,
          decisionRevision: 0,
        },
      ],
      decisions: options.decisions ? [decision] : [],
      facts: [],
      artifacts: options.artifact
        ? [
            {
              artifactId: ARTIFACT_ID,
              kind: "FINAL_REPORT",
              lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
              ruleSetVersionId: RULE_SET_ID,
              repositorySnapshotId: SNAPSHOT_ID,
              repositoryCommit: COMMIT,
              caseRevision: 1,
              contentSha256: "a".repeat(64),
              sizeBytes: 1024,
              createdAt: at(60),
            },
          ]
        : [],
    },
    created_at: at(0),
    updated_at: at(60),
    correlationId: "corr-1",
  });
}
