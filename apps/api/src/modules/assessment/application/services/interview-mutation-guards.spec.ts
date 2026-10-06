import { describe, expect, it } from "@jest/globals";
import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS as ACTIONS,
  ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES as CODES,
  ASSESSMENT_INTERVIEW_OUTCOMES as OUTCOMES,
  type AssessmentInterviewBlockedInput,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import {
  assertInterviewBlockedActionAvailable,
  assertInterviewMutationProvenance,
  parseInterviewBlockedAction,
  isInterviewBlockedActionReceipt,
} from "./interview-mutation-guards.js";

function thread() {
  return {
    exists: true,
    contextRevision: 2,
    sourceVersion: "snapshot-a:commit-a",
    pgeVersion: "report-a:v1",
    activeQuestionId: null as string | null,
    state: {
      outcome: OUTCOMES.blockedOrUnresolved,
      blockedActions: Object.values(ACTIONS),
      orchestrationRequested: false,
    } as AssessmentInterviewRuntimeState,
  };
}
const command: AssessmentInterviewBlockedInput = {
  action: ACTIONS.saveAndExit,
  expectedSessionRevision: 2,
  clientRequestId: "request-a",
};

function expectProblem(action: () => void, code: string) {
  try {
    action();
    throw new Error("Expected mutation to be rejected");
  } catch (error) {
    expect(error).toMatchObject({ response: { ok: false, problem: { code } } });
  }
}

describe("M04 mutation guards", () => {
  it("allows a currently advertised blocked action", () => {
    expect(() =>
      assertInterviewBlockedActionAvailable(thread(), command, "corr"),
    ).not.toThrow();
  });
  it("rejects an old context revision", () => {
    expectProblem(
      () =>
        assertInterviewBlockedActionAvailable(
          thread(),
          {
            ...command,
            expectedSessionRevision: 1,
          },
          "corr",
        ),
      CODES.revisionStale,
    );
  });
  it.each([
    OUTCOMES.contextReady,
    OUTCOMES.contextResolved,
    OUTCOMES.waitingForCustomer,
    OUTCOMES.failed,
  ])("does not turn %s back into BLOCKED", (outcome) => {
    const current = thread();
    current.state.outcome = outcome;
    expectProblem(
      () => assertInterviewBlockedActionAvailable(current, command, "corr"),
      CODES.blockedActionNotAvailable,
    );
  });
  it("rejects an action while a follow-up is queued", () => {
    const current = thread();
    current.state.orchestrationRequested = true;
    expectProblem(
      () => assertInterviewBlockedActionAvailable(current, command, "corr"),
      CODES.blockedActionNotAvailable,
    );
  });
  it("rejects missing threads and actions no longer offered", () => {
    const current = thread();
    current.exists = false;
    expectProblem(
      () => assertInterviewBlockedActionAvailable(current, command, "corr"),
      CODES.blockedActionNotAvailable,
    );
    current.exists = true;
    current.state.blockedActions = [];
    expectProblem(
      () => assertInterviewBlockedActionAvailable(current, command, "corr"),
      CODES.blockedActionNotAvailable,
    );
  });
  it("does not clear a current question", () => {
    const current = thread();
    current.activeQuestionId = "new-question";
    expectProblem(
      () => assertInterviewBlockedActionAvailable(current, command, "corr"),
      CODES.blockedActionNotAvailable,
    );
  });
  it("accepts matching pinned provenance", () => {
    expect(() =>
      assertInterviewMutationProvenance(thread(), thread(), "corr"),
    ).not.toThrow();
  });
  it.each([
    { sourceVersion: "snapshot-b:commit-b", pgeVersion: "report-a:v1" },
    { sourceVersion: "snapshot-a:commit-a", pgeVersion: "report-b:v1" },
  ])("rejects replaced source/evidence: %j", (current) => {
    expectProblem(
      () => assertInterviewMutationProvenance(thread(), current, "corr"),
      CODES.provenanceStale,
    );
  });
  it("rejects an unpinned legacy question rather than inventing provenance", () => {
    expectProblem(
      () =>
        assertInterviewMutationProvenance(
          { sourceVersion: null, pgeVersion: null },
          thread(),
          "corr",
        ),
      CODES.provenanceStale,
    );
  });
  it.each([
    {},
    { ...command, expectedSessionRevision: undefined },
    { ...command, expectedSessionRevision: -1 },
    { ...command, expectedSessionRevision: 0.5 },
    { ...command, clientRequestId: " " },
    { ...command, draft: 42 },
  ])("rejects incomplete blocked commands: %j", (value) => {
    expectProblem(
      () => parseInterviewBlockedAction(value, "corr"),
      CODES.blockedActionInvalid,
    );
  });
  it("parses a versioned command without promoting its draft", () => {
    expect(
      parseInterviewBlockedAction(
        { ...command, draft: "not confirmed" },
        "corr",
      ),
    ).toEqual({ ...command, draft: "not confirmed" });
  });
  it("accepts durable receipts and rejects malformed records", () => {
    expect(
      isInterviewBlockedActionReceipt({
        clientRequestId: "r",
        payloadFingerprint: "p",
        contextRevision: 0,
        actorId: "u",
        recordedAt: "2026-10-05T00:00:00Z",
      }),
    ).toBe(true);
    expect(isInterviewBlockedActionReceipt({ clientRequestId: "r" })).toBe(
      false,
    );
  });
});
