import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as completeRepositorySetup } from "../src/app/api/assessments/[id]/repository-setup/complete/route.ts";
import { DELETE as removeRepository } from "../src/app/api/assessments/[id]/repository-setup/repositories/[snapshotId]/route.ts";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const session = "lcsp_session=session-test-token-xyz";

type Capture = { url: string; method: string; body: string | null };

function stubUpstream(data: unknown) {
  const original = globalThis.fetch;
  const captured: Capture[] = [];
  globalThis.fetch = async (input, init) => {
    captured.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    return Response.json({ ok: true, data });
  };
  return { captured, restore: () => (globalThis.fetch = original) };
}

const completion = {
  assessment_id: assessmentId,
  repository_connection_id: "conn-1",
  snapshot_id: "snap-1",
  commit_sha: "a".repeat(40),
  repositories: [
    {
      repository_key: "web",
      connection_id: "conn-1",
      snapshot_id: "snap-1",
      commit_sha: "a".repeat(40),
    },
  ],
};

const completeRequest = (body?: unknown) =>
  new NextRequest(
    `http://localhost:3000/api/assessments/${assessmentId}/repository-setup/complete`,
    {
      method: "POST",
      headers: { cookie: session, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );

test("BFF complete forwards the exact snapshot list the web chose", async () => {
  const upstream = stubUpstream(completion);
  try {
    const response = await completeRepositorySetup(
      completeRequest({ snapshotIds: ["snap-1", "snap-2"] }),
      { params: Promise.resolve({ id: assessmentId }) },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(upstream.captured[0]!.body!), {
      snapshotIds: ["snap-1", "snap-2"],
    });
    const payload = (await response.json()) as {
      data: { repositories: unknown[] };
    };
    assert.equal(payload.data.repositories.length, 1);
  } finally {
    upstream.restore();
  }
});

test("BFF complete accepts a request without a body as no explicit list", async () => {
  const upstream = stubUpstream(completion);
  try {
    const response = await completeRepositorySetup(completeRequest(), {
      params: Promise.resolve({ id: assessmentId }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(upstream.captured[0]!.body!), {});
  } finally {
    upstream.restore();
  }
});

test("BFF complete rejects unknown fields, an empty list and more snapshots than the limit before the API", async () => {
  const upstream = stubUpstream(completion);
  try {
    for (const body of [
      { snapshotIds: [] },
      { snapshotIds: ["a", "b", "c", "d", "e", "f"] },
      { snapshotIds: ["a"], extra: true },
    ]) {
      const response = await completeRepositorySetup(completeRequest(body), {
        params: Promise.resolve({ id: assessmentId }),
      });
      assert.equal(response.status, 422);
    }
    assert.equal(upstream.captured.length, 0);
  } finally {
    upstream.restore();
  }
});

const removeRequest = (snapshotId: string) =>
  new NextRequest(
    `http://localhost:3000/api/assessments/${assessmentId}/repository-setup/repositories/${snapshotId}`,
    { method: "DELETE", headers: { cookie: session } },
  );

test("BFF removal proxies a DELETE for the snapshot and validates the answer", async () => {
  const upstream = stubUpstream({
    assessment_id: assessmentId,
    snapshot_id: "snap-1",
    connection_id: "conn-1",
    connection_revoked: false,
  });
  try {
    const response = await removeRepository(removeRequest("snap-1"), {
      params: Promise.resolve({ id: assessmentId, snapshotId: "snap-1" }),
    });
    assert.equal(response.status, 200);
    assert.equal(upstream.captured[0]?.method, "DELETE");
    assert.ok(
      upstream.captured[0]?.url.endsWith(
        `/assessments/${assessmentId}/repository-setup/repositories/snap-1`,
      ),
    );
  } finally {
    upstream.restore();
  }
});

test("BFF removal never forwards a malformed snapshot id, a bad assessment id or an anonymous call", async () => {
  const upstream = stubUpstream({});
  try {
    const traversal = await removeRepository(removeRequest("..%2Fsecrets"), {
      params: Promise.resolve({ id: assessmentId, snapshotId: "../secrets" }),
    });
    assert.equal(traversal.status, 422);

    const badAssessment = await removeRepository(removeRequest("snap-1"), {
      params: Promise.resolve({ id: "not-a-uuid", snapshotId: "snap-1" }),
    });
    assert.equal(badAssessment.status, 422);

    const anonymous = await removeRepository(
      new NextRequest(
        `http://localhost:3000/api/assessments/${assessmentId}/repository-setup/repositories/snap-1`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ id: assessmentId, snapshotId: "snap-1" }) },
    );
    assert.equal(anonymous.status, 401);
    assert.equal(upstream.captured.length, 0);
  } finally {
    upstream.restore();
  }
});

test("BFF removal rejects an upstream answer that does not match the contract", async () => {
  const upstream = stubUpstream({ unexpected: true });
  try {
    const response = await removeRepository(removeRequest("snap-1"), {
      params: Promise.resolve({ id: assessmentId, snapshotId: "snap-1" }),
    });
    assert.equal(response.status, 502);
  } finally {
    upstream.restore();
  }
});
