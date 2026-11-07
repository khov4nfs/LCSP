import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";
import { GET } from "../src/app/api/assessments/[id]/session-export/download/route.ts";

test("customer BFF session-export download route forwards ETag, X-Checksum-Sha256, X-Content-Fingerprint-Sha256 and body hash matches checksum", async () => {
  const assessmentId = "11111111-1111-4111-8111-111111111111";
  const mockExportPayload = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/assessment-session-export.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  const fileBytes = Buffer.from(
    JSON.stringify(mockExportPayload, null, 2),
    "utf8",
  );
  const expectedExportChecksum = createHash("sha256")
    .update(fileBytes)
    .digest("hex");
  const expectedFingerprint = mockExportPayload.integrity.provenanceSha256;

  const originalFetch = globalThis.fetch;
  let capturedUpstreamUrl: string | undefined;
  let capturedBearer: string | undefined;

  globalThis.fetch = async (input, init) => {
    capturedUpstreamUrl = input.toString();
    const reqHeaders = new Headers(init?.headers);
    capturedBearer = reqHeaders.get("authorization") ?? undefined;

    return new Response(fileBytes, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="assessment-${assessmentId}-session.json"`,
        etag: `"${expectedExportChecksum}"`,
        "x-checksum-sha256": expectedExportChecksum,
        "x-content-fingerprint-sha256": expectedFingerprint,
      },
    });
  };

  try {
    const request = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/session-export/download`,
      {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=session-token-xyz`,
        },
      },
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: assessmentId }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      capturedUpstreamUrl?.includes(
        `/assessments/${assessmentId}/session-export/download`,
      ),
      true,
    );
    assert.equal(capturedBearer, "Bearer session-token-xyz");

    // Verify integrity headers forwarded to the customer browser
    const etag = response.headers.get("etag");
    const checksumHeader = response.headers.get("x-checksum-sha256");
    const fingerprintHeader = response.headers.get(
      "x-content-fingerprint-sha256",
    );

    assert.equal(etag, `"${expectedExportChecksum}"`);
    assert.equal(checksumHeader, expectedExportChecksum);
    assert.equal(fingerprintHeader, expectedFingerprint);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="assessment-${assessmentId}-session.json"`,
    );

    const responseBody = await response.text();
    const downloadedChecksum = createHash("sha256")
      .update(Buffer.from(responseBody, "utf8"))
      .digest("hex");
    assert.equal(downloadedChecksum, expectedExportChecksum);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const scenario of [
  {
    name: "missing session",
    id: "11111111-1111-4111-8111-111111111111",
    authenticated: false,
    status: 401,
  },
  {
    name: "invalid assessment ID",
    id: "not-an-assessment",
    authenticated: true,
    status: 422,
  },
]) {
  test(
    "session export rejects " + scenario.name + " before upstream access",
    async () => {
      const originalFetch = globalThis.fetch;
      let upstreamCalls = 0;
      globalThis.fetch = async () => {
        upstreamCalls += 1;
        throw new Error("Unexpected upstream request");
      };
      try {
        const request = new NextRequest(
          "http://localhost:3000/api/assessments/" +
            scenario.id +
            "/session-export/download",
          {
            headers: scenario.authenticated
              ? { cookie: SESSION_COOKIE_NAME + "=session-fixture" }
              : {},
          },
        );
        const response = await GET(request, {
          params: Promise.resolve({ id: scenario.id }),
        });
        assert.equal(response.status, scenario.status);
        assert.equal(upstreamCalls, 0);
        assert.equal((await response.json()).ok, false);
        assert.equal(response.headers.get("content-disposition"), null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
}
