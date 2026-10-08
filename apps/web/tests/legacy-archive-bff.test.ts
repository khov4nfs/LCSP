import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { LEGACY_MIGRATION_ERROR_CODES } from "@lcsp/contracts/legacy-migration";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";

import {
  proxyLegacyArchiveDetail,
  proxyLegacyArchiveDownload,
} from "../src/lib/server/legacy-archive-proxy.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

const RECORD = "05437c7a-526b-c231-1bf5-fe4e391845b2";
const request = (path: string, signedIn = true) =>
  new NextRequest(`http://localhost${path}`, {
    headers: signedIn ? { cookie: `${SESSION_COOKIE_NAME}=session-token` } : {},
  });

const detail = {
  assessment_id: "a1",
  name: "Old assessment",
  disposition: "ARCHIVED_TERMINAL",
  legacy_status: "READY_FOR_REVIEW",
  legacy_created_at: "2026-08-01T08:00:00.000Z",
  legacy_updated_at: "2026-08-01T09:00:00.000Z",
  archived_at: "2026-10-08T00:00:00.000Z",
  v2_lifecycle_state: null,
  report_count: 0,
  downloadable_report_count: 0,
  reports: [],
  correlationId: "corr",
};

function stubFetch(
  context: test.TestContext,
  respond: (url: URL, init: RequestInit) => Response,
) {
  const original = globalThis.fetch;
  const calls: { url: URL; init: RequestInit }[] = [];
  context.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async (url: URL | string, init: RequestInit) => {
    const parsed = new URL(String(url));
    calls.push({ url: parsed, init });
    return respond(parsed, init);
  }) as typeof fetch;
  return calls;
}

test("detail proxies to the archive API with the session bearer and returns the validated body", async (context) => {
  const calls = stubFetch(context, () =>
    Response.json({ ok: true, data: detail }),
  );
  const response = await proxyLegacyArchiveDetail(request("/x"), "a1");
  assert.equal(response.status, 200);
  assert.equal(calls[0].url.pathname, "/legacy-archive/assessments/a1");
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    "Bearer session-token",
  );
  assert.deepEqual(((await response.json()) as { data: unknown }).data, detail);
});

test("detail refuses without a session, with a bad id, and with a malformed upstream body", async (context) => {
  const calls = stubFetch(context, () =>
    Response.json({ ok: true, data: { not: "an archive" } }),
  );
  const anonymous = await proxyLegacyArchiveDetail(request("/x", false), "a1");
  assert.equal(anonymous.status, 401);
  assert.equal(
    ((await anonymous.json()) as { problem: { code: string } }).problem.code,
    AUTH_ERROR_CODES.sessionInvalid,
  );
  const invalid = await proxyLegacyArchiveDetail(request("/x"), "");
  assert.equal(invalid.status, 422);
  assert.equal(
    calls.length,
    0,
    "no upstream call without a valid session and id",
  );
  const broken = await proxyLegacyArchiveDetail(request("/x"), "a1");
  assert.equal(broken.status, 502);
  assert.equal(
    ((await broken.json()) as { problem: { code: string } }).problem.code,
    SHARED_ERROR_CODES.upstreamResponseInvalid,
  );
});

test("a missing or foreign archive is forwarded as the API's 404 problem", async (context) => {
  stubFetch(context, () =>
    Response.json(
      {
        ok: false,
        problem: {
          type: "p",
          status: 404,
          code: LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_NOT_FOUND,
          titleKey: "auth.errors.validationFailed.title",
          detailKey: "auth.errors.validationFailed.detail",
          requiredAction: "none",
          correlationId: "c",
        },
      },
      { status: 404 },
    ),
  );
  const response = await proxyLegacyArchiveDetail(request("/x"), "a1");
  assert.equal(response.status, 404);
  assert.equal(
    ((await response.json()) as { problem: { code: string } }).problem.code,
    LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_NOT_FOUND,
  );
});

test("download streams the preserved bytes with safe headers and validates both ids", async (context) => {
  const bytes = Buffer.from("# preserved\n");
  const calls = stubFetch(
    context,
    () =>
      new Response(bytes, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": 'attachment; filename="legacy-report.md"',
        },
      }),
  );
  const response = await proxyLegacyArchiveDownload(
    request("/x"),
    "a1",
    RECORD,
  );
  assert.equal(response.status, 200);
  assert.equal(
    calls[0].url.pathname,
    `/legacy-archive/assessments/a1/reports/${RECORD}/download`,
  );
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(bytes));
  assert.equal(
    response.headers.get("content-type"),
    "text/markdown; charset=utf-8",
  );
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /^attachment/u,
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);

  const before = calls.length;
  assert.equal(
    (await proxyLegacyArchiveDownload(request("/x"), "a1", "../etc/passwd"))
      .status,
    422,
  );
  assert.equal(
    (await proxyLegacyArchiveDownload(request("/x", false), "a1", RECORD))
      .status,
    401,
  );
  assert.equal(calls.length, before, "invalid requests never reach the API");
});
