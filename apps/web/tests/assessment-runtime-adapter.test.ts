import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_CONTEXT_UPDATE_SOURCES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { PROGRAM_EVIDENCE_METRIC_FORMATS } from "../src/features/assessment-flow/types/assessment-flow.types.ts";

import {
  ASSESSMENT_ARTIFACT_AVAILABILITIES,
  ASSESSMENT_RUNTIME_AVAILABILITIES,
  ASSESSMENT_SCREEN_PROJECTIONS,
  ASSESSMENT_SIDEBAR_STATUSES,
  ASSESSMENT_SIDEBAR_WORKFLOW_STAGES,
  NORMALIZED_WORKFLOW_STEP_STATUSES,
} from "../src/features/workspace/types/assessment-runtime-adapter.types.ts";
import { normalizeAssessmentRuntime } from "../src/features/workspace/utils/assessment-runtime-adapter.ts";
import {
  selectArtifactPresentation,
  selectAssessmentRuntimeSidebarPresentation,
  selectAssessmentScreenProjection,
  selectComposerAvailability,
  selectCustomerActions,
  selectInterviewHandoffPresentation,
  selectInterviewPresentation,
  selectRightSidebarPresentation,
  selectWorkflowPresentation,
} from "../src/features/workspace/utils/assessment-runtime-selectors.ts";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeRepositorySnapshot,
  type WorkspaceRuntimeAssessmentTimeline,
} from "../src/features/workspace/types/workspace-runtime.types.ts";

test("1. MAINLINE — READY coverage + WAITING_FOR_CUSTOMER question", () => {
  const interviewInput: AssessmentInterviewRuntimeState = {
    outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
    activeQuestion: {
      id: "q-mainline",
      intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
      control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
      prompt: "What is the primary purpose of this service?",
    },
    audit: {
      authenticatedActorId: "usr-42",
      timestamp: "2026-09-05T08:00:00.000Z",
      assessmentId: "asm-1",
      sourceVersion: "git:abc1234",
      pgeVersion: "pge-v1",
      sessionId: "ses-1",
      turnId: "turn-1",
      contextRevision: 1,
    },
  };

  const timelineInput: WorkspaceRuntimeAssessmentTimeline = {
    currentRun: {
      assessmentId: "asm-1",
      runId: "run-1",
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      activeTools: [
        {
          toolName: "interview_agent",
          status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
          summary: "Gathering initial business context",
          startedAt: "2026-09-05T08:00:00.000Z",
          attempt: 1,
        },
      ],
      updatedAt: "2026-09-05T08:00:00.000Z",
    },
    recentActivity: [],
    latestRunId: "run-1",
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    lastEmittedAt: "2026-09-05T08:00:00.000Z",
  };

  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-1",
    interviewState: interviewInput,
    timeline: timelineInput,
  });

  assert.equal(
    normalized.availability,
    ASSESSMENT_RUNTIME_AVAILABILITIES.ready,
  );
  assert.equal(
    normalized.coverage.state,
    ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
  );
  assert.equal(
    normalized.interview.outcome,
    ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
  );
  assert.equal(normalized.interview.activeQuestion?.id, "q-mainline");

  const chat = selectInterviewPresentation(normalized);
  assert.equal(chat.hasActiveQuestion, true);
  assert.equal(chat.isWaitingForCustomer, true);

  const actions = selectCustomerActions(normalized);
  assert.equal(actions.canAnswerQuestion, true);
  assert.equal(actions.canSubmitDraft, true);

  const artifacts = selectArtifactPresentation(normalized);
  assert.equal(
    artifacts.programEvidenceGraph.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable,
  );
  assert.equal(
    artifacts.businessContext.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting,
  );
});

test("production sidebar normalization preserves repository metadata and canonical workflow order", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-sidebar",
    timeline: {
      currentRun: null,
      recentActivity: [],
      latestRunId: null,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: null,
      repositorySnapshot: repositorySnapshot({ branch: "develop" }),
    },
  });

  assert.deepEqual(normalized.repository, {
    provider: "GITHUB",
    repositoryFullName: "khovan123/LCSP",
    branch: "develop",
    pinnedCommit: "e5e2118fd03b",
    sourceState: "AVAILABLE",
  });
  assert.deepEqual(
    normalized.workflow.steps.map((step) => step.id),
    ["REPOSITORY", "SCANNER", "INTERVIEW", "RULES", "PLANNER", "INVESTIGATE", "GATE"],
  );
  assert.equal(
    normalized.workflow.steps[0]?.status,
    NORMALIZED_WORKFLOW_STEP_STATUSES.completed,
  );
  assert.equal(
    normalized.workflow.steps[1]?.status,
    NORMALIZED_WORKFLOW_STEP_STATUSES.queued,
  );
});

test("LCSP-272 right sidebar projects F03 scanner-running state without fabricated data", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-sidebar-f03",
    timeline: scannerTimeline("asm-sidebar-f03"),
  });
  const sidebar = selectAssessmentRuntimeSidebarPresentation(normalized, {
    repository: repositorySnapshot({ branch: null }),
    scanner: {
      evidenceAccepted: false,
      scanFailed: false,
      programEvidenceSummary: {
        servicesScanned: {
          value: null,
          format: PROGRAM_EVIDENCE_METRIC_FORMATS.count,
        },
        codeSymbolsIndexed: {
          value: 215,
          format: PROGRAM_EVIDENCE_METRIC_FORMATS.count,
        },
        aiProviderCallPaths: {
          value: 13,
          format: PROGRAM_EVIDENCE_METRIC_FORMATS.count,
        },
        evidenceMappedScope: {
          value: 71,
          format: PROGRAM_EVIDENCE_METRIC_FORMATS.percent,
        },
      },
    },
  });

  assert.deepEqual(sidebar.repository, {
    repositoryFullName: "khovan123/LCSP",
    branch: null,
    commitSha: "e5e2118fd03b",
  });
  assert.equal(
    sidebar.workflow.find(
      (item) => item.id === ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner,
    )?.status,
    ASSESSMENT_SIDEBAR_STATUSES.running,
  );
  for (const stage of [
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.rules,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.planner,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.investigate,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate,
  ]) {
    assert.equal(
      sidebar.workflow.find((item) => item.id === stage)?.status,
      ASSESSMENT_SIDEBAR_STATUSES.queued,
    );
  }
  assert.equal(sidebar.artifacts[0]?.artifact.id, "program-evidence-graph");
  assert.equal(
    sidebar.artifacts[0]?.status,
    ASSESSMENT_SIDEBAR_STATUSES.building,
  );
  assert.equal(sidebar.artifacts[0]?.descriptionParams, undefined);
  assert.equal(sidebar.artifacts[1]?.id, "collected-evidence");
  assert.equal(
    sidebar.artifacts[1]?.status,
    ASSESSMENT_SIDEBAR_STATUSES.running,
  );
});

test("LCSP-272 right sidebar projects F04 scanner-passed and interview-running state", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-sidebar-f04",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-project-context",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Describe this project or system.",
      },
    },
    timeline: scannerTimeline("asm-sidebar-f04"),
  });
  const sidebar = selectAssessmentRuntimeSidebarPresentation(normalized, {
    repository: repositorySnapshot({ branch: "feat/runtime-sidebar" }),
    scanner: {
      evidenceAccepted: true,
      scanFailed: false,
    },
  });

  assert.deepEqual(sidebar.repository, {
    repositoryFullName: "khovan123/LCSP",
    branch: "feat/runtime-sidebar",
    commitSha: "e5e2118fd03b",
  });
  assert.equal(
    sidebar.workflow.find(
      (item) => item.id === ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner,
    )?.status,
    ASSESSMENT_SIDEBAR_STATUSES.passed,
  );
  assert.equal(
    sidebar.workflow.find(
      (item) => item.id === ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview,
    )?.status,
    ASSESSMENT_SIDEBAR_STATUSES.running,
  );
  assert.equal(sidebar.artifacts[0]?.artifact.id, "program-evidence-graph");
  assert.equal(sidebar.artifacts[0]?.status, ASSESSMENT_SIDEBAR_STATUSES.ready);
  assert.equal(sidebar.artifacts[1]?.artifact.id, "business-context");
  assert.equal(
    sidebar.artifacts[1]?.status,
    ASSESSMENT_SIDEBAR_STATUSES.waiting,
  );
  assert.equal(
    sidebar.artifactSummaryKey,
    "pages.appShell.assessmentSidebar.artifactSummary.readyWaiting",
  );
});

test("2. PARTIAL — PERMITTED: coverage remains PARTIAL and interview proceeds according to policy", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-2",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-partial",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        prompt: "Select deployment model",
        choices: [{ id: "c1", label: "Cloud" }],
      },
    },
    coverageOverride: {
      state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial,
      limitations: ["Incomplete static analysis on secondary package"],
      policyDecision: {
        permittedForInterview: true,
        policyDecisionRef: "pol-rec-1",
        policyVersion: "1.0",
      },
    },
  });

  assert.equal(
    normalized.coverage.state,
    ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial,
  );
  assert.deepEqual(normalized.coverage.limitations, [
    "Incomplete static analysis on secondary package",
  ]);
  assert.equal(normalized.coverage.policyDecision?.permittedForInterview, true);

  const actions = selectCustomerActions(normalized);
  assert.equal(actions.canAnswerQuestion, true);
});

test("3. PARTIAL — NOT PERMITTED: actions disabled when policy denies interview", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-3",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-denied",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Prompt that should not be answered",
      },
    },
    coverageOverride: {
      state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial,
      limitations: ["Critical AST parse failure"],
      policyDecision: {
        permittedForInterview: false,
        policyDecisionRef: "pol-deny-1",
        policyVersion: "1.0",
      },
      recoveryReason: "Awaiting manual scanner rerun",
    },
  });

  assert.equal(
    normalized.coverage.state,
    ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial,
  );
  assert.equal(
    normalized.coverage.policyDecision?.permittedForInterview,
    false,
  );

  const actions = selectCustomerActions(normalized);
  assert.equal(actions.canAnswerQuestion, false);
  assert.equal(actions.canSubmitDraft, false);
});

test("4. UNAVAILABLE: technical coverage is unavailable without fabricated question", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-4",
    coverageOverride: {
      state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
      recoveryReason: "Repository inaccessible",
    },
  });

  assert.equal(
    normalized.coverage.state,
    ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
  );
  assert.equal(normalized.coverage.recovery.isUnavailable, true);
  assert.equal(normalized.coverage.recovery.reason, "Repository inaccessible");
  assert.equal(normalized.interview.activeQuestion, null);
  assert.equal(normalized.customerActions.canAnswerQuestion, false);
});

test("5. WAITING_FOR_CUSTOMER: preserves ASK + FREE_TEXT direct mapping", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-5",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-free",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Describe service architecture",
      },
    },
  });

  const chat = selectInterviewPresentation(normalized);
  assert.equal(chat.isWaitingForCustomer, true);
  assert.equal(
    chat.activeQuestion?.intent,
    ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
  );
  assert.equal(
    chat.activeQuestion?.control,
    ASSESSMENT_INTERVIEW_CONTROLS.freeText,
  );
});

test("6. ASK + SINGLE_SELECT: preserves choices and exact order without rewriting", () => {
  const choices = [
    { id: "opt-1", label: "Option One", description: "First choice" },
    { id: "opt-2", label: "Option Two", description: "Second choice" },
    { id: "opt-3", label: "Other", requiresFreeText: true },
  ];

  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-6",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-single",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        prompt: "Choose an option",
        choices,
      },
    },
  });

  assert.deepEqual(normalized.interview.activeQuestion?.choices, choices);
});

test("7. CLARIFY: intent remains CLARIFY and is not transformed to ASK", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-7",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-clarify",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Could you clarify the user role hierarchy?",
        priorAnswerSummary: "Previous statement was ambiguous",
      },
    },
  });

  assert.equal(
    normalized.interview.activeQuestion?.intent,
    ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
  );
  assert.equal(
    normalized.interview.activeQuestion?.priorAnswerSummary,
    "Previous statement was ambiguous",
  );
});

test("8. BOOLEAN: response control remains BOOLEAN", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-8",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-bool",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
        prompt: "Does this component process payment data directly?",
      },
    },
  });

  assert.equal(
    normalized.interview.activeQuestion?.control,
    ASSESSMENT_INTERVIEW_CONTROLS.boolean,
  );
});

test("9. MULTI_SELECT: preserves MULTI_SELECT control and choice list", () => {
  const choices = [
    { id: "role-admin", label: "Administrator" },
    { id: "role-analyst", label: "Analyst" },
    { id: "role-customer", label: "End Customer" },
  ];

  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-9",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-multi",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
        prompt: "Select all relevant user roles",
        choices,
      },
    },
  });

  assert.equal(
    normalized.interview.activeQuestion?.control,
    ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
  );
  assert.deepEqual(normalized.interview.activeQuestion?.choices, choices);
});

test("10. CONFIRM / ADJUST: runtime control CONFIRM_ADJUST preserved without frontend invention", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-10",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-confirm-adjust",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
        prompt: "Please confirm or adjust the inferred classification",
        priorAnswerSummary: "Inferred as Level 2 data processor",
      },
    },
  });

  assert.equal(
    normalized.interview.activeQuestion?.control,
    ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
  );
});

test("11. CONTEXT_READY: maps distinctly with no active question", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-11",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
    },
  });

  const chat = selectInterviewPresentation(normalized);
  assert.equal(chat.isContextReady, true);
  assert.equal(chat.hasActiveQuestion, false);
  assert.equal(chat.activeQuestion, null);
  assert.equal(chat.isWaitingForCustomer, false);
});

test("12. CONTEXT_RESOLVED: targeted resolution preserves context revision and metadata", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-12",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
      contextRevision: 4,
      audit: {
        authenticatedActorId: "usr-99",
        timestamp: "2026-09-05T09:00:00.000Z",
        assessmentId: "asm-12",
        sourceVersion: "git:def5678",
        pgeVersion: "pge-v2",
        sessionId: "ses-12",
        turnId: "turn-5",
        contextRevision: 4,
        priorRevision: 3,
        newRevision: 4,
      },
    },
  });

  const chat = selectInterviewPresentation(normalized);
  assert.equal(chat.isContextResolved, true);
  assert.equal(normalized.identity.contextRevision, 4);
  assert.equal(normalized.identity.priorRevision, 3);
  assert.equal(normalized.identity.newRevision, 4);
});

test("13. BLOCKED_OR_UNRESOLVED: distinct from FAILED and exposes exactly 3 approved semantic actions", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-13",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
      blockedActions: [
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
      ],
    },
  });

  const chat = selectInterviewPresentation(normalized);
  assert.equal(chat.isBlocked, true);
  assert.equal(chat.isFailed, false);

  const actions = selectCustomerActions(normalized);
  assert.equal(actions.canSubmitBlockedAction, true);
  assert.deepEqual(actions.availableBlockedActions, [
    ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
    ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
    ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
  ]);
});

test("14. FAILED: distinct runtime failure state with blocked actions denied", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-14",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.failed,
    },
  });

  const chat = selectInterviewPresentation(normalized);
  assert.equal(chat.isFailed, true);
  assert.equal(chat.isBlocked, false);

  const actions = selectCustomerActions(normalized);
  assert.equal(actions.canSubmitBlockedAction, false);
  assert.equal(actions.availableBlockedActions.length, 0);
});

test("15. INVALID QUESTION INVARIANT: activeQuestion with CONTEXT_READY produces contract error", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-15",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
      activeQuestion: {
        id: "q-illegal",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Illegal prompt with CONTEXT_READY",
      },
    },
  });

  assert.equal(
    normalized.availability,
    ASSESSMENT_RUNTIME_AVAILABILITIES.invalid,
  );
  assert.equal(normalized.integration.isContractValid, false);
  assert.ok(
    normalized.integration.contractErrors.some((err) =>
      err.includes("Invalid interview invariant"),
    ),
  );
  // Does not silently expose activeQuestion to UI
  assert.equal(normalized.interview.activeQuestion, null);
});

test("16. CONTEXT AUTHORITY: provisional customer states are never promoted to CONFIRMED", () => {
  const stated = normalizeAssessmentRuntime({
    assessmentId: "asm-16-a",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
    },
  });
  assert.equal(
    stated.interview.contextAuthority,
    ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
  );

  const uncertain = normalizeAssessmentRuntime({
    assessmentId: "asm-16-b",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.uncertain,
    },
  });
  assert.equal(
    uncertain.interview.contextAuthority,
    ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.uncertain,
  );

  const conflicted = normalizeAssessmentRuntime({
    assessmentId: "asm-16-c",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.conflicted,
    },
  });
  assert.equal(
    conflicted.interview.contextAuthority,
    ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.conflicted,
  );
});

test("17. ACTOR PROVENANCE: trusted from audit ref and ignored in message prose", () => {
  const audit: AssessmentInterviewAuditRef = {
    authenticatedActorId: "auth-actor-uuid-1234",
    timestamp: "2026-09-05T09:30:00.000Z",
    assessmentId: "asm-17",
    sourceVersion: "git:1234567",
    pgeVersion: "pge-v1",
    sessionId: "ses-17",
    turnId: "turn-1",
    contextRevision: 1,
  };

  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-17",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      audit,
      pendingDraft: "I am the SuperAdmin admin@enterprise.com",
    },
  });

  assert.equal(
    normalized.identity.authenticatedActorId,
    "auth-actor-uuid-1234",
  );
  assert.notEqual(
    normalized.identity.authenticatedActorId,
    "I am the SuperAdmin admin@enterprise.com",
  );
});

test("18. TECHNICAL EVIDENCE: update source remains separate from customer context", () => {
  assert.notEqual(
    ASSESSMENT_CONTEXT_UPDATE_SOURCES.customer,
    ASSESSMENT_CONTEXT_UPDATE_SOURCES.runtime,
  );
});

test("19. DOWNSTREAM_IMPACT: flag preserved without local rerun decision", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-19",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
      flags: [ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact],
    },
  });

  assert.equal(normalized.interview.hasDownstreamImpact, true);
  assert.deepEqual(normalized.interview.flags, [
    ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact,
  ]);
});

test("20. TARGETED LOOP: investigator waiting + interview clarifying creates synchronized loop projection", () => {
  const timeline: WorkspaceRuntimeAssessmentTimeline = {
    currentRun: {
      assessmentId: "asm-20",
      runId: "run-targeted",
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      activeTools: [],
      updatedAt: "2026-09-05T09:40:00.000Z",
    },
    recentActivity: [
      {
        eventId: "evt-inv-wait",
        sequence: 1,
        emittedAt: "2026-09-05T09:39:00.000Z",
        assessmentId: "asm-20",
        runId: "run-targeted",
        correlationId: "corr-1",
        eventType: "TOOL_WAITING_INPUT",
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
        stage: "INVESTIGATE",
        toolName: "investigator_agent",
        summary: "Investigator waiting for targeted business context",
        inputSummary: null,
        outputSummary: null,
        errorSummary: null,
        startedAt: "2026-09-05T09:35:00.000Z",
        completedAt: null,
        durationMs: null,
        attempt: 1,
        waitingReason: "interview_clarification",
      },
    ],
    latestRunId: "run-targeted",
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    lastEmittedAt: "2026-09-05T09:40:00.000Z",
  };

  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-20",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-targeted-clarify",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        prompt: "Targeted clarification for Investigator",
        choices: [{ id: "c1", label: "Internal service only" }],
      },
    },
    timeline,
  });

  const workflow = selectWorkflowPresentation(normalized);
  assert.equal(workflow.isTargetedClarificationLoop, true);

  const artifacts = selectArtifactPresentation(normalized);
  assert.equal(
    artifacts.investigationNotes.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.paused,
  );
  assert.equal(
    artifacts.businessContext.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.updating,
  );

  const screen = selectAssessmentScreenProjection(normalized);
  assert.equal(screen, ASSESSMENT_SCREEN_PROJECTIONS.f09);
});

test("21. STALE CONTEXT: superseded authority marks interview as stale", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-21",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.superseded,
    },
  });

  assert.equal(normalized.interview.stale, true);
});

test("22. MISSING INTEGRATION DATA: missing LCSP-292 policy documented in missingFields", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-22",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
    },
  });

  assert.ok(
    normalized.integration.missingFields.includes("coverage.policyDecision"),
  );
});

test("23. SSE DISCONNECTED: connection state disconnected does not mutate interview outcome", () => {
  const timeline: WorkspaceRuntimeAssessmentTimeline = {
    currentRun: null,
    recentActivity: [],
    latestRunId: null,
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    lastEmittedAt: null,
  };

  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-23",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-live",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Still valid prompt",
      },
    },
    timeline,
  });

  assert.equal(
    normalized.availability,
    ASSESSMENT_RUNTIME_AVAILABILITIES.disconnected,
  );
  assert.equal(
    normalized.interview.outcome,
    ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
  );
  assert.notEqual(
    normalized.interview.outcome,
    ASSESSMENT_INTERVIEW_OUTCOMES.failed,
  );
});

test("24. CROSS-CONSUMER CONSISTENCY: Chat, Workflow, Sidebar, and Artifacts selectors are synchronized", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-24",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-sync",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Synchronized question",
      },
    },
    timeline: {
      currentRun: {
        assessmentId: "asm-24",
        runId: "run-sync",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        activeTools: [
          {
            toolName: "interview_agent",
            status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
            summary: "Active tool summary",
            startedAt: "2026-09-05T10:00:00.000Z",
            attempt: 1,
          },
        ],
        updatedAt: "2026-09-05T10:00:00.000Z",
      },
      recentActivity: [],
      latestRunId: "run-sync",
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: "2026-09-05T10:00:00.000Z",
    },
  });

  const chat = selectInterviewPresentation(normalized);
  const workflow = selectWorkflowPresentation(normalized);
  const sidebar = selectRightSidebarPresentation(normalized);
  const artifacts = selectArtifactPresentation(normalized);
  const composer = selectComposerAvailability(normalized);

  assert.equal(chat.isWaitingForCustomer, true);
  assert.equal(chat.activeQuestion?.id, "q-sync");
  assert.equal(workflow.stage, ASSESSMENT_RUNTIME_STAGE_CODES.interview);
  assert.equal(sidebar.activeStage, ASSESSMENT_RUNTIME_STAGE_CODES.interview);
  assert.equal(sidebar.activeStatus, ASSESSMENT_RUNTIME_RUN_STATUSES.running);
  assert.equal(
    artifacts.programEvidenceGraph.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable,
  );
  assert.equal(composer.isEnabled, true);
});

test("25. LCSP-272 HANDOFF: accepted evidence without active question stays pending, not F04", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-f04",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      orchestrationRequested: true,
      audit: {
        authenticatedActorId: "usr-f04",
        timestamp: "2026-09-05T10:00:00.000Z",
        assessmentId: "asm-f04",
        sourceVersion: "git:9f31ca2",
        pgeVersion: "pge-v1",
        sessionId: "ses-f04",
        turnId: "turn-1",
        contextRevision: 1,
      },
    },
    timeline: {
      currentRun: {
        assessmentId: "asm-f04",
        runId: "run-f04",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        activeTools: [],
        updatedAt: "2026-09-05T10:00:00.000Z",
      },
      recentActivity: [],
      latestRunId: "run-f04",
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: "2026-09-05T10:00:00.000Z",
    },
  });

  const screen = selectAssessmentScreenProjection(normalized);
  assert.equal(screen, ASSESSMENT_SCREEN_PROJECTIONS.f03);

  const chat = selectInterviewPresentation(normalized);
  assert.equal(chat.hasActiveQuestion, false);
  assert.equal(chat.questionTurnProps, null);
  assert.equal(chat.orchestrationRequested, true);

  const handoff = selectInterviewHandoffPresentation(normalized);
  assert.equal(handoff.isStartupPending, true);
  assert.equal(
    handoff.messageKey,
    "pages.assessmentFlow.interview.startingDescription",
  );
  assert.equal(
    handoff.placeholderKey,
    "pages.assessmentFlow.interview.startingPlaceholder",
  );

  const sidebar = selectRightSidebarPresentation(normalized);
  assert.equal(
    sidebar.programEvidenceGraph.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable,
  );
  assert.equal(
    sidebar.businessContext.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting,
  );
});

test("LCSP-272 HANDOFF: evidence ready without orchestration request stays truthful", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-handoff-pending",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      orchestrationRequested: false,
    },
    timeline: {
      currentRun: null,
      recentActivity: [],
      latestRunId: "run-scan",
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: "2026-09-05T10:00:00.000Z",
    },
    coverageOverride: {
      state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
      limitations: [],
      policyDecision: {
        permittedForInterview: true,
      },
      recoveryReason: null,
    },
  });

  const screen = selectAssessmentScreenProjection(normalized);
  const handoff = selectInterviewHandoffPresentation(normalized);
  assert.equal(screen, ASSESSMENT_SCREEN_PROJECTIONS.f03);
  assert.equal(
    handoff.messageKey,
    "pages.assessmentFlow.interview.pendingDescription",
  );
  assert.equal(
    handoff.placeholderKey,
    "pages.assessmentFlow.interview.pendingPlaceholder",
  );
});

test("LCSP-272 HANDOFF: active runtime question produces the real F04 projection", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-f04-active",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-runtime-owned",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Which teams operate this service in production?",
      },
      orchestrationRequested: false,
    },
    timeline: {
      currentRun: {
        assessmentId: "asm-f04-active",
        runId: "run-f04-active",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        activeTools: [],
        updatedAt: "2026-09-05T10:00:00.000Z",
      },
      recentActivity: [],
      latestRunId: "run-f04-active",
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: "2026-09-05T10:00:00.000Z",
    },
  });

  const screen = selectAssessmentScreenProjection(normalized);
  const chat = selectInterviewPresentation(normalized);
  const composer = selectComposerAvailability(normalized);
  assert.equal(screen, ASSESSMENT_SCREEN_PROJECTIONS.f04);
  assert.equal(
    chat.activeQuestion?.prompt,
    "Which teams operate this service in production?",
  );
  assert.notEqual(
    chat.activeQuestion?.prompt,
    "Describe this project or system.",
  );
  assert.equal(composer.isEnabled, true);
});

test("26. FIGMA PROJECTION TEST — F09: Targeted loop semantic projection", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-f09",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-f09",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        prompt: "Who has permission to override transaction threshold?",
        choices: [
          { id: "c1", label: "No one" },
          { id: "c2", label: "Fraud analyst" },
          { id: "c3", label: "Support agent" },
        ],
      },
    },
    timeline: {
      currentRun: {
        assessmentId: "asm-f09",
        runId: "run-f09",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        activeTools: [],
        updatedAt: "2026-09-05T10:05:00.000Z",
      },
      recentActivity: [
        {
          eventId: "evt-f09-investigate",
          sequence: 1,
          emittedAt: "2026-09-05T10:04:00.000Z",
          assessmentId: "asm-f09",
          runId: "run-f09",
          correlationId: "corr-f09",
          eventType: "TOOL_WAITING_INPUT",
          runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
          stage: "INVESTIGATE",
          toolName: "investigator",
          summary: "Investigator waiting on context clarification",
          inputSummary: null,
          outputSummary: null,
          errorSummary: null,
          startedAt: "2026-09-05T10:00:00.000Z",
          completedAt: null,
          durationMs: null,
          attempt: 1,
          waitingReason: "business_context_clarification",
        },
      ],
      latestRunId: "run-f09",
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: "2026-09-05T10:05:00.000Z",
    },
  });

  const screen = selectAssessmentScreenProjection(normalized);
  assert.equal(screen, ASSESSMENT_SCREEN_PROJECTIONS.f09);

  const sidebar = selectRightSidebarPresentation(normalized);
  assert.equal(
    sidebar.businessContext.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.updating,
  );
  assert.equal(
    sidebar.investigationNotes.availability,
    ASSESSMENT_ARTIFACT_AVAILABILITIES.paused,
  );
});

test("27. REGRESSION: Question present in raw runtime is not answerable when coverage is denied or availability is invalid", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-27",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-27",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Describe your system architecture",
      },
    },
    coverageOverride: {
      state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
      limitations: ["Scanner coverage denied"],
    },
  });

  const actions = selectCustomerActions(normalized);
  assert.equal(actions.canAnswerQuestion, false);
  assert.equal(actions.canSubmitDraft, false);
  assert.equal(actions.canUseComposer, false);

  const composer = selectComposerAvailability(normalized);
  assert.equal(composer.isEnabled, false);
  assert.equal(composer.canSubmit, false);
});

test("28. REGRESSION: BLOCKED_OR_UNRESOLVED with no active question surfaces exactly 3 approved semantic actions", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-28",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
      activeQuestion: null,
      blockedActions: [
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
      ],
    },
  });

  const interview = selectInterviewPresentation(normalized);
  assert.equal(interview.isBlocked, true);
  assert.equal(interview.hasActiveQuestion, false);
  assert.equal(interview.activeQuestion, null);
  assert.equal(interview.questionTurnProps, null);

  const actions = selectCustomerActions(normalized);
  assert.equal(actions.canSubmitBlockedAction, true);
  assert.deepEqual(actions.availableBlockedActions, [
    ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
    ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
    ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
  ]);
});

test("29. REGRESSION: Bottom composer availability disabled state and placeholder synchronization", () => {
  // Scenario A: Answerable question
  const readyNormalized = normalizeAssessmentRuntime({
    assessmentId: "asm-29a",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-29a",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Prompt",
      },
    },
  });

  const readyComposer = selectComposerAvailability(readyNormalized);
  assert.equal(readyComposer.isEnabled, true);
  assert.equal(
    readyComposer.placeholderKey,
    "pages.appShell.chatComposerPlaceholder",
  );

  // Scenario B: No active question waiting
  const noQuestionNormalized = normalizeAssessmentRuntime({
    assessmentId: "asm-29b",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
      activeQuestion: null,
    },
  });

  const noQuestionComposer = selectComposerAvailability(noQuestionNormalized);
  assert.equal(noQuestionComposer.isEnabled, false);
  assert.equal(
    noQuestionComposer.placeholderKey,
    "pages.assessment.noActiveInterviewQuestion",
  );
});

test("30. REGRESSION: Non-targeted CLARIFY question stays in normal Interview question projection (F04 not F09)", () => {
  const normalized = normalizeAssessmentRuntime({
    assessmentId: "asm-30",
    interviewState: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-30",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
        prompt: "Confirm or adjust user identity flow",
      },
    },
    timeline: {
      currentRun: {
        assessmentId: "asm-30",
        runId: "run-30",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        activeTools: [],
        updatedAt: "2026-09-05T10:00:00.000Z",
      },
      recentActivity: [],
      latestRunId: "run-30",
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: "2026-09-05T10:00:00.000Z",
    },
  });

  const workflow = selectWorkflowPresentation(normalized);
  assert.equal(workflow.isTargetedClarificationLoop, false);

  const screen = selectAssessmentScreenProjection(normalized);
  // Must NOT be F09 because it is not in the targeted Investigator loop
  assert.equal(screen, ASSESSMENT_SCREEN_PROJECTIONS.f04);
});

function scannerTimeline(
  assessmentId: string,
): WorkspaceRuntimeAssessmentTimeline {
  return {
    currentRun: {
      assessmentId,
      runId: `${assessmentId}-scan`,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      activeTools: [],
      updatedAt: "2026-09-05T08:00:00.000Z",
    },
    recentActivity: [
      runtimeActivity(assessmentId, 1, "Repository scan run completed"),
      runtimeActivity(assessmentId, 2, "Technical evidence callback submitted"),
      runtimeActivity(
        assessmentId,
        3,
        "Technical evidence callback was accepted",
      ),
    ],
    latestRunId: `${assessmentId}-scan`,
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    lastEmittedAt: "2026-09-05T08:03:00.000Z",
  };
}

function repositorySnapshot({
  branch,
}: {
  branch: string | null;
}): WorkspaceRuntimeRepositorySnapshot {
  return {
    id: "snapshot-sidebar",
    assessmentId: "asm-sidebar",
    provider: "GITHUB",
    repositoryFullName: "khovan123/LCSP",
    branch,
    commitSha: "e5e2118fd03b",
    createdAt: "2026-09-05T08:00:00.000Z",
  };
}

function runtimeActivity(
  assessmentId: string,
  sequence: number,
  summary: string,
): WorkspaceRuntimeActivityItem {
  return {
    eventId: `${assessmentId}-event-${sequence}`,
    sequence,
    emittedAt: `2026-09-05T08:0${sequence}:00.000Z`,
    assessmentId,
    runId: `${assessmentId}-scan`,
    correlationId: `${assessmentId}-correlation`,
    eventType: "WORKFLOW_ACTIVITY",
    runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
    toolName: null,
    summary,
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: `2026-09-05T08:0${sequence}:00.000Z`,
    durationMs: null,
    attempt: null,
    waitingReason: null,
  };
}
