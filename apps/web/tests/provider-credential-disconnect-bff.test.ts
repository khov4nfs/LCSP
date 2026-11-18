import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import { DELETE } from "../src/app/api/provider-credentials/[provider]/route.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

const call = (provider: string, withSession = true) =>
  DELETE(
    new NextRequest(`http://localhost/api/provider-credentials/${provider}`, {
      method: "DELETE",
      headers: withSession
        ? { cookie: `${SESSION_COOKIE_NAME}=test-only-session` }
        : {},
    }),
    { params: Promise.resolve({ provider }) },
  );

test("disconnect BFF forwards only known providers with the caller's bearer token", async () => {
  const original = globalThis.fetch;
  try {
    let upstreamCalls = 0;
    let captured: { url: string; method?: string; auth: string | null } | null =
      null;
    globalThis.fetch = async (input, init) => {
      upstreamCalls++;
      captured = {
        url: String(input),
        method: init?.method,
        auth: new Headers(init?.headers).get("authorization"),
      };
      return Response.json({
        ok: true,
        data: {
          provider: CREDENTIAL_PROVIDERS.gitlab,
          configured: false,
          status: "REVOKED",
        },
      });
    };

    assert.equal((await call(CREDENTIAL_PROVIDERS.gitlab, false)).status, 401);
    assert.equal(upstreamCalls, 0);

    assert.equal((await call("NOT_A_PROVIDER")).status, 400);
    assert.equal((await call("../auth/sessions")).status, 400);
    assert.equal(upstreamCalls, 0);

    const response = await call(CREDENTIAL_PROVIDERS.gitlab);
    assert.equal(response.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.equal(captured!.method, "DELETE");
    assert.equal(captured!.auth, "Bearer test-only-session");
    assert.match(captured!.url, /\/provider-credentials\/GITLAB$/);
  } finally {
    globalThis.fetch = original;
  }
});

test("disconnect BFF forwards backend reauthentication problems unchanged", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        {
          ok: false,
          problem: { code: AUTH_ERROR_CODES.reauthRequired, status: 403 },
        },
        { status: 403 },
      );
    const response = await call(CREDENTIAL_PROVIDERS.github);
    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).problem.code,
      AUTH_ERROR_CODES.reauthRequired,
    );
  } finally {
    globalThis.fetch = original;
  }
});
