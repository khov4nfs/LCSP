import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET as getIdentities } from "../src/app/api/auth/oauth/identities/route.ts";
import { GET as oauthCallback } from "../src/app/api/auth/oauth/callback/[provider]/route.ts";
import { GET as linkCallback } from "../src/app/api/auth/oauth/link/callback/[provider]/route.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

test("GET /api/auth/oauth/identities requires an authenticated session", async () => {
  const req = new NextRequest("http://localhost/api/auth/oauth/identities");
  const res = await getIdentities(req);
  assert.equal(res.status, 401);
});

test("GET /api/auth/oauth/identities forwards bearer token and returns validated identities", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedAuth = "";
    globalThis.fetch = async (_input, init) => {
      capturedAuth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({
        ok: true,
        data: {
          identities: [
            {
              id: "id-1",
              provider: "google",
              linked_at: "2026-11-24T09:00:00.000Z",
            },
          ],
        },
      });
    };

    const req = new NextRequest("http://localhost/api/auth/oauth/identities", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid-session-token` },
    });
    const res = await getIdentities(req);
    assert.equal(res.status, 200);
    assert.equal(capturedAuth, "Bearer valid-session-token");
    const json = await res.json();
    assert.deepEqual(json, {
      ok: true,
      data: {
        identities: [
          {
            id: "id-1",
            provider: "google",
            linked_at: "2026-11-24T09:00:00.000Z",
          },
        ],
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("direct link callback route forwards callback to upstream and normalizes outcome", async () => {
  const originalFetch = globalThis.fetch;
  const sessionCookie = `${SESSION_COOKIE_NAME}=valid-session-token`;

  try {
    globalThis.fetch = async () =>
      Response.json({
        ok: true,
        data: { provider: "google", linked: true },
      });

    const req = new NextRequest(
      "http://localhost/api/auth/oauth/link/callback/google?state=test-state&code=test-code",
      { headers: { cookie: sessionCookie } },
    );
    const res = await linkCallback(req, {
      params: Promise.resolve({ provider: "google" }),
    });
    assert.equal(res.status, 307);
    assert.match(
      res.headers.get("location") ?? "",
      /oauth_link=success/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callback normalizes outcomes: success, already_linked, cancelled, failed, session_expired", async () => {
  const originalFetch = globalThis.fetch;
  const linkStateCookie = "lcsp_oauth_link_state=valid-state";
  const sessionCookie = `${SESSION_COOKIE_NAME}=valid-session-token`;

  try {
    // 1. Session expired when session cookie is absent
    const reqNoSession = new NextRequest(
      "http://localhost/api/auth/oauth/callback/google?state=valid-state&code=test-code",
      { headers: { cookie: linkStateCookie } },
    );
    const resNoSession = await oauthCallback(reqNoSession, {
      params: Promise.resolve({ provider: "google" }),
    });
    assert.equal(resNoSession.status, 307);
    assert.match(
      resNoSession.headers.get("location") ?? "",
      /oauth_link=session_expired/,
    );

    // 2. Cancelled when error query param is present
    const reqCancelled = new NextRequest(
      "http://localhost/api/auth/oauth/callback/google?state=valid-state&error=access_denied",
      { headers: { cookie: `${linkStateCookie}; ${sessionCookie}` } },
    );
    const resCancelled = await oauthCallback(reqCancelled, {
      params: Promise.resolve({ provider: "google" }),
    });
    assert.equal(resCancelled.status, 307);
    assert.match(
      resCancelled.headers.get("location") ?? "",
      /oauth_link=cancelled/,
    );

    // 3. Failed when code is missing
    const reqMissingCode = new NextRequest(
      "http://localhost/api/auth/oauth/callback/google?state=valid-state",
      { headers: { cookie: `${linkStateCookie}; ${sessionCookie}` } },
    );
    const resMissingCode = await oauthCallback(reqMissingCode, {
      params: Promise.resolve({ provider: "google" }),
    });
    assert.equal(resMissingCode.status, 307);
    assert.match(
      resMissingCode.headers.get("location") ?? "",
      /oauth_link=failed/,
    );

    // 4. Success when upstream returns linked: true
    globalThis.fetch = async () =>
      Response.json({
        ok: true,
        data: { provider: "google", linked: true },
      });
    const reqSuccess = new NextRequest(
      "http://localhost/api/auth/oauth/callback/google?state=valid-state&code=good-code",
      { headers: { cookie: `${linkStateCookie}; ${sessionCookie}` } },
    );
    const resSuccess = await oauthCallback(reqSuccess, {
      params: Promise.resolve({ provider: "google" }),
    });
    assert.equal(resSuccess.status, 307);
    assert.match(
      resSuccess.headers.get("location") ?? "",
      /oauth_link=success/,
    );

    // 5. Already linked when upstream returns linked: false
    globalThis.fetch = async () =>
      Response.json({
        ok: true,
        data: { provider: "google", linked: false },
      });
    const reqAlreadyLinked = new NextRequest(
      "http://localhost/api/auth/oauth/callback/google?state=valid-state&code=good-code",
      { headers: { cookie: `${linkStateCookie}; ${sessionCookie}` } },
    );
    const resAlreadyLinked = await oauthCallback(reqAlreadyLinked, {
      params: Promise.resolve({ provider: "google" }),
    });
    assert.equal(resAlreadyLinked.status, 307);
    assert.match(
      resAlreadyLinked.headers.get("location") ?? "",
      /oauth_link=already_linked/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
