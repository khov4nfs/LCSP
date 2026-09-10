import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_CONTEXT_UPDATE_SOURCES,
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_MODES,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  BUSINESS_CONTEXT_RESOLUTION_STATES,
  BUSINESS_CONTEXT_SOURCES,
  CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES,
  EVIDENCE_RESOLUTION_STATES,
  EVIDENCE_SOURCE_TYPES,
  INTERVIEW_HOST_PLATFORMS,
  INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES,
  INTERVIEW_TECHNICAL_CONTRACT_VERSION,
  LEGACY_ASSESSMENT_INTERVIEW_MODES,
  hasValidInterviewWaitingInvariant,
  isAssessmentInterviewOutcome,
  isAssessmentInterviewQuestionIntent,
  isAuthoritativeAssessmentContextStatus,
  isBusinessContextStatement,
  isBusinessContextUpdate,
  isCustomerAnswer,
  isConfirmedStructuredBusinessContext,
  isInterviewAgentInput,
  isInterviewAgentResultForMode,
  isInterviewRuntimeResult,
  normalizeAssessmentInterviewMode,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";

import {
  buildSubmitInterviewAnswerCommand,
  sanitizeAssessmentInterviewState,
} from "../src/lib/api/assessment-interview-client";

test("public interview history survives sanitization without private actor identity", () => {
  const answer = {
    questionId: "purpose-question",
    answeredAt: "2026-09-09T00:00:00.000Z",
    summary: "The system pauses assessment for human review.",
    comment: "A mix of internal advice and external sharing.",
  };
  const state = sanitizeAssessmentInterviewState({
    mode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
    outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
    answerHistory: [answer, { questionId: "invalid" }],
  });
  assert.ok(state);
  assert.deepEqual(state.answerHistory, [answer]);
  assert.deepEqual(sanitizeAssessmentInterviewState(state)?.answerHistory, [
    answer,
  ]);
  for (const comment of [42, {}, "   "]) {
    const sanitized = sanitizeAssessmentInterviewState({
      ...state,
      answerHistory: [{ ...answer, comment }],
    });
    assert.equal(sanitized?.answerHistory?.[0].comment, undefined);
  }
});

test("terminal Interview assistant output survives the public client boundary", () => {
  const state = sanitizeAssessmentInterviewState({
    outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
    assistantMessage:
      "I have enough confirmed business context to continue the assessment.",
  });

  assert.equal(
    state?.assistantMessage,
    "I have enough confirmed business context to continue the assessment.",
  );
});

const workspaceRoot = new URL("../src/", import.meta.url);
const contractsPath = new URL(
  "../../../packages/contracts/src/evidence/assessment-interview.ts",
  import.meta.url,
);
const overviewPath = new URL(
  "../src/features/workspace/components/organisms/assessment-overview.tsx",
  import.meta.url,
);
const questionTurnPath = new URL(
  "../src/features/workspace/components/molecules/assessment-question-turn.tsx",
  import.meta.url,
);
const assessmentQueriesPath = new URL(
  "../src/lib/api/assessment-queries.ts",
  import.meta.url,
);
const runtimeSelectorsPath = new URL(
  "../src/features/workspace/utils/assessment-runtime-selectors.ts",
  import.meta.url,
);

test("canonical interview contract exposes only release-gated outcomes", () => {
  assert.deepEqual(Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).sort(), [
    "BLOCKED_OR_UNRESOLVED",
    "CONTEXT_READY",
    "CONTEXT_RESOLVED",
    "FAILED",
    "WAITING_FOR_CUSTOMER",
  ]);
  assert.equal(
    isAssessmentInterviewOutcome(ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact),
    false,
  );
  assert.equal(ASSESSMENT_INTERVIEW_OUTCOMES.failed, "FAILED");
  assert.equal(
    ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
    "BLOCKED_OR_UNRESOLVED",
  );
});

test("canonical interview modes exclude compatibility-only PRE_PLANNER", () => {
  assert.deepEqual(Object.values(ASSESSMENT_INTERVIEW_MODES).sort(), [
    "INITIAL_INTERVIEW",
    "INVESTIGATOR_RESOLUTION",
  ]);
  assert.deepEqual(Object.values(LEGACY_ASSESSMENT_INTERVIEW_MODES), [
    "PRE_PLANNER",
  ]);
  assert.equal(
    normalizeAssessmentInterviewMode(
      LEGACY_ASSESSMENT_INTERVIEW_MODES.prePlanner,
    ),
    ASSESSMENT_INTERVIEW_MODES.initialInterview,
  );
});

const canonicalScope = {
  systemRefs: ["system:checkout"],
};

const confirmedStatement = {
  statementId: "stmt-human-approval",
  assessmentId: "assessment-1",
  topic: "decision_authority",
  statement: "Human approval is required before action.",
  normalizedValue: "human_approval_required",
  scope: canonicalScope,
  evidenceRefs: ["evidence:customer-confirmation"],
  respondentRef: "actor:authenticated:user-1",
  createdAt: "2026-09-08T00:00:00.000Z",
  source: BUSINESS_CONTEXT_SOURCES.customerConfirmed,
  resolutionState: BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed,
};

const statedUpdate = {
  topic: "operating_region",
  statement: "Operations may include the EU region.",
  scope: canonicalScope,
  evidenceRefs: [],
  source: BUSINESS_CONTEXT_SOURCES.customerStated,
  resolutionState: BUSINESS_CONTEXT_RESOLUTION_STATES.uncertain,
};

const safeEvidenceItem = {
  evidenceRef: "evidence:customer-confirmation",
  sourceType: EVIDENCE_SOURCE_TYPES.technicalEvidence,
  resolutionState: EVIDENCE_RESOLUTION_STATES.observed,
  observation: "Customer stated approval occurs before action.",
  sourceVersionRef: "source:snap-1",
  scope: canonicalScope,
  customerSafeSummary: "The current evidence indicates approval is involved.",
};

const confirmAdjustQuestion = {
  intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
  text: "Please confirm the approval authority.",
  reasonSummary: "Approval authority affects downstream assessment scope.",
  evidenceRefs: ["evidence:customer-confirmation"],
  responseMode: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
  proposedInterpretation: [
    {
      topic: "decision_authority",
      statement: "Human approval is required before action.",
      normalizedValue: "human_approval_required",
      scope: canonicalScope,
      evidenceRefs: ["evidence:customer-confirmation"],
    },
  ],
  choices: [
    { value: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm, label: "Confirm" },
    { value: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust, label: "Adjust" },
  ],
};

function canonicalAgentInput(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: INTERVIEW_TECHNICAL_CONTRACT_VERSION,
    hostPlatform: INTERVIEW_HOST_PLATFORMS.lcsp,
    assessmentId: "assessment-1",
    sessionId: "interview:assessment-1",
    sessionRevision: 3,
    subjectSystemIdentity: {
      systemRef: "system:checkout",
      displayName: "Checkout",
      workspaceRef: "workspace:main",
    },
    guidanceVersion: "guidance:v1",
    locale: "en-US",
    artifactVersions: {
      sourceVersionRef: "source:snap-1",
      scannerRunRef: "scanner:run-1",
      programEvidenceGraphVersion: "pge:v1",
    },
    technicalCoverage: {
      state: INTERVIEW_REASONING_TECHNICAL_COVERAGE_STATES.ready,
      limitations: [],
      policyDecisionRef: "coverage-policy:ready",
    },
    currentConfirmedBusinessContext: [confirmedStatement],
    safeEvidenceContext: {
      items: [safeEvidenceItem],
    },
    interviewHistory: [],
    mode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
    ...overrides,
  };
}

function waitingAgentResult(overrides: Record<string, unknown> = {}) {
  return {
    outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
    question: confirmAdjustQuestion,
    contextUpdates: [statedUpdate],
    unresolved: [],
    flags: [],
    limitations: [],
    ...overrides,
  };
}

function runtimeResult(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: INTERVIEW_TECHNICAL_CONTRACT_VERSION,
    assessmentId: "assessment-1",
    sessionId: "interview:assessment-1",
    invocationRef: "invocation:1",
    mode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
    guidanceVersion: "guidance:v1",
    artifactVersions: {
      sourceVersionRef: "source:snap-1",
      scannerRunRef: "scanner:run-1",
      programEvidenceGraphVersion: "pge:v1",
    },
    contextRevisionBefore: "context:2",
    sessionRevisionBefore: 2,
    sessionRevisionAfter: 3,
    persistedQuestionRef: "question:1",
    generatedAt: "2026-09-08T00:00:00.000Z",
    agentResult: waitingAgentResult(),
    ...overrides,
  };
}

test("canonical interview contract validators reject authority-changing drift", () => {
  assert.equal(isBusinessContextStatement(confirmedStatement), true);
  assert.equal(isBusinessContextUpdate(statedUpdate), true);
  assert.equal(isInterviewAgentInput(canonicalAgentInput()), true);
  assert.equal(
    isInterviewAgentResultForMode(
      waitingAgentResult(),
      ASSESSMENT_INTERVIEW_MODES.initialInterview,
    ),
    true,
  );
  assert.equal(isInterviewRuntimeResult(runtimeResult()), true);

  assert.equal(
    isBusinessContextStatement({
      ...confirmedStatement,
      source: BUSINESS_CONTEXT_SOURCES.customerStated,
    }),
    false,
  );
  assert.equal(
    isBusinessContextUpdate({
      ...statedUpdate,
      resolutionState: BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed,
    }),
    false,
  );
  assert.equal(
    isInterviewAgentInput(
      canonicalAgentInput({
        mode: LEGACY_ASSESSMENT_INTERVIEW_MODES.prePlanner,
      }),
    ),
    false,
  );
  assert.equal(
    isInterviewAgentInput(canonicalAgentInput({ checkpointBlob: "opaque" })),
    false,
  );
  assert.equal(
    isInterviewAgentInput(
      canonicalAgentInput({
        currentConfirmedBusinessContext: [
          {
            ...confirmedStatement,
            resolutionState: BUSINESS_CONTEXT_RESOLUTION_STATES.conflicted,
          },
        ],
      }),
    ),
    false,
  );
  assert.equal(
    isInterviewAgentResultForMode(
      {
        ...waitingAgentResult({
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        }),
      },
      ASSESSMENT_INTERVIEW_MODES.initialInterview,
    ),
    false,
  );
  assert.equal(
    isInterviewAgentResultForMode(
      {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
        contextUpdates: [],
        unresolved: [],
        flags: [],
        limitations: [],
      },
      ASSESSMENT_INTERVIEW_MODES.initialInterview,
    ),
    false,
  );
  assert.equal(
    isInterviewRuntimeResult(
      runtimeResult({ persistedQuestionRef: undefined }),
    ),
    false,
  );
  assert.equal(
    isInterviewRuntimeResult(
      runtimeResult({
        mode: LEGACY_ASSESSMENT_INTERVIEW_MODES.prePlanner,
      }),
    ),
    false,
  );
});

test("canonical confirmed structured context requires confirmed authority, scope, respondent and provenance", () => {
  assert.equal(
    isConfirmedStructuredBusinessContext({
      assessmentId: "assessment-1",
      contextRevision: 3,
      authority:
        CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
      statements: [confirmedStatement],
      createdByActorRef: "actor:authenticated:user-1",
    }),
    true,
  );
  assert.equal(
    isConfirmedStructuredBusinessContext({
      assessmentId: "assessment-1",
      contextRevision: 3,
      authority:
        CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
      statements: [{ ...confirmedStatement, scope: undefined }],
      createdByActorRef: "actor:authenticated:user-1",
    }),
    false,
  );
  assert.equal(
    isConfirmedStructuredBusinessContext({
      assessmentId: "assessment-1",
      contextRevision: 3,
      authority:
        CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
      statements: [{ ...confirmedStatement, respondentRef: undefined }],
      createdByActorRef: "actor:authenticated:user-1",
    }),
    false,
  );
  assert.equal(
    isConfirmedStructuredBusinessContext({
      assessmentId: "assessment-1",
      contextRevision: 3,
      authority:
        CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
      statements: [{ ...confirmedStatement, evidenceRefs: undefined }],
      createdByActorRef: "actor:authenticated:user-1",
    }),
    false,
  );
});

test("canonical customer answer guard rejects empty free-text answers", () => {
  assert.equal(
    isCustomerAnswer({ kind: ASSESSMENT_INTERVIEW_CONTROLS.freeText, text: "" }),
    false,
  );
  assert.equal(
    isCustomerAnswer({ kind: ASSESSMENT_INTERVIEW_CONTROLS.freeText, text: "   " }),
    false,
  );
  assert.equal(
    isCustomerAnswer({
      kind: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
      text: "Customer confirmed the approval workflow.",
    }),
    true,
  );
});

test("canonical interview state invariants reject false ready or resolved cases", () => {
  assert.equal(
    hasValidInterviewWaitingInvariant({
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-1",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        prompt: "Runtime supplied prompt",
      },
    }),
    true,
  );
  assert.equal(
    hasValidInterviewWaitingInvariant({
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
      activeQuestion: {
        id: "q-2",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
        prompt: "Runtime supplied prompt",
      },
    }),
    false,
  );
  assert.equal(
    isAssessmentInterviewQuestionIntent(
      ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
    ),
    true,
  );
});

test("confirmation authority separates customer statements from planner facts", () => {
  assert.equal(
    isAuthoritativeAssessmentContextStatus(
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
    ),
    false,
  );
  assert.equal(
    isAuthoritativeAssessmentContextStatus(
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.uncertain,
    ),
    false,
  );
  assert.equal(
    isAuthoritativeAssessmentContextStatus(
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.conflicted,
    ),
    false,
  );
  assert.equal(
    isAuthoritativeAssessmentContextStatus(
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
    ),
    true,
  );
  assert.deepEqual(Object.values(ASSESSMENT_CONTEXT_UPDATE_SOURCES).sort(), [
    "CUSTOMER",
    "RUNTIME",
  ]);
});

test("coverage states preserve unavailable and partial without false absence inference", () => {
  assert.deepEqual(Object.values(ASSESSMENT_TECHNICAL_COVERAGE_STATES), [
    "READY",
    "PARTIAL",
    "UNAVAILABLE",
  ]);
});

test("actor audit refs carry authenticated identity and revision provenance", () => {
  const audit = {
    authenticatedActorId: "user-123",
    timestamp: "2026-09-03T10:00:00.000Z",
    assessmentId: "assessment-123",
    sourceVersion: "commit:9f31ca2",
    pgeVersion: "pge:4",
    sessionId: "session-1",
    turnId: "turn-7",
    contextRevision: 3,
    priorRevision: 2,
    newRevision: 3,
    relatedQuestionId: "question-1",
    governedEvidenceRefs: ["evidence:bounded:1"],
  } satisfies AssessmentInterviewAuditRef;

  assert.equal(audit.authenticatedActorId, "user-123");
  assert.notEqual(audit.authenticatedActorId, "I am the Product Owner");
  assert.equal(audit.priorRevision, 2);
  assert.equal(audit.newRevision, 3);
});

test("blocked or unresolved actions expose exactly the MVP customer choices", () => {
  assert.deepEqual(Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS), [
    "PROVIDE_MORE_CONTEXT",
    "CHECK_INTERNALLY",
    "SAVE_AND_EXIT",
  ]);
});

test("workflow run renders dynamic interview controls through shared workspace components", async () => {
  const [overviewSource, questionSource, selectorSource] = await Promise.all([
    readFile(overviewPath, "utf8"),
    readFile(questionTurnPath, "utf8"),
    readFile(runtimeSelectorsPath, "utf8"),
  ]);

  assert.match(overviewSource, /data-flow-stage=/);
  assert.match(overviewSource, /AssessmentTranscript/);
  assert.match(overviewSource, /AssessmentComposer/);
  assert.match(overviewSource, /AssessmentQuestionTurn/);
  assert.match(overviewSource, /useAssessmentInterviewStateQuery/);
  assert.match(overviewSource, /useSubmitAssessmentInterviewAnswerMutation/);
  assert.match(overviewSource, /useAssessmentInterviewBlockedActionMutation/);
  assert.match(overviewSource, /pendingDraft/);
  assert.match(overviewSource, /answerHistory/);
  assert.match(overviewSource, /interview\.assistantMessage/);
  assert.match(overviewSource, /state:\s*runtimeInterviewState/);
  assert.match(overviewSource, /selectInterviewHandoffPresentation/);
  assert.match(overviewSource, /selectedChoiceRequiresFreeText/);
  assert.match(selectorSource, /orchestrationRequested/);
  assert.match(
    selectorSource,
    /assessmentFlow\.interview\.startingDescription/,
  );
  assert.doesNotMatch(
    overviewSource,
    /initialInterviewQuestion|targetedClarificationQuestion|localStorage|Card|modules\.map|\/wizard|\/readiness/,
  );

  assert.match(questionSource, /priorAnswerSummary/);
  assert.match(questionSource, /whyEvidenceRefs/);
  assert.match(questionSource, /blocked-or-unresolved-actions/);
  assert.match(questionSource, /ChatSingleSelect/);
  assert.match(questionSource, /ChatMultiSelect/);
  assert.match(questionSource, /confirm-adjust-actions/);
  assert.match(questionSource, /selection-submit-action/);
  assert.match(overviewSource, /onSubmitSelection=\{handleSubmit\}/);
  // The question turn owns no input surface and no mutation: free text stays in the shared
  // composer and every send delegates upward. The send action added for select answers
  // names the `pages.assessment.submitAnswer` label, so the token itself is no longer the
  // signal; calling the mutation hook here is.
  assert.doesNotMatch(questionSource, /Support|Textarea|useSubmitAssessmentInterviewAnswerMutation|apiRequest/);

  const contractSource = await readFile(contractsPath, "utf8");
  for (const control of Object.values(ASSESSMENT_INTERVIEW_CONTROLS)) {
    assert.match(contractSource, new RegExp(control));
  }
});

test("web customer answer submit builds canonical idempotent command from persisted state", () => {
  const command = buildSubmitInterviewAnswerCommand(
    "assessment-1",
    {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      threadId: "interview:assessment-1",
      contextRevision: 7,
      activeQuestion: {
        id: "q-choice",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        prompt: "Runtime prompt",
        choices: [
          { id: "choice-a", label: "Choice A" },
          { id: "choice-b", label: "Choice B" },
        ],
      },
    },
    {
      questionId: "q-choice",
      selectedChoiceIds: ["choice-a"],
      otherText: "Selected by the authenticated user.",
    },
    "client-request-web-1",
  );

  assert.equal(command.contractVersion, INTERVIEW_TECHNICAL_CONTRACT_VERSION);
  assert.equal(command.assessmentId, "assessment-1");
  assert.equal(command.sessionId, "interview:assessment-1");
  assert.equal(command.questionRef, "q-choice");
  assert.equal(command.expectedSessionRevision, 7);
  assert.equal(command.clientRequestId, "client-request-web-1");
  assert.deepEqual(command.answer, {
    kind: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
    value: "choice-a",
    comment: "Selected by the authenticated user.",
  });
  assert.equal(
    "respondentRef" in (command.answer as Record<string, unknown>),
    false,
  );
});

test("web production cutover has no active wizard customer-context consumers", async () => {
  const assessmentQueries = await readFile(assessmentQueriesPath, "utf8");
  const files = await collectFiles(fileURLToPath(new URL(".", workspaceRoot)));
  const activeFiles = files.filter(
    (file) => !file.includes("/features/wizard/"),
  );
  const wizardRouteFiles = activeFiles.filter((file) =>
    /\/app\/api\/assessments\/\[id\]\/wizard\//.test(file),
  );
  const activeSource = (
    await Promise.all(activeFiles.map((file) => readFile(file, "utf8")))
  ).join("\n");

  assert.equal(wizardRouteFiles.length, 0);
  assert.doesNotMatch(assessmentQueries, /wizard-client|useWizard/);
  assert.doesNotMatch(activeSource, /wizard\/draft|wizard\/submit/);
  assert.doesNotMatch(activeSource, /wizard\/clarification-questions/);
});

test("canonical runtime state can represent waiting, resolved, blocked, failed and downstream impact distinctly", () => {
  const states = [
    { outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer },
    { outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved },
    { outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved },
    { outcome: ASSESSMENT_INTERVIEW_OUTCOMES.failed },
    {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
      flags: [ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact],
    },
  ] satisfies AssessmentInterviewRuntimeState[];

  assert.equal(
    states[1].outcome,
    ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
  );
  assert.equal(
    states[2].outcome,
    ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
  );
  assert.equal(states[3].outcome, ASSESSMENT_INTERVIEW_OUTCOMES.failed);
  assert.deepEqual(states[4].flags, [
    ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact,
  ]);
});

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(fullPath);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    }),
  );
  return files.flat();
}
