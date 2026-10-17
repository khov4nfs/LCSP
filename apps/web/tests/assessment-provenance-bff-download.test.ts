import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";
import { GET } from "../src/app/api/assessments/[id]/provenance/download/route.ts";

test("customer BFF download route forwards ETag, X-Checksum-Sha256, X-Content-Fingerprint-Sha256 and body hash matches checksum", async () => {
  const assessmentId = "11111111-1111-4111-8111-111111111111";
  const mockExportPayload = {
    schemaVersion: "assessment.provenance.v1",
    assessmentId,
    name: "Customer Provenance Export",
    ownerId: "user-1",
    contentFingerprintSha256:
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    checksumSha256:
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    lifecycle: { state: "ACTIVE", assessmentRevision: 1 },
    pins: null,
    runtime: null,
    acceptedFacts: [],
    acceptedEvidence: [],
    humanResolutions: [],
    decisions: [],
    coverage: [],
    events: [],
    artifacts: [],
  };

  const fileBytes = Buffer.from(
    JSON.stringify(mockExportPayload, null, 2),
    "utf8",
  );
  const expectedExportChecksum = createHash("sha256")
    .update(fileBytes)
    .digest("hex");
  const expectedFingerprint = mockExportPayload.contentFingerprintSha256;

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
        "content-disposition": `attachment; filename="assessment-${assessmentId}-provenance.json"`,
        etag: `"${expectedExportChecksum}"`,
        "x-checksum-sha256": expectedExportChecksum,
        "x-content-fingerprint-sha256": expectedFingerprint,
      },
    });
  };

  try {
    const request = new NextRequest(
      `http://localhost:3000/api/assessments/${assessmentId}/provenance/download`,
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
        `/assessments/${assessmentId}/provenance/download`,
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
      `attachment; filename="assessment-${assessmentId}-provenance.json"`,
    );

    // Verify downloaded response body hash matches forwarded export checksum and strong ETag
    const responseBytes = Buffer.from(await response.arrayBuffer());
    const actualBodyHash = createHash("sha256")
      .update(responseBytes)
      .digest("hex");

    assert.equal(actualBodyHash, expectedExportChecksum);
    assert.equal(`"${actualBodyHash}"`, etag);
    assert.equal(actualBodyHash, checksumHeader);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("customer BFF download route rejects unauthenticated request with 401", async () => {
  const request = new NextRequest(
    "http://localhost:3000/api/assessments/11111111-1111-4111-8111-111111111111/provenance/download",
  );
  const response = await GET(request, {
    params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
  });
  assert.equal(response.status, 401);
});

test("customer BFF download route rejects invalid UUID with 422", async () => {
  const request = new NextRequest(
    "http://localhost:3000/api/assessments/invalid-uuid/provenance/download",
    {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=session-token-xyz`,
      },
    },
  );
  const response = await GET(request, {
    params: Promise.resolve({ id: "invalid-uuid" }),
  });
  assert.equal(response.status, 422);
});
