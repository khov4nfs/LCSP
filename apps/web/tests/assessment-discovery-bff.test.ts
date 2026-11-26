import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { POST as startDiscovery } from "../src/app/api/assessments/[id]/discovery-runs/route.ts";
import { GET as latestDiscovery } from "../src/app/api/assessments/[id]/discovery-runs/latest/route.ts";
import { GET as discoveryDetails } from "../src/app/api/assessments/[id]/discovery-runs/[runId]/details/route.ts";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const key = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const batchId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const secondRunId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const cookie = "lcsp_session=authorized-test-session; lcsp_locale=vi";

function queuedView(
  overrides: Partial<{
    runId: string;
    repositoryKey: string | null;
    repositorySnapshotId: string;
    repositoryCommit: string;
    sourcePathPrefix: string | null;
  }> = {},
) {
  return {
    runId,
    assessmentId,
    status: "QUEUED",
    attempt: 1,
    repositoryKey: "web",
    discoveryBatchId: batchId,
    repositorySnapshotId: "snapshot-test",
    repositoryCommit: "a".repeat(40),
    sourcePathPrefix: null,
    requestedAt: "2026-11-17T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    discovery: { available: false, discovery: null },
    ...overrides,
  };
}

/** One "Run discovery" action returns the primary run and every repository's run. */
function queuedBatch(runs = [queuedView()]) {
  return { batchId, run: runs[0], runs };
}

test("pre-scope Discovery POST preserves owner session and strict idempotency", async () => {
  const oldFetch = globalThis.fetch;
  let sentUrl = "";
  let sentBody = "";
  let auth = "";
  globalThis.fetch = async (url, init) => {
    sentUrl = String(url);
    sentBody = String(init?.body ?? "");
    auth = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ ok: true, data: queuedBatch() });
  };
  try {
    const req = new NextRequest(
      `http://localhost/api/assessments/${assessmentId}/discovery-runs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key }),
      },
    );
    const response = await startDiscovery(req, {
      params: Promise.resolve({ id: assessmentId }),
    });
    assert.equal(response.status, 200);
    assert.ok(sentUrl.includes(`/assessments/${assessmentId}/discovery-runs`));
    assert.equal(auth, "Bearer authorized-test-session");
    assert.deepEqual(JSON.parse(sentBody), { idempotencyKey: key });
    const batch = (await response.json()).data;
    assert.equal(batch.run.status, "QUEUED");
    assert.equal(batch.runs.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("pre-scope Discovery rejects missing authentication and invalid command body before upstream", async () => {
  const oldFetch = globalThis.fetch;
  let forwarded = 0;
  globalThis.fetch = async () => {
    forwarded += 1;
    throw new Error("must not reach upstream");
  };
  try {
    const anonymous = await startDiscovery(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs`,
        {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: key }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(anonymous.status, 401);
    const invalid = await startDiscovery(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: "not-a-uuid" }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(invalid.status, 422);
    assert.equal(forwarded, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("pre-scope Discovery latest and candidate paging remain read-only owner requests", async () => {
  const oldFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    requests.push(requestUrl);
    if (requestUrl.endsWith("/latest")) {
      return Response.json({
        ok: true,
        data: { available: false, run: null },
      });
    }
    return Response.json({
      ok: true,
      data: {
        recordId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        contentDigest: `sha256:${"a".repeat(64)}`,
        collection: "RULE_CANDIDATES",
        total: 0,
        offset: 0,
        limit: 100,
        nextOffset: null,
        items: [],
      },
    });
  };
  try {
    const latest = await latestDiscovery(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/latest`,
        {
          headers: { cookie },
        },
      ),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(latest.status, 200);
    assert.deepEqual((await latest.json()).data, {
      available: false,
      run: null,
      runs: [],
    });

    const page = await discoveryDetails(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/${runId}/details?collection=RULE_CANDIDATES&offset=0&limit=100`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ id: assessmentId, runId }) },
    );
    assert.equal(page.status, 200);
    assert.equal((await page.json()).data.total, 0);
    assert.ok(requests[1]?.includes(`/discovery-runs/${runId}/details?`));
    assert.ok(requests[1]?.includes("collection=RULE_CANDIDATES"));
  } finally {
    globalThis.fetch = oldFetch;
  }
});
test("pre-scope Discovery pages AI use cases without granting audit or fact authority", async () => {
  const oldFetch = globalThis.fetch;
  const requests: string[] = [];
  let auth = "";
  globalThis.fetch = async (url, init) => {
    requests.push(String(url));
    auth = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({
      ok: true,
      data: {
        recordId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        contentDigest: `sha256:${"b".repeat(64)}`,
        collection: "AI_USE_CASES",
        total: 0,
        offset: 0,
        limit: 100,
        nextOffset: null,
        items: [],
      },
    });
  };
  try {
    const response = await discoveryDetails(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/${runId}/details?collection=AI_USE_CASES&offset=0&limit=100`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ id: assessmentId, runId }) },
    );
    assert.equal(response.status, 200);
    assert.equal(auth, "Bearer authorized-test-session");
    assert.equal((await response.json()).data.collection, "AI_USE_CASES");
    assert.ok(requests[0]?.includes("collection=AI_USE_CASES"));
    assert.ok(requests[0]?.includes("offset=0"));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("pre-scope Discovery start returns one run per pinned repository in one batch", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      data: queuedBatch([
        queuedView(),
        queuedView({
          runId: secondRunId,
          repositoryKey: "api",
          repositorySnapshotId: "snapshot-api",
          repositoryCommit: "b".repeat(40),
          sourcePathPrefix: "services/billing",
        }),
      ]),
    });
  try {
    const response = await startDiscovery(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: key }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(response.status, 200);
    const batch = (await response.json()).data;
    assert.equal(batch.batchId, batchId);
    assert.deepEqual(
      batch.runs.map((run: { repositoryKey: string }) => run.repositoryKey),
      ["web", "api"],
    );
    assert.equal(batch.run.runId, runId);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("pre-scope Discovery latest restores every repository run of the newest batch", async () => {
  const oldFetch = globalThis.fetch;
  const second = queuedView({
    runId: secondRunId,
    repositoryKey: "api",
    repositorySnapshotId: "snapshot-api",
    repositoryCommit: "b".repeat(40),
    sourcePathPrefix: "services/billing",
  });
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      data: {
        available: true,
        run: queuedView(),
        runs: [queuedView(), second],
      },
    });
  try {
    const latest = await latestDiscovery(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs/latest`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(latest.status, 200);
    const data = (await latest.json()).data;
    assert.equal(data.runs.length, 2);
    assert.equal(data.runs[1].sourcePathPrefix, "services/billing");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("pre-scope Discovery rejects a batch whose repository key is malformed before it reaches the page", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      data: queuedBatch([queuedView({ repositoryKey: "Not A Key" })]),
    });
  try {
    const response = await startDiscovery(
      new NextRequest(
        `http://localhost/api/assessments/${assessmentId}/discovery-runs`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: key }),
        },
      ),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.notEqual(response.status, 200);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
