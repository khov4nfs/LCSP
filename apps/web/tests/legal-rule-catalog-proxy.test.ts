import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import * as C from "@lcsp/contracts/legal-rule-catalog";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";
import { proxyLegalRuleCatalog } from "../src/lib/server/legal-rule-catalog-proxy.ts";

const sessionCookie = "lcsp_session=isolated-session";
const sourceVersionId = "00000000-0000-4000-8000-000000000001";
const savedRuleId = "00000000-0000-4000-8000-000000000002";

function context(segments: string[]) {
  return { params: Promise.resolve({ segments }) };
}

test("GET source provisions forwards query/auth and validates the response", async () => {
  const originalFetch = globalThis.fetch;
  const page = {
    sourceVersionId,
    documentId: "document-1",
    total: 0,
    page: 2,
    pageSize: 25,
    items: [],
    limitations: [],
  };
  let requestedUrl: URL | undefined;
  let requestedAuthorization: string | null = null;
  globalThis.fetch = async (input, init) => {
    requestedUrl = new URL(String(input));
    requestedAuthorization = new Headers(init?.headers).get("authorization");
    return Response.json({ ok: true, data: page });
  };

  try {
    const response = await proxyLegalRuleCatalog(
      new NextRequest(
        `http://localhost/api/admin/legal-rule-catalog/source-provisions?sourceVersionId=${sourceVersionId}&documentId=document-1&page=2&pageSize=25`,
        { headers: { cookie: sessionCookie } },
      ),
      context(["source-provisions"]),
    );

    assert.equal(response.status, 200);
    assert.equal(
      requestedUrl?.pathname,
      "/admin/legal-rule-catalog/source-provisions",
    );
    assert.equal(requestedUrl?.searchParams.get("page"), "2");
    assert.equal(requestedUrl?.searchParams.get("pageSize"), "25");
    assert.equal(requestedUrl?.searchParams.get("documentId"), "document-1");
    assert.equal(
      requestedUrl?.searchParams.get("sourceVersionId"),
      sourceVersionId,
    );
    assert.equal(requestedAuthorization, "Bearer isolated-session");

    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(
      C.legalRuleSourceProvisionPageSchema.safeParse(result.data).success,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST provision import validates and forwards its catalog-scoped body", async () => {
  const originalFetch = globalThis.fetch;
  const importBody = {
    documentId: "document-1",
    locator: "art-5::cl-1::pt-a",
    expectedRevision: 3,
  };
  const saved = { rule: { id: savedRuleId }, catalogRevision: 4 };
  let requestedUrl: URL | undefined;
  let requestedMethod: string | undefined;
  let requestedBody: unknown;
  globalThis.fetch = async (input, init) => {
    requestedUrl = new URL(String(input));
    requestedMethod = init?.method;
    requestedBody = JSON.parse(String(init?.body));
    return Response.json({ ok: true, data: saved });
  };

  try {
    const response = await proxyLegalRuleCatalog(
      new NextRequest(
        "http://localhost/api/admin/legal-rule-catalog/catalog-1/source-provisions/import",
        {
          method: "POST",
          headers: {
            cookie: sessionCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify(importBody),
        },
      ),
      context(["catalog-1", "source-provisions", "import"]),
    );

    assert.equal(response.status, 200);
    assert.equal(
      requestedUrl?.pathname,
      "/admin/legal-rule-catalog/catalog-1/source-provisions/import",
    );
    assert.equal(requestedMethod, "POST");
    assert.deepEqual(requestedBody, importBody);
    assert.equal(
      C.legalRuleSourceProvisionImportSchema.safeParse(requestedBody).success,
      true,
    );
    const result = await response.json();
    assert.equal(C.legalRuleSavedSchema.safeParse(result.data).success, true);

    for (const invalidBody of [undefined, { ...importBody, extra: true }]) {
      const invalidResponse = await proxyLegalRuleCatalog(
        new NextRequest(
          "http://localhost/api/admin/legal-rule-catalog/catalog-1/source-provisions/import",
          {
            method: "POST",
            headers: {
              cookie: sessionCookie,
              "content-type": "application/json",
            },
            ...(invalidBody === undefined
              ? {}
              : { body: JSON.stringify(invalidBody) }),
          },
        ),
        context(["catalog-1", "source-provisions", "import"]),
      );
      assert.equal(invalidResponse.status, 422);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown paths and missing session are rejected before upstream calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ ok: true, data: {} });
  };

  try {
    const unknown = await proxyLegalRuleCatalog(
      new NextRequest(
        "http://localhost/api/admin/legal-rule-catalog/not-a-route",
        {
          headers: { cookie: sessionCookie },
        },
      ),
      context(["not-a-route"]),
    );
    assert.equal(unknown.status, 404);

    const unauthorized = await proxyLegalRuleCatalog(
      new NextRequest(
        "http://localhost/api/admin/legal-rule-catalog/source-provisions",
      ),
      context(["source-provisions"]),
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("backend legal-rule errors retain their status and code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(problemEnvelope(C.LEGAL_RULE_CATALOG_ERRORS.STALE, 409), {
      status: 409,
    });

  try {
    const response = await proxyLegalRuleCatalog(
      new NextRequest(
        "http://localhost/api/admin/legal-rule-catalog/catalog-1/source-provisions/import",
        {
          method: "POST",
          headers: {
            cookie: sessionCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            documentId: "document-1",
            locator: "art-5::cl-1::pt-a",
            expectedRevision: 3,
          }),
        },
      ),
      context(["catalog-1", "source-provisions", "import"]),
    );
    const result = await response.json();

    assert.equal(response.status, 409);
    assert.equal(result.problem.code, C.LEGAL_RULE_CATALOG_ERRORS.STALE);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
