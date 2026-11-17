import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import {
  GET as getInterview,
  POST as submitInterview,
} from "../src/app/api/assessments/[id]/discovery-runs/[runId]/context-answers/route.ts";
import { POST as reviewInterview } from "../src/app/api/assessments/[id]/discovery-runs/[runId]/context-answers/[proposalId]/review/route.ts";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const proposalId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const factNeedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const useCaseId = `sha256:${"e".repeat(64)}`;
const session = "lcsp_session=test-owner-token; lcsp_locale=vi";
const question = "Is the chatbot deployed to production in Vietnam?";
const answer = "Yes, production is deployed in Vietnam.";

function pendingView() {
  return {
    proposalId,
    assessmentId,
    discoveryRunId: runId,
    factNeedId,
    useCaseId,
    question,
    answer,
    status: "PENDING_REVIEW",
    guardFailure: null,
    caseRevision: 0,
    acceptedFactId: null,
    createdAt: "2026-11-17T08:00:00.000Z",
    reviewedAt: null,
  };
}

test("pre-scope interview submit forwards exact scoped answer without accepting fact", async () => {
  const fetchOriginal = globalThis.fetch;
  let receivedPath = "";
  let receivedBody = "";
  let authorization = "";
  globalThis.fetch = async (url, init) => {
    receivedPath = String(url);
    receivedBody = String(init?.body ?? "");
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ ok: true, data: pendingView() });
  };
  try {
    const result = await submitInterview(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/${runId}/context-answers`,
        {
          method: "POST",
          headers: { cookie: session, "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: proposalId,
            useCaseId,
            question,
            answer,
          }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId, runId }) },
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).data.status, "PENDING_REVIEW");
    assert.ok(
      receivedPath.includes(`/discovery-runs/${runId}/context-answers`),
    );
    assert.equal(authorization, "Bearer test-owner-token");
    assert.deepEqual(JSON.parse(receivedBody), {
      idempotencyKey: proposalId,
      useCaseId,
      question,
      answer,
    });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("pre-scope interview rejects malformed answer and anonymous session", async () => {
  const fetchOriginal = globalThis.fetch;
  let forwarded = 0;
  globalThis.fetch = async () => {
    forwarded += 1;
    throw new Error("must not forward");
  };
  try {
    const invalid = await submitInterview(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/${runId}/context-answers`,
        {
          method: "POST",
          headers: { cookie: session, "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: proposalId,
            useCaseId,
            question,
            answer: "",
          }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId, runId }) },
    );
    assert.equal(invalid.status, 422);
    const anonymous = await submitInterview(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/${runId}/context-answers`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: proposalId,
            useCaseId,
            question,
            answer,
          }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId, runId }) },
    );
    assert.equal(anonymous.status, 401);
    assert.equal(forwarded, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("pre-scope interview review forwards explicit action and case revision", async () => {
  const fetchOriginal = globalThis.fetch;
  let receivedBody = "";
  let receivedPath = "";
  globalThis.fetch = async (url, init) => {
    receivedPath = String(url);
    receivedBody = String(init?.body ?? "");
    return Response.json({ ok: true, data: pendingView() });
  };
  try {
    const result = await reviewInterview(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/${runId}/context-answers/${proposalId}/review`,
        {
          method: "POST",
          headers: { cookie: session, "content-type": "application/json" },
          body: JSON.stringify({ action: "REJECT", expectedCaseRevision: 0 }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId, runId, proposalId }) },
    );
    assert.equal(result.status, 200);
    assert.ok(receivedPath.includes(`/context-answers/${proposalId}/review`));
    assert.deepEqual(JSON.parse(receivedBody), {
      action: "REJECT",
      expectedCaseRevision: 0,
    });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("pre-scope interview pagination is owner-scoped and bounded", async () => {
  const fetchOriginal = globalThis.fetch;
  let received = "";
  globalThis.fetch = async (url) => {
    received = String(url);
    return Response.json({
      ok: true,
      data: {
        caseRevision: 0,
        total: 1,
        offset: 0,
        limit: 50,
        nextOffset: null,
        items: [pendingView()],
      },
    });
  };
  try {
    const result = await getInterview(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/${runId}/context-answers?offset=0&limit=50`,
        { headers: { cookie: session } },
      ),
      { params: Promise.resolve({ id: assessmentId, runId }) },
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).data.items.length, 1);
    assert.ok(received.includes(`/discovery-runs/${runId}/context-answers?`));
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
