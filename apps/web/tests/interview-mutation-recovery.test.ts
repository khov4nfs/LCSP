import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import {
  ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES as CODES,
  type SubmitInterviewAnswerCommand,
  type AssessmentInterviewBlockedInput,
} from "@lcsp/contracts/evidence";
import {
  createInterviewMutationRetrier,
  InterviewMutationError,
  isInterviewMutationConflict,
} from "../src/lib/api/interview-mutation-recovery";
import { requestInterviewMutation } from "../src/lib/api/interview-mutation-request";

const fixture = JSON.parse(await readFile(new URL(
  "../src/public/assets/mocks/m04-interview-mutations.json", import.meta.url,
), "utf8")) as {
  answer: SubmitInterviewAnswerCommand;
  blocked: AssessmentInterviewBlockedInput;
  success: { ok: true; data: Record<string, unknown> };
  conflict: { ok: false; problem: { code: string; status: number } };
};
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const failNetwork = async () => { throw new TypeError("network disconnected"); };

for (const [name, initial] of Object.entries({ answer: fixture.answer, blocked: fixture.blocked })) {
  test(`${name}: retry reuses the exact original command, not the new request id`, async () => {
    const retrier = createInterviewMutationRetrier<typeof initial>();
    await assert.rejects(retrier.run(initial, failNetwork));
    assert.equal(retrier.hasPending(), true);
    let captured: typeof initial | undefined;
    await retrier.run({ ...initial, clientRequestId: "new-generated-id" }, async (command) => { captured = command; return true; });
    assert.deepEqual(captured, initial);
    assert.equal(retrier.hasPending(), false);
  });

  test(`${name}: refuses changed content/revision until the original request is resolved`, async () => {
    const retrier = createInterviewMutationRetrier<typeof initial>();
    await assert.rejects(retrier.run(initial, failNetwork));
    let sends = 0;
    await assert.rejects(retrier.run({ ...initial, expectedSessionRevision: 99 }, async () => { sends++; }),
      (error: unknown) => error instanceof InterviewMutationError && error.code === CODES.requestPending);
    assert.equal(sends, 0);
    await retrier.run(undefined, async (command) => { assert.deepEqual(command, initial); });
  });

  test(`${name}: deduplicates concurrent transmissions in one client`, async () => {
    const retrier = createInterviewMutationRetrier<typeof initial>();
    let finish!: (value: boolean) => void;
    const response = new Promise<boolean>((resolve) => { finish = resolve; });
    let sends = 0;
    const send = async () => { sends++; return response; };
    const first = retrier.run(initial, send);
    const second = retrier.run({ ...initial, clientRequestId: "parallel" }, send);
    await Promise.resolve(); finish(true);
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(sends, 1);
  });
}

test("an unresolved request cannot be mutated by the caller", async () => {
  const retrier = createInterviewMutationRetrier<SubmitInterviewAnswerCommand>();
  const input = structuredClone(fixture.answer);
  await assert.rejects(retrier.run(input, failNetwork));
  input.questionRef = "a-different-question";
  await retrier.run(undefined, async (command) => { assert.deepEqual(command, fixture.answer); });
});

test("a definitive conflict releases the request and is recognized for state refresh", async () => {
  const retrier = createInterviewMutationRetrier<SubmitInterviewAnswerCommand>();
  const conflict = new InterviewMutationError(CODES.revisionStale, 409, true);
  await assert.rejects(retrier.run(fixture.answer, async () => { throw conflict; }));
  assert.equal(retrier.hasPending(), false);
  assert.equal(isInterviewMutationConflict(conflict), true);
  const next = { ...fixture.answer, clientRequestId: "next", expectedSessionRevision: 2 };
  await retrier.run(next, async (command) => { assert.equal(command.clientRequestId, "next"); });
});

test("5xx does not discard the original command", async () => {
  const retrier = createInterviewMutationRetrier<SubmitInterviewAnswerCommand>();
  await assert.rejects(retrier.run(fixture.answer, async () => {
    throw new InterviewMutationError(CODES.requestPending, 503, false);
  }));
  assert.equal(retrier.hasPending(), true);
});

test("different Assessment retriers do not share requests", async () => {
  const first = createInterviewMutationRetrier<SubmitInterviewAnswerCommand>();
  const second = createInterviewMutationRetrier<SubmitInterviewAnswerCommand>();
  await assert.rejects(first.run(fixture.answer, failNetwork));
  assert.equal(second.hasPending(), false);
});

test("Problem Response rejects instead of triggering success and clearing a draft", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(fixture.conflict), { status: 409 });
  let successCalled = false;
  await assert.rejects(requestInterviewMutation("/api/interview", { method: "POST" }).then(() => { successCalled = true; }),
    (error: unknown) => error instanceof InterviewMutationError && error.code === CODES.revisionStale);
  assert.equal(successCalled, false);
});

test("valid mutation response returns saved state", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(fixture.success), { status: 201 });
  assert.deepEqual(await requestInterviewMutation("/api/interview", { method: "POST" }), fixture.success.data);
});

test("malformed success remains uncertain and retains the command", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ...fixture.success, data: null }), { status: 200 });
  const retrier = createInterviewMutationRetrier<SubmitInterviewAnswerCommand>();
  await assert.rejects(retrier.run(fixture.answer, () => requestInterviewMutation("/api/interview", { method: "POST" })));
  assert.equal(retrier.hasPending(), true);
});

test("hooks and UI use explicit original-request recovery", async () => {
  const hooks = await readFile(new URL("../src/lib/api/interview-mutation-queries.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/features/workspace/components/organisms/assessment-overview.tsx", import.meta.url), "utf8");
  assert.match(hooks, /retrier\.run/);
  assert.match(hooks, /buildInterviewBlockedActionCommand/);
  assert.match(hooks, /isInterviewMutationConflict/);
  assert.match(ui, /InterviewMutationFeedback/);
  assert.match(ui, /submitAnswer\.mutate\(undefined\)/);
  assert.match(ui, /recordBlockedAction\.mutate\(undefined\)/);
  assert.match(ui, /setRetainedDrafts/);
});
