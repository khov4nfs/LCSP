import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  proxyLocalizationScope,
  proxyLocalizationBacklog,
} from "../src/lib/server/localization-admin-proxy.ts";

test("Admin BFF forwards exact scope/job cursors and filters, validates envelopes and rejects malformed cursor before upstream", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/rule-grouping-review.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer isolated-admin-session",
    );
    return Promise.resolve(
      Response.json({
        ok: true,
        data: url.pathname.endsWith("/admin/localization")
          ? wire.localizationBacklog
          : wire.localizationQueue,
      }),
    );
  };
  const headers = { cookie: "lcsp_session=isolated-admin-session" };
  const cursor = "00000000-0000-4000-8000-000000000064";
  try {
    const backlog = await proxyLocalizationBacklog(
      new NextRequest(
        "http://localhost/api/admin/localization?afterScopeId=scope-25",
        { headers },
      ),
    );
    assert.equal(backlog.status, 200);
    assert.equal(calls.at(-1)!.searchParams.get("afterScopeId"), "scope-25");
    const queue = await proxyLocalizationScope(
      new NextRequest(
        `http://localhost/api/admin/localization/scope-30?after=${cursor}&filter=OUTPUT_REVIEW_REQUIRED`,
        { headers },
      ),
      { params: Promise.resolve({ scopeId: "scope-30" }) },
    );
    assert.equal(queue.status, 200);
    assert.equal(calls.at(-1)!.searchParams.get("after"), cursor);
    assert.equal(
      calls.at(-1)!.searchParams.get("filter"),
      "OUTPUT_REVIEW_REQUIRED",
    );
    assert.equal((await queue.json()).data.hasMore, false);
    const count = calls.length;
    const invalid = await proxyLocalizationScope(
      new NextRequest(
        "http://localhost/api/admin/localization/scope-30?after=invalid",
        { headers },
      ),
      { params: Promise.resolve({ scopeId: "scope-30" }) },
    );
    assert.equal(invalid.status, 422);
    assert.equal(calls.length, count);
    const unauthorized = await proxyLocalizationBacklog(
      new NextRequest("http://localhost/api/admin/localization"),
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, count);
  } finally {
    globalThis.fetch = original;
  }
});
