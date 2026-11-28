import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { proxyPreparationActivity } from "../src/lib/server/preparation-activity-proxy.ts";
import { proxyPreparationActivityStream } from "../src/lib/server/preparation-activity-stream-proxy.ts";
const wire = JSON.parse(
  readFileSync(
    new URL(
      "../src/public/assets/mocks/preparation-observability.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("Preparation BFF binds exact run/cursor and forwards credentials, rejecting malformed and unauthenticated reads", async () => {
  const original = globalThis.fetch;
  let captured: URL | undefined;
  let calls = 0;
  globalThis.fetch = (input, init) => {
    calls++;
    captured = new URL(String(input));
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer isolated-session",
    );
    return Promise.resolve(Response.json({ ok: true, data: wire.page }));
  };
  const context = {
    params: Promise.resolve({ preparationRunId: wire.run.preparationRunId }),
  };
  try {
    const result = await proxyPreparationActivity(
      new NextRequest(
        `http://localhost/api/preparation?limit=100&cursor=${wire.page.nextCursor}`,
        { headers: { cookie: "lcsp_session=isolated-session" } },
      ),
      context,
    );
    assert.equal(result.status, 200);
    assert(captured?.pathname.includes(wire.run.preparationRunId));
    assert.equal(captured?.searchParams.get("cursor"), wire.page.nextCursor);
    const bad = await proxyPreparationActivity(
      new NextRequest("http://localhost/api/preparation?limit=501", {
        headers: { cookie: "lcsp_session=isolated-session" },
      }),
      context,
    );
    assert.equal(bad.status, 422);
    assert.equal(calls, 1);
    const unauthorized = await proxyPreparationActivity(
      new NextRequest("http://localhost/api/preparation"),
      context,
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Preparation stream BFF binds the exact run and proxies SSE credentials", async () => {
  const original = globalThis.fetch;
  let captured: URL | undefined;
  globalThis.fetch = (input, init) => {
    captured = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer isolated-session");
    assert.equal(headers.get("x-correlation-id"), "stream-correlation-id");
    return Promise.resolve(
      new Response("event: preparation.activity\ndata: {}\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
  };
  try {
    const response = await proxyPreparationActivityStream(
      new NextRequest("http://localhost/api/preparation/stream", {
        headers: {
          cookie: "lcsp_session=isolated-session",
          "x-correlation-id": "stream-correlation-id",
        },
      }),
      {
        params: Promise.resolve({
          preparationRunId: wire.run.preparationRunId,
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(
      captured?.pathname,
      `/admin/compliance-rule-sets/preparations/${wire.run.preparationRunId}/activity/stream`,
    );
  } finally {
    globalThis.fetch = original;
  }
});
