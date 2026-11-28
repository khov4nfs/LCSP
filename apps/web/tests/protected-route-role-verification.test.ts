import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { proxy } from "../src/proxy.ts";

test("verified profiles with an unknown role cannot render customer assessment clients", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(Response.json({ ok: true, data: { role: "UNKNOWN" } }));
  try {
    const response = await proxy(
      new NextRequest("http://localhost/assessments/example", {
        headers: { cookie: "lcsp_session=unknown-role-session" },
      }),
    );

    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "http://localhost/sign-in");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("profile verification failures stop protected page rendering", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      Response.json(
        {
          ok: false,
          problem: { status: 503, code: "UPSTREAM_UNAVAILABLE" },
        },
        { status: 503 },
      ),
    );
  try {
    const response = await proxy(
      new NextRequest("http://localhost/assessments/example", {
        headers: { cookie: "lcsp_session=unverified-session" },
      }),
    );

    assert.equal(response.status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
