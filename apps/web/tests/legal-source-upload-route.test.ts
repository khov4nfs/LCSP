import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  LEGAL_SOURCE_LIMITS,
  LEGAL_SOURCE_CHUNK_STATUSES,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES,
  LEGAL_SOURCE_STRUCTURE_PROFILES,
  legalSourceVersionDetailSchema,
  updateLegalSourceDocumentEffectSchema,
} from "@lcsp/contracts/legal-source";

import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";
import { POST } from "../src/app/api/admin/legal-source-versions/[versionId]/documents/upload/route.ts";
import { PATCH } from "../src/app/api/admin/legal-source-versions/[versionId]/documents/[documentRowId]/effect/route.ts";

const fixtureText = await readFile(
  new URL(
    "../src/public/assets/mocks/legal-source-management.json",
    import.meta.url,
  ),
  "utf8",
);
const fixtureData = JSON.parse(fixtureText) as Record<string, unknown>;
const version = legalSourceVersionDetailSchema.parse(fixtureData.versionDraft);
const versionId = version.id;
const context = { params: Promise.resolve({ versionId }) };
const documentRowId = version.documents[0].id;
const effectContext = {
  params: Promise.resolve({ versionId, documentRowId }),
};

function uploadRequest(input: { file?: File; authenticated?: boolean }) {
  const form = new FormData();
  if (input.file) form.set("file", input.file);
  form.set("title", "Synthetic document title");
  form.set("structureProfile", LEGAL_SOURCE_STRUCTURE_PROFILES.ARTICLES);
  form.set("sourceEffectStatus", "EFFECTIVE");
  form.set("effectiveDate", "2026-10-01");
  form.set(
    "provisionStatuses",
    JSON.stringify({
      "Article 1": {
        status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
        sourceRef: "source metadata p. 2",
      },
    }),
  );
  return new NextRequest(
    `http://localhost/api/admin/legal-source-versions/${versionId}/documents/upload`,
    {
      method: "POST",
      headers: input.authenticated
        ? { cookie: `${SESSION_COOKIE_NAME}=test-session` }
        : undefined,
      body: form,
    },
  );
}

function installUpstreamFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => void (globalThis.fetch = original);
}

test("upload BFF forwards raw file bytes and validated metadata in the query", async () => {
  const document = version.documents[0];
  let upstreamUrl = "";
  let upstreamInit: RequestInit | undefined;
  const restore = installUpstreamFetch(async (input, init) => {
    upstreamUrl = String(input);
    upstreamInit = init;
    return Response.json({ ok: true, data: document }, { status: 201 });
  });
  try {
    const file = new File(["synthetic file bytes"], "neutral.txt", {
      type: "text/plain",
    });
    const response = await POST(
      uploadRequest({ file, authenticated: true }),
      context,
    );
    assert.equal(response.status, 201);
    const target = new URL(upstreamUrl);
    assert.equal(
      target.pathname,
      `/admin/legal-source-versions/${versionId}/documents/upload`,
    );
    assert.equal(target.searchParams.get("fileName"), "neutral.txt");
    assert.equal(target.searchParams.get("title"), "Synthetic document title");
    assert.equal(
      target.searchParams.get("structureProfile"),
      LEGAL_SOURCE_STRUCTURE_PROFILES.ARTICLES,
    );
    assert.equal(target.searchParams.get("sourceEffectStatus"), "EFFECTIVE");
    assert.equal(target.searchParams.get("effectiveDate"), "2026-10-01");
    assert.deepEqual(
      JSON.parse(target.searchParams.get("provisionStatuses") ?? "null"),
      {
        "Article 1": {
          status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
          sourceRef: "source metadata p. 2",
        },
      },
    );
    assert.equal(
      new Headers(upstreamInit?.headers).get("content-type"),
      "text/plain",
    );
    const forwarded = await new Response(upstreamInit?.body as BodyInit).text();
    assert.equal(forwarded, "synthetic file bytes");
    assert.equal(response.headers.get("cache-control"), null);
  } finally {
    restore();
  }
});

test("upload BFF rejects a file larger than the contract limit before forwarding", async () => {
  let forwarded = false;
  const restore = installUpstreamFetch(async () => {
    forwarded = true;
    return Response.json({ ok: true, data: version.documents[0] });
  });
  try {
    const file = new File(
      [new Uint8Array(LEGAL_SOURCE_LIMITS.maxDocumentBytes + 1)],
      "large.txt",
      { type: "text/plain" },
    );
    const response = await POST(
      uploadRequest({ file, authenticated: true }),
      context,
    );
    const result = await response.json();
    assert.equal(response.status, 413);
    assert.equal(
      result.problem.code,
      LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentTooLarge,
    );
    assert.equal(forwarded, false);
  } finally {
    restore();
  }
});

test("upload BFF requires a session before forwarding", async () => {
  let forwarded = false;
  const restore = installUpstreamFetch(async () => {
    forwarded = true;
    return Response.json({ ok: true, data: version.documents[0] });
  });
  try {
    const file = new File(["synthetic file bytes"], "neutral.txt", {
      type: "text/plain",
    });
    const response = await POST(uploadRequest({ file }), context);
    const result = await response.json();
    assert.equal(response.status, 401);
    assert.equal(result.problem.code, AUTH_ERROR_CODES.sessionInvalid);
    assert.equal(forwarded, false);
  } finally {
    restore();
  }
});

test("effect BFF forwards validated status metadata to the draft document endpoint", async () => {
  const effect = updateLegalSourceDocumentEffectSchema.parse({
    status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
    sourceRef: "official status metadata",
    effectiveDate: "2026-03-01",
    provisionStatuses: {
      "art-2": {
        status: LEGAL_SOURCE_CHUNK_STATUSES.REPEALED,
        sourceRef: "source article 9",
      },
    },
  });
  let upstreamUrl = "";
  let upstreamInit: RequestInit | undefined;
  const restore = installUpstreamFetch(async (input, init) => {
    upstreamUrl = String(input);
    upstreamInit = init;
    return Response.json({ ok: true, data: version.documents[0] });
  });
  try {
    const request = new NextRequest(
      `http://localhost/api/admin/legal-source-versions/${versionId}/documents/${documentRowId}/effect`,
      {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=test-session` },
        body: JSON.stringify(effect),
      },
    );
    const response = await PATCH(request, effectContext);
    assert.equal(response.status, 200);
    assert.equal(
      new URL(upstreamUrl).pathname,
      `/admin/legal-source-versions/${versionId}/documents/${documentRowId}/effect`,
    );
    assert.equal(upstreamInit?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(upstreamInit?.body)), effect);
  } finally {
    restore();
  }
});
