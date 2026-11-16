import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { DELETE } from "../src/app/api/auth/sessions/route.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

test("all-device logout BFF clears cookies only after a validated backend acknowledgment", async () => {
  const original = globalThis.fetch;
  const request = () =>
    new NextRequest("http://localhost/api/auth/sessions", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=test-only-session` },
    });
  try {
    let calls = 0;
    globalThis.fetch = async (_input, init) => {
      calls++;
      assert.equal(init?.method, "DELETE");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-only-session",
      );
      return Response.json({ ok: true, data: { revoked_all: true } });
    };
    const missing = await DELETE(
      new NextRequest("http://localhost/api/auth/sessions", {
        method: "DELETE",
      }),
    );
    assert.equal(missing.status, 401);
    assert.equal(calls, 0);
    const success = await DELETE(request());
    assert.equal(success.status, 200);
    assert.match(success.headers.get("set-cookie") ?? "", /lcsp_session=;/);
    assert.deepEqual(await success.json(), {
      ok: true,
      data: { revoked_all: true },
    });

    globalThis.fetch = async () => Response.json({ ok: true, data: {} });
    const malformed = await DELETE(request());
    assert.equal(malformed.status, 502);
    assert.equal(malformed.headers.get("set-cookie"), null);

    globalThis.fetch = async () =>
      Response.json(
        {
          ok: false,
          problem: { code: AUTH_ERROR_CODES.reauthRequired, status: 403 },
        },
        { status: 403 },
      );
    const rejected = await DELETE(request());
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("set-cookie"), null);
    assert.equal(
      (await rejected.json()).problem.code,
      AUTH_ERROR_CODES.reauthRequired,
    );

    globalThis.fetch = async () => {
      throw new Error("connection failed");
    };
    const offline = await DELETE(request());
    assert.equal(offline.status, 503);
    assert.equal(offline.headers.get("set-cookie"), null);
  } finally {
    globalThis.fetch = original;
  }
});
