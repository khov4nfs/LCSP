import { describe, expect, it } from "@jest/globals";
import { HUMAN_RESOLUTION_REQUEST_STATUSES } from "@lcsp/contracts/assessment";
import {
  buildHumanAnswerReviewAuthorization,
  humanReviewAllowsCheckpointRebind,
} from "./assessment-human-answer-review.js";

const checkpointId = "11111111-1111-4111-8111-111111111111";
const binding = {
  assessmentId: "assessment-1",
  threadId: "thread-1",
  checkpointId,
};
const request = (requestId = "request-1") => ({
  ...binding,
  requestId,
  requestRevision: 1,
  status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
  resolvedFactId: null,
  answers: [
    {
      idempotencyKey: "unknown-answer-1",
      requestDigest: "a".repeat(64),
      actorId: "owner-1",
      answeredAt: "2026-11-04T00:00:00.000Z",
      caseRevision: 0,
      requestRevision: 1,
      doesNotKnow: true,
      answer: null,
      checkpointId,
    },
  ],
});

describe("checkpoint-bound human answer review authority", () => {
  it("authorizes review of all current unknown responses without granting a fact", () => {
    const rows = [request(), request("request-2")];
    expect(buildHumanAnswerReviewAuthorization(rows, binding)).toEqual({
      checkpointId,
      requests: [
        { requestId: "request-1", requestRevision: 1 },
        { requestId: "request-2", requestRevision: 1 },
      ],
    });
    expect(rows.every((row) => row.resolvedFactId === null)).toBe(true);
  });

  it("does not authorize an empty or partially answered checkpoint", () => {
    expect(buildHumanAnswerReviewAuthorization([], binding)).toBeNull();
    expect(
      buildHumanAnswerReviewAuthorization(
        [request(), { ...request("request-2"), answers: [] }],
        binding,
      ),
    ).toBeNull();
  });

  it.each(["assessmentId", "threadId", "checkpointId"] as const)(
    "rejects a mismatched %s binding",
    (field) =>
      expect(
        buildHumanAnswerReviewAuthorization(
          [{ ...request(), [field]: "wrong" }],
          binding,
        ),
      ).toBeNull(),
  );

  it("rejects responses from an earlier checkpoint or legacy unbound history", () => {
    const row = request();
    row.answers[0].checkpointId = "22222222-2222-4222-8222-222222222222";
    expect(buildHumanAnswerReviewAuthorization([row], binding)).toBeNull();
    const { checkpointId: _checkpoint, ...legacy } = request().answers[0];
    void _checkpoint;
    expect(
      buildHumanAnswerReviewAuthorization(
        [{ ...request(), answers: [legacy] }],
        binding,
      ),
    ).toBeNull();
  });

  it("rejects stale, malformed, resolved or contradictory answer records", () => {
    const row = request();
    expect(
      buildHumanAnswerReviewAuthorization(
        [{ ...row, requestRevision: 2 }],
        binding,
      ),
    ).toBeNull();
    expect(
      buildHumanAnswerReviewAuthorization(
        [{ ...row, answers: [{ doesNotKnow: true }] }],
        binding,
      ),
    ).toBeNull();
    expect(
      buildHumanAnswerReviewAuthorization(
        [{ ...row, status: HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED }],
        binding,
      ),
    ).toBeNull();
    expect(
      buildHumanAnswerReviewAuthorization(
        [{ ...row, resolvedFactId: "fact-1" }],
        binding,
      ),
    ).toBeNull();
    expect(
      buildHumanAnswerReviewAuthorization(
        [{ ...row, answers: [{ ...row.answers[0], answer: "No" }] }],
        binding,
      ),
    ).toBeNull();
  });

  it("requires a fresh response after the graph establishes another wait checkpoint", () => {
    const next = "22222222-2222-4222-8222-222222222222";
    expect(
      buildHumanAnswerReviewAuthorization(
        [{ ...request(), checkpointId: next }],
        { ...binding, checkpointId: next },
      ),
    ).toBeNull();
  });

  it("only permits rebind of the exact request revision authorized by the server", () => {
    const row = request();
    const authorization = buildHumanAnswerReviewAuthorization([row], binding);
    expect(humanReviewAllowsCheckpointRebind(row, authorization)).toBe(true);
    expect(
      humanReviewAllowsCheckpointRebind(
        { ...row, requestRevision: 2 },
        authorization,
      ),
    ).toBe(false);
    expect(
      humanReviewAllowsCheckpointRebind(
        { ...row, requestId: "another-request" },
        authorization,
      ),
    ).toBe(false);
    expect(
      humanReviewAllowsCheckpointRebind(
        { ...row, checkpointId: "another-checkpoint" },
        authorization,
      ),
    ).toBe(false);
    expect(humanReviewAllowsCheckpointRebind(row, null)).toBe(false);
  });
});
