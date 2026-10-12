import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_EXECUTION_STATES as EXEC,
  ASSESSMENT_LIFECYCLE_STATES as LIFE,
} from "@lcsp/contracts/assessment";
import {
  CONVERSATION_NOTICE_KINDS,
  CONVERSATION_TURN_KINDS as KIND,
  WORK_STEP_KINDS,
  type ConversationTurn,
  type WorkTurn,
} from "../src/features/assessment-runtime/types/conversation.types.ts";
import { projectConversation } from "../src/features/assessment-runtime/utils/conversation-projection.ts";
import { sumTurnUsage } from "../src/features/assessment-runtime/utils/conversation-usage.ts";
import { customerAssessmentState } from "../src/features/assessment-runtime/utils/customer-assessment-state.ts";
import { CUSTOMER_ASSESSMENT_STATES as STATE } from "../src/features/assessment-runtime/config/customer-assessment-states.ts";
import {
  ASSESSMENT_ID,
  LABEL,
  detail,
  events,
  request,
} from "./support/assessment-conversation-fixtures.ts";

const REPOSITORY = { fullName: "acme/notice-service", commit: "c14f518" };
const kinds = (turns: ConversationTurn[]) => turns.map((turn) => turn.kind);
const work = (turns: ConversationTurn[]) =>
  turns.filter((turn): turn is WorkTurn => turn.kind === KIND.WORK);

/** A real run: start, repository work, a material question, the answer, more work, a decision. */
const RUN = [
  events.lifecycle(1, 0, LIFE.PREPARING, LIFE.ACTIVE),
  events.execution(2, 0, EXEC.QUEUED, EXEC.RUNNING),
  events.activity(3, 2, LABEL.ROOT_STARTED),
  events.activity(4, 4, LABEL.RULE_INVESTIGATION_STARTED),
  events.activity(5, 6, LABEL.TASK_STARTED),
  events.activity(6, 9, LABEL.REPOSITORY_INSPECTED, {
    id: "inv-a",
    input: 100,
    output: 20,
  }),
  events.activity(7, 12, LABEL.REPOSITORY_INSPECTED, {
    id: "inv-b",
    input: 200,
    output: 30,
  }),
  events.activity(8, 15, LABEL.TASK_FINISHED),
  events.activity(9, 18, LABEL.MODEL_STEP_COMPLETED, {
    id: "inv-c",
    input: 50,
    output: 10,
  }),
  events.lifecycle(10, 20, LIFE.ACTIVE, LIFE.WAITING_FOR_HUMAN),
  events.humanOpened(11, 20),
  events.execution(12, 21, EXEC.RUNNING, EXEC.PAUSED),
];

test("a Human Resolution interrupt waits for the answer without a Stop/Continue pause notice", () => {
  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: [
      ...RUN.slice(0, -1),
      events.execution(12, 21, EXEC.RUNNING, EXEC.INTERRUPTED),
    ],
    detail: detail({
      lifecycle: LIFE.WAITING_FOR_HUMAN,
      execution: EXEC.INTERRUPTED,
    }),
    requests: [request()],
    repository: REPOSITORY,
  });
  assert.equal(projection.running, false);
  assert.equal(projection.openRequestId, request().requestId);
  assert.equal(
    projection.turns.some(
      (turn) =>
        turn.kind === KIND.NOTICE &&
        turn.notice === CONVERSATION_NOTICE_KINDS.PAUSED,
    ),
    false,
  );
});

test("one deterministic projection turns events into chronological conversation turns", () => {
  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: RUN,
    detail: detail({
      lifecycle: LIFE.WAITING_FOR_HUMAN,
      execution: EXEC.PAUSED,
    }),
    requests: [request()],
    repository: REPOSITORY,
  });

  assert.deepEqual(kinds(projection.turns), [
    KIND.OPENING,
    KIND.WORK,
    KIND.QUESTION,
  ]);
  assert.equal(projection.openRequestId, request().requestId);
  const opening = projection.turns[0];
  assert.equal(opening?.kind, KIND.OPENING);
  if (opening?.kind === KIND.OPENING) {
    assert.equal(opening.repositoryFullName, "acme/notice-service");
    assert.equal(opening.ruleSetVersion, "2026.10.p1");
  }
});

test("related activities collapse into compact steps with counts, never raw event codes", () => {
  const [turn] = work(
    projectConversation({
      assessmentId: ASSESSMENT_ID,
      events: RUN,
      detail: detail({
        lifecycle: LIFE.WAITING_FOR_HUMAN,
        execution: EXEC.PAUSED,
      }),
      requests: [request()],
      repository: REPOSITORY,
    }).turns,
  );
  assert.ok(turn);
  assert.deepEqual(
    turn.steps.map((step) => [step.kind, step.count]),
    [
      [WORK_STEP_KINDS.RULE, 1],
      [WORK_STEP_KINDS.RESEARCH, 1],
      [WORK_STEP_KINDS.INSPECTION, 2],
      [WORK_STEP_KINDS.REASONING, 1],
    ],
  );
  // The opening of the Root run belongs to the OPENING turn, not to work.
  assert.equal(turn.technical.length, 6);
  assert.equal(turn.durationMs, 16_000);
});

test("usage is counted once per invocation: group, turn, then the same total", () => {
  const duplicated = [
    ...RUN,
    events.activity(13, 22, LABEL.REPOSITORY_INSPECTED, {
      id: "inv-a",
      input: 100,
      output: 20,
    }),
  ];
  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: duplicated,
    detail: detail({
      lifecycle: LIFE.WAITING_FOR_HUMAN,
      execution: EXEC.PAUSED,
    }),
    requests: [request()],
    repository: REPOSITORY,
  });
  const [turn] = work(projection.turns);
  assert.ok(turn);
  const inspection = turn.steps.find(
    (step) => step.kind === WORK_STEP_KINDS.INSPECTION,
  );
  assert.deepEqual(inspection?.usage, {
    inputTokens: 300,
    outputTokens: 50,
    totalTokens: 350,
    invocations: 2,
  });
  assert.deepEqual(turn.usage, {
    inputTokens: 350,
    outputTokens: 60,
    totalTokens: 410,
    invocations: 3,
  });
  assert.deepEqual(sumTurnUsage(work(projection.turns)), turn.usage);
});

test("a duplicated canonical event renders once and arrival order never changes the result", () => {
  const input = (list: typeof RUN) => ({
    assessmentId: ASSESSMENT_ID,
    events: list,
    detail: detail({
      lifecycle: LIFE.WAITING_FOR_HUMAN,
      execution: EXEC.PAUSED,
    }),
    requests: [request()],
    repository: REPOSITORY,
  });
  const expected = projectConversation(input(RUN));
  const scrambled = [...RUN, ...RUN.slice(3, 7)].reverse();
  assert.deepEqual(projectConversation(input(scrambled)), expected);
});

test("human resolution survives the answer and a reload as question, user answer, then resumed work", () => {
  const answered = request("RESOLVED", {
    resolvedFactId: "12121212-1212-4121-8121-121212121212",
    answers: [
      {
        idempotencyKey: "answer-key-1",
        requestDigest: "d".repeat(64),
        actorId: "owner-1",
        answeredAt: new Date(Date.UTC(2026, 9, 11, 10, 0, 30)).toISOString(),
        caseRevision: 1,
        requestRevision: 1,
        doesNotKnow: false,
        answer: "yes",
      },
    ],
  });
  const resumed = [
    ...RUN,
    events.execution(13, 31, EXEC.PAUSED, EXEC.RUNNING),
    events.activity(14, 34, LABEL.MODEL_STEP_COMPLETED, {
      id: "inv-d",
      input: 5,
      output: 5,
    }),
  ];
  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: resumed,
    detail: detail({ lifecycle: LIFE.ACTIVE, execution: EXEC.RUNNING }),
    requests: [answered],
    repository: REPOSITORY,
  });
  assert.deepEqual(kinds(projection.turns), [
    KIND.OPENING,
    KIND.WORK,
    KIND.QUESTION,
    KIND.ANSWER,
    KIND.NOTICE, // resumed
    KIND.WORK,
  ]);
  const answer = projection.turns.find((turn) => turn.kind === KIND.ANSWER);
  assert.ok(answer && answer.kind === KIND.ANSWER);
  assert.equal(answer.answer, "yes");
  assert.equal(projection.openRequestId, null);
  const [, second] = work(projection.turns);
  assert.equal(second?.running, true);
});

test("an 'I don't know' answer is a user turn and keeps the question open", () => {
  const unknown = request("OPEN", {
    answers: [
      {
        idempotencyKey: "answer-key-2",
        requestDigest: "e".repeat(64),
        actorId: "owner-1",
        answeredAt: new Date(Date.UTC(2026, 9, 11, 10, 0, 25)).toISOString(),
        caseRevision: 1,
        requestRevision: 1,
        doesNotKnow: true,
        answer: null,
      },
    ],
  });
  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: RUN,
    detail: detail({
      lifecycle: LIFE.WAITING_FOR_HUMAN,
      execution: EXEC.PAUSED,
    }),
    requests: [unknown],
    repository: REPOSITORY,
  });
  const answer = projection.turns.find((turn) => turn.kind === KIND.ANSWER);
  assert.ok(answer && answer.kind === KIND.ANSWER);
  assert.equal(answer.doesNotKnow, true);
  assert.equal(projection.openRequestId, unknown.requestId);
});

test("a spinner exists only while the canonical runtime is RUNNING", () => {
  const live = (
    lifecycle: (typeof LIFE)[keyof typeof LIFE],
    execution: (typeof EXEC)[keyof typeof EXEC],
  ) =>
    projectConversation({
      assessmentId: ASSESSMENT_ID,
      events: RUN.slice(0, 8),
      detail: detail({ lifecycle, execution }),
      requests: [],
      repository: REPOSITORY,
    });
  assert.equal(
    work(live(LIFE.ACTIVE, EXEC.RUNNING).turns).at(-1)?.running,
    true,
  );
  for (const [lifecycle, execution] of [
    [LIFE.PAUSED, EXEC.PAUSED],
    [LIFE.WAITING_FOR_HUMAN, EXEC.PAUSED],
    [LIFE.COMPLETE, EXEC.SUCCEEDED],
    [LIFE.FAILED, EXEC.FAILED],
    [LIFE.BLOCKED, EXEC.PAUSED],
  ] as const) {
    const projection = live(lifecycle, execution);
    assert.equal(projection.running, false, `${lifecycle}/${execution}`);
    assert.ok(
      work(projection.turns).every((turn) => !turn.running),
      `${lifecycle}/${execution}`,
    );
  }
});

test("Stop: RUNNING -> PAUSED ends the animation, adds a quiet notice, and Continue resumes the SAME thread", () => {
  const stopped = [
    ...RUN.slice(0, 8),
    events.execution(9, 17, EXEC.RUNNING, EXEC.PAUSED),
  ];
  const paused = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: stopped,
    detail: detail({ lifecycle: LIFE.PAUSED, execution: EXEC.PAUSED }),
    requests: [],
    repository: REPOSITORY,
  });
  assert.deepEqual(kinds(paused.turns), [KIND.OPENING, KIND.WORK, KIND.NOTICE]);
  assert.ok(work(paused.turns).every((turn) => !turn.running));
  const notice = paused.turns.at(-1);
  assert.ok(notice && notice.kind === KIND.NOTICE);
  assert.equal(notice.notice, CONVERSATION_NOTICE_KINDS.PAUSED);
  assert.equal(
    customerAssessmentState(
      detail({ lifecycle: LIFE.PAUSED, execution: EXEC.PAUSED }).lifecycle,
      detail({ lifecycle: LIFE.PAUSED, execution: EXEC.PAUSED }).runtime,
    ),
    STATE.PAUSED,
  );

  const continued = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: [
      ...stopped,
      events.execution(10, 30, EXEC.PAUSED, EXEC.RUNNING),
      events.activity(11, 33, LABEL.MODEL_STEP_COMPLETED),
    ],
    detail: detail({ lifecycle: LIFE.ACTIVE, execution: EXEC.RUNNING }),
    requests: [],
    repository: REPOSITORY,
  });
  // The earlier turns are unchanged: one conversation, extended, not replaced.
  assert.deepEqual(kinds(continued.turns), [
    KIND.OPENING,
    KIND.WORK,
    KIND.NOTICE,
    KIND.NOTICE,
    KIND.WORK,
  ]);
  assert.equal(work(continued.turns).at(-1)?.running, true);
});

test("an accepted decision becomes assistant output with its readable rule name", () => {
  const projection = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: [...RUN.slice(0, 9), events.decision(10, 40)],
    detail: detail({
      lifecycle: LIFE.ACTIVE,
      execution: EXEC.RUNNING,
      decisions: true,
    }),
    requests: [],
    repository: REPOSITORY,
  });
  const decision = projection.turns.find((turn) => turn.kind === KIND.DECISION);
  assert.ok(decision && decision.kind === KIND.DECISION);
  assert.equal(decision.concept, "Notice retention");
  assert.equal(decision.record.decision.compliance, "NON_COMPLIANT");
  assert.equal(
    projection.turns.indexOf(decision) >
      projection.turns.findIndex((turn) => turn.kind === KIND.WORK),
    true,
  );
});

test("COMPLETE ends with one completion turn, report id and no running work", () => {
  const complete = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: [
      ...RUN.slice(0, 9),
      events.decision(10, 40),
      events.lifecycle(11, 50, LIFE.ACTIVE, LIFE.FINALIZING),
      events.lifecycle(12, 60, LIFE.FINALIZING, LIFE.COMPLETE),
    ],
    detail: detail({
      lifecycle: LIFE.COMPLETE,
      execution: EXEC.SUCCEEDED,
      decisions: true,
      artifact: true,
    }),
    requests: [],
    repository: REPOSITORY,
  });
  assert.equal(complete.running, false);
  assert.ok(work(complete.turns).every((turn) => !turn.running));
  const last = complete.turns.at(-1);
  assert.ok(last && last.kind === KIND.COMPLETION);
  assert.equal(last.evaluated, 1);
  assert.equal(last.nonCompliant, 1);
  assert.equal(last.compliant, 0);
  assert.ok(last.reportArtifactId);
  assert.equal(
    complete.turns.filter((turn) => turn.kind === KIND.COMPLETION).length,
    1,
  );
});

test("customer state collapses lifecycle and execution into one customer word", () => {
  const state = (
    lifecycle: (typeof LIFE)[keyof typeof LIFE],
    execution: (typeof EXEC)[keyof typeof EXEC],
  ) => {
    const value = detail({ lifecycle, execution });
    return customerAssessmentState(value.lifecycle, value.runtime);
  };
  assert.equal(state(LIFE.PREPARING, EXEC.QUEUED), STATE.PREPARING);
  assert.equal(state(LIFE.ACTIVE, EXEC.RUNNING), STATE.WORKING);
  assert.equal(state(LIFE.WAITING_FOR_HUMAN, EXEC.PAUSED), STATE.WAITING);
  assert.equal(state(LIFE.PAUSED, EXEC.PAUSED), STATE.PAUSED);
  assert.equal(state(LIFE.FINALIZING, EXEC.RUNNING), STATE.FINALIZING);
  assert.equal(state(LIFE.COMPLETE, EXEC.SUCCEEDED), STATE.COMPLETE);
  assert.equal(state(LIFE.FAILED, EXEC.FAILED), STATE.FAILED);
  assert.equal(customerAssessmentState(null, null), STATE.UNAVAILABLE);
});
