import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_CONTEXT_UPDATE_SOURCES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  hasValidInterviewWaitingInvariant,
  isAssessmentInterviewOutcome,
  isAssessmentInterviewQuestionIntent,
  isAuthoritativeAssessmentContextStatus,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";

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
  const [overviewSource, questionSource] = await Promise.all([
    readFile(overviewPath, "utf8"),
    readFile(questionTurnPath, "utf8"),
  ]);

  assert.match(overviewSource, /data-surface="workflow-run"/);
  assert.match(overviewSource, /AssessmentTranscript/);
  assert.match(overviewSource, /AssessmentComposer/);
  assert.match(overviewSource, /AssessmentQuestionTurn/);
  assert.match(overviewSource, /useAssessmentInterviewStateQuery/);
  assert.match(overviewSource, /useSubmitAssessmentInterviewAnswerMutation/);
  assert.match(overviewSource, /useAssessmentInterviewBlockedActionMutation/);
  assert.match(overviewSource, /pendingDraft/);
  assert.match(overviewSource, /answerHistory/);
  assert.match(overviewSource, /orchestrationRequested/);
  assert.match(overviewSource, /runtimeWaitingForAgent/);
  assert.doesNotMatch(
    overviewSource,
    /initialInterviewQuestion|targetedClarificationQuestion|localStorage|Card|modules\.map|\/wizard|\/readiness/,
  );

  assert.match(questionSource, /priorAnswerSummary/);
  assert.match(questionSource, /requiresFreeText/);
  assert.match(questionSource, /whyEvidenceRefs/);
  assert.match(questionSource, /blocked-or-unresolved-actions/);
  assert.match(questionSource, /usesSingleValue/);
  assert.match(
    questionSource,
    /ASSESSMENT_INTERVIEW_CONTROLS\.singleSelect\s*\|\|\s*\n\s*question\.control === ASSESSMENT_INTERVIEW_CONTROLS\.boolean/,
  );
  assert.match(
    questionSource,
    /usesSingleValue && singleValue \? \[singleValue\] : selectedChoiceIds/,
  );
  assert.doesNotMatch(questionSource, /Support/);

  const contractSource = await readFile(contractsPath, "utf8");
  for (const control of Object.values(ASSESSMENT_INTERVIEW_CONTROLS)) {
    assert.match(contractSource, new RegExp(control));
  }
});

test("web production cutover has no active wizard customer-context consumers", async () => {
  const assessmentQueries = await readFile(assessmentQueriesPath, "utf8");
  const files = await collectFiles(new URL(".", workspaceRoot).pathname);
  const activeFiles = files.filter((file) => !file.includes("/features/wizard/"));
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
