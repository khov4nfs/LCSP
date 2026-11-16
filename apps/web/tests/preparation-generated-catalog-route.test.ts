import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import {
  PREPARATION_CATALOG_COMPLETENESS,
  PREPARATION_CATALOG_KINDS,
  PREPARATION_CATALOG_UNAVAILABLE_REASONS,
  PREPARATION_CATALOG_SOURCES,
} from "@lcsp/contracts/compliance-rule-set";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store";
import { preparationGeneratedCatalogQueryKey } from "../src/lib/api/compliance-rule-set-queries";
import { GET } from "../src/app/api/admin/compliance-rule-sets/preparations/[preparationRunId]/catalog/route";

const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

function makeRequest(runId: string, query: string, authenticated = true) {
  const headers = new Headers();
  if (authenticated)
    headers.set("cookie", `${SESSION_COOKIE_NAME}=admin-session`);
  return new NextRequest(
    `http://localhost/api/admin/compliance-rule-sets/preparations/${runId}/catalog?${query}`,
    { headers },
  );
}

function unavailableResponse() {
  return {
    preparationRunId: "11111111-1111-4111-8111-111111111111",
    inventoryRevision: 4,
    legalSourceVersionId: "22222222-2222-4222-8222-222222222222",
    materializationId: "materialization-4",
    source: PREPARATION_CATALOG_SOURCES.UNAVAILABLE,
    completeness: PREPARATION_CATALOG_COMPLETENESS.UNAVAILABLE,
    draftVersion: null,
    ruleSetVersionId: null,
    lifecycleState: null,
    unavailableReason:
      PREPARATION_CATALOG_UNAVAILABLE_REASONS.NO_DRAFT_OR_SUBMITTED_RULE_SET,
    kind: PREPARATION_CATALOG_KINDS.REQUIREMENT,
    total: 0,
    filteredTotal: 0,
    items: [],
    hasMore: false,
    nextCursor: null,
  };
}

test("generated catalog BFF validates identity, session, query, response, and query-key scope", async (t) => {
  const runId = "11111111-1111-4111-8111-111111111111";
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ ok: true, data: unavailableResponse() }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  const unauthenticated = await GET(
    makeRequest(runId, "inventoryRevision=4&kind=REQUIREMENT", false),
    { params: Promise.resolve({ preparationRunId: runId }) },
  );
  assert.equal(unauthenticated.status, 401);

  const invalid = await GET(
    makeRequest(runId, "inventoryRevision=0&kind=REQUIREMENT"),
    { params: Promise.resolve({ preparationRunId: runId }) },
  );
  assert.equal(invalid.status, 422);
  assert.equal(calls, 0);

  let authorization = "";
  globalThis.fetch = async (input, init) => {
    calls += 1;
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    assert.match(String(input), /inventoryRevision=4/);
    assert.match(String(input), /kind=REQUIREMENT/);
    return new Response(
      JSON.stringify({ ok: true, data: unavailableResponse() }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  const valid = await GET(
    makeRequest(runId, "inventoryRevision=4&kind=REQUIREMENT"),
    { params: Promise.resolve({ preparationRunId: runId }) },
  );
  assert.equal(valid.status, 200);
  assert.match(authorization, /^Bearer /);

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: { ...unavailableResponse(), items: [{ invalid: true }] },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  const malformed = await GET(
    makeRequest(runId, "inventoryRevision=4&kind=REQUIREMENT"),
    { params: Promise.resolve({ preparationRunId: runId }) },
  );
  assert.equal(malformed.status, 502);

  const base = preparationGeneratedCatalogQueryKey(
    runId,
    4,
    PREPARATION_CATALOG_KINDS.REQUIREMENT,
    undefined,
  );
  const otherRevision = preparationGeneratedCatalogQueryKey(
    runId,
    5,
    PREPARATION_CATALOG_KINDS.REQUIREMENT,
    undefined,
  );
  assert.notDeepEqual(base, otherRevision);
});
