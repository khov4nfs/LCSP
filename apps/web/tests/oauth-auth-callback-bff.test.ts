import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  PROBLEM_KEYS,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";
import { NextRequest } from "next/server";

import { GET as startOAuth } from "../src/app/api/auth/oauth/start/route.ts";
import { GET as oauthCallback } from "../src/app/api/auth/oauth/callback/[provider]/route.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

const sessionToken = "r4-non-production-session";

function callbackSuccess(
  overrides: Partial<{
    mfa_required: boolean;
    mfa_enrolled: boolean;
  }> = {},
) {
  return {
    session_token: sessionToken,
    expires_at: 1_800_000_000_000,
    mfa_required: false,
    mfa_enrolled: false,
    ...overrides,
  };
}

async function callLoginCallback() {
  return oauthCallback(
    new NextRequest(
      "https://lcsp.example/api/auth/oauth/callback/google?code=fixture-code&state=fixture-state",
    ),
    { params: Promise.resolve({ provider: "google" }) },
  );
}

test("Google OAuth start redirects through the allowlisted upstream provider flow", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl = "";
  try {
    globalThis.fetch = async (input) => {
      upstreamUrl = String(input);
      return Response.json({
        ok: true,
        data: {
          authorization_url:
            "https://accounts.google.com/o/oauth2/v2/auth?state=server-fixture",
        },
      });
    };

    const response = await startOAuth(
      new Request("https://lcsp.example/api/auth/oauth/start?provider=google"),
    );

    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "https://accounts.google.com/o/oauth2/v2/auth?state=server-fixture",
    );
    const parsedUpstreamUrl = new URL(upstreamUrl);
    assert.equal(parsedUpstreamUrl.pathname, "/auth/oauth/start");
    assert.equal(parsedUpstreamUrl.searchParams.get("provider"), "google");
    assert.equal(
      parsedUpstreamUrl.searchParams.get("redirect_uri"),
      "https://lcsp.example/api/auth/oauth/callback/google",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google OAuth start rejects an unsupported provider without contacting upstream", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  try {
    globalThis.fetch = async () => {
      upstreamCalls += 1;
      return Response.json({ ok: true, data: {} });
    };

    const response = await startOAuth(
      new Request("https://lcsp.example/api/auth/oauth/start?provider=unknown"),
    );

    assert.equal(response.status, 400);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callback sends an unenrolled MFA-required account to enrollment", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return Response.json({
        ok: true,
        data: callbackSuccess({ mfa_required: true, mfa_enrolled: false }),
      });
    };

    const response = await callLoginCallback();

    assert.equal(
      response.headers.get("location"),
      "https://lcsp.example/mfa/enroll",
    );
    assert.equal(calls.length, 1, "Pending MFA must not query the profile role");
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`${SESSION_COOKIE_NAME}=${sessionToken}`));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callback keeps an enrolled MFA challenge on verification", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  try {
    globalThis.fetch = async () => {
      upstreamCalls += 1;
      return Response.json({
        ok: true,
        data: callbackSuccess({ mfa_required: true, mfa_enrolled: true }),
      });
    };

    const response = await callLoginCallback();

    assert.equal(
      response.headers.get("location"),
      "https://lcsp.example/mfa/verify",
    );
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callback resolves an authenticated admin role from the guarded profile contract", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const authorization =
        new Headers(init?.headers).get("authorization") ?? "";
      calls.push({ url, authorization });
      if (url.includes("/auth/oauth/callback")) {
        return Response.json({
          ok: true,
          data: callbackSuccess(),
        });
      }
      return Response.json({
        ok: true,
        data: { role: AUTH_USER_ROLES.admin },
      });
    };

    const response = await callLoginCallback();

    assert.equal(response.headers.get("location"), "https://lcsp.example/admin");
    assert.equal(calls.length, 2);
    assert.match(calls[1]?.url ?? "", /\/auth\/profile$/);
    assert.equal(calls[1]?.authorization, `Bearer ${sessionToken}`);
    assert.match(
      response.headers.get("set-cookie") ?? "",
      new RegExp(`${SESSION_COOKIE_NAME}=${sessionToken}`),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Keep the customer destination covered separately because the callback must honor the authenticated profile role after MFA completes.
test("OAuth callback sends an authenticated customer to the workspace", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/auth/oauth/callback")) {
        return Response.json({
          ok: true,
          data: callbackSuccess(),
        });
      }
      return Response.json({
        ok: true,
        data: { role: AUTH_USER_ROLES.customer },
      });
    };

    const response = await callLoginCallback();

    assert.equal(response.headers.get("location"), "https://lcsp.example/workspace");
    assert.equal(calls.length, 2);
    assert.match(calls[1] ?? "", /\/auth\/profile$/);
    assert.match(
      response.headers.get("set-cookie") ?? "",
      new RegExp(`${SESSION_COOKIE_NAME}=${sessionToken}`),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth callback fails closed when its required MFA state is missing", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  try {
    globalThis.fetch = async () => {
      upstreamCalls += 1;
      return Response.json({
        ok: true,
        data: { session_token: sessionToken },
      });
    };

    const response = await callLoginCallback();

    assert.equal(
      response.headers.get("location"),
      "https://lcsp.example/sign-in?oauth=failed",
    );
    assert.equal(upstreamCalls, 1);
    assert.equal(response.headers.has("set-cookie"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Provider denial must never become a session; the existing login callback exposes only its generic failure route.
test("Google provider cancellation returns to sign-in without setting a session", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = "";
  try {
    globalThis.fetch = async (input) => {
      forwardedUrl = String(input);
      return new Response("{}", {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };

    const response = await oauthCallback(
      new NextRequest(
        "https://lcsp.example/api/auth/oauth/callback/google?state=fixture-state&error=access_denied",
      ),
      { params: Promise.resolve({ provider: "google" }) },
    );

    assert.equal(
      response.headers.get("location"),
      "https://lcsp.example/sign-in?oauth=failed",
    );
    assert.match(forwardedUrl, /\/auth\/oauth\/callback/);
    assert.equal(response.headers.has("set-cookie"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// If the guarded profile still rejects MFA, fail closed rather than treating an inconsistent callback flag as an authenticated role.
test("OAuth callback does not issue a session cookie when the profile still requires MFA", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  try {
    globalThis.fetch = async (input, init) => {
      upstreamCalls += 1;
      if (String(input).includes("/auth/oauth/callback")) {
        return Response.json({ ok: true, data: callbackSuccess() });
      }
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${sessionToken}`,
      );
      return Response.json(
        {
          ok: false,
          problem: {
            type: "about:blank",
            status: 403,
            code: AUTH_ERROR_CODES.mfaRequired,
            titleKey: PROBLEM_KEYS.mfaRequiredTitle,
            detailKey: PROBLEM_KEYS.mfaRequiredDetail,
            requiredAction: REQUIRED_ACTIONS.verifyMfa,
            correlationId: "r4-fixture-correlation",
          },
        },
        { status: 403 },
      );
    };

    const response = await callLoginCallback();

    assert.equal(
      response.headers.get("location"),
      "https://lcsp.example/sign-in?oauth=failed",
    );
    assert.equal(upstreamCalls, 2);
    assert.equal(response.headers.has("set-cookie"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
