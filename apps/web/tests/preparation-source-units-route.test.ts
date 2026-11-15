import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store";
import { GET } from "../src/app/api/admin/compliance-rule-sets/preparations/[preparationRunId]/source-units/route";

const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

function makeRequest(runId: string, query: string, authenticated = true) {
  const headers = new Headers();
  if (authenticated)
    headers.set("cookie", `${SESSION_COOKIE_NAME}=admin-session`);
  return new NextRequest(
    `http://localhost/api/admin/compliance-rule-sets/preparations/${runId}/source-units?${query}`,
    { headers },
  );
}

function responseData() {
  return {
    preparationRunId: "11111111-1111-4111-8111-111111111111",
    legalSourceVersionId: "22222222-2222-4222-8222-222222222222",
    inventoryRevision: 4,
    materializationId: "materialization-4",
    frontier: {
      revision: 3,
      fingerprint: "frontier-fingerprint",
      stateFingerprint: "state-fingerprint",
      stateAccumulator: "state-accumulator",
      frozenAt: null,
      coverage: {
        total: 0,
        pending: 0,
        inReview: 0,
        reviewedWithClaims: 0,
        reviewedNoClaims: 0,
        blockedReferences: 0,
        persistedClaims: 0,
      },
    },
    units: [],
    hasMore: false,
    nextCursor: null,
  };
}

test("source units BFF validates identity, requires a session, forwards scope, and validates the response", async (t) => {
  let upstreamCalls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test(
    "rejects invalid route and query values before upstream access",
    async () => {
      globalThis.fetch = async () => {
        upstreamCalls += 1;
        throw new Error("invalid requests must not reach upstream");
      };
      const invalidRun = await GET(
        makeRequest("not-a-uuid", "inventoryRevision=4"),
        { params: Promise.resolve({ preparationRunId: "not-a-uuid" }) },
      );
      const invalidQuery = await GET(
        makeRequest(
          "11111111-1111-4111-8111-111111111111",
          "inventoryRevision=0",
        ),
        {
          params: Promise.resolve({
            preparationRunId: "11111111-1111-4111-8111-111111111111",
          }),
        },
      );
      assert.equal(invalidRun.status, 422);
      assert.equal(invalidQuery.status, 422);
      assert.equal(upstreamCalls, 0);
    },
  );

  await t.test(
    "preserves session bearer authorization and rejects malformed upstream data",
    async () => {
      const runId = "11111111-1111-4111-8111-111111111111";
      let authorization: string | null = null;
      let upstreamUrl = "";
      globalThis.fetch = async (input, init) => {
        upstreamCalls += 1;
        upstreamUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization");
        return new Response(
          JSON.stringify({ ok: true, data: responseData() }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };
      const response = await GET(
        makeRequest(runId, "inventoryRevision=4&limit=25&search=Article"),
        { params: Promise.resolve({ preparationRunId: runId }) },
      );
      assert.equal(response.status, 200);
      assert.equal(authorization, "Bearer admin-session");
      const parsedUrl = new URL(upstreamUrl);
      assert.equal(
        parsedUrl.pathname,
        `/admin/compliance-rule-sets/preparations/${runId}/source-units`,
      );
      assert.equal(parsedUrl.searchParams.get("inventoryRevision"), "4");
      assert.equal(parsedUrl.searchParams.get("limit"), "25");
      assert.equal(parsedUrl.searchParams.get("search"), "Article");
      assert.deepEqual((await response.json()).data, responseData());

      globalThis.fetch = async () =>
        new Response(JSON.stringify({ ok: true, data: { units: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const malformedResponse = await GET(
        makeRequest(runId, "inventoryRevision=4"),
        { params: Promise.resolve({ preparationRunId: runId }) },
      );
      assert.equal(malformedResponse.status, 502);
    },
  );

  await t.test(
    "rejects a missing session without calling the upstream API",
    async () => {
      const callsBefore = upstreamCalls;
      const response = await GET(
        makeRequest(
          "11111111-1111-4111-8111-111111111111",
          "inventoryRevision=4",
          false,
        ),
        {
          params: Promise.resolve({
            preparationRunId: "11111111-1111-4111-8111-111111111111",
          }),
        },
      );
      assert.equal(response.status, 401);
      assert.equal(upstreamCalls, callsBefore);
    },
  );
});
