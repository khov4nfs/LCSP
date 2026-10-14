import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { upstreamBinaryRequest } from "../src/lib/server/upstream-request.ts";
import { GET as getPdf } from "../src/app/api/assessments/[id]/artifacts/[artifactId]/report.pdf/route.ts";

test("PDF BFF binary helper preserves bytes and trusted metadata", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer session-token");
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="assessment-a.pdf"',
        "content-length": String(bytes.byteLength),
        "x-lcsp-source-artifact-sha256": "a".repeat(64),
      },
    });
  };
  try {
    const result = await upstreamBinaryRequest("/report.pdf", {
      bearerToken: "session-token",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(new Uint8Array(result.body ?? []), bytes);
    assert.equal(result.contentType, "application/pdf");
    assert.equal(result.contentLength, String(bytes.byteLength));
    assert.equal(result.sourceArtifactSha256, "a".repeat(64));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PDF BFF binary helper does not manufacture bytes for upstream failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  try {
    const result = await upstreamBinaryRequest("/report.pdf");
    assert.equal(result.ok, false);
    assert.equal(result.body, null);
    assert.equal(result.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PDF BFF route rejects missing sessions before contacting the API", async () => {
  const response = await getPdf(
    new NextRequest("http://localhost/api/report.pdf"),
    { params: Promise.resolve({ id: "bad", artifactId: "bad" }) },
  );
  assert.equal(response.status, 401);
});

test("PDF BFF route preserves an authorized binary response", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer session-token");
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="assessment-a.pdf"',
        "content-length": String(bytes.byteLength),
        "x-lcsp-source-artifact-sha256": "a".repeat(64),
      },
    });
  };
  try {
    const id = "11111111-1111-4111-8111-111111111111";
    const response = await getPdf(
      new NextRequest("http://localhost/api/report.pdf", {
        headers: { cookie: "lcsp_session=session-token" },
      }),
      { params: Promise.resolve({ id, artifactId: id }) },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-lcsp-source-artifact-sha256"), "a".repeat(64));
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
