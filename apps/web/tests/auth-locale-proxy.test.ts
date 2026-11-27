import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  PROBLEM_KEYS,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";
import { NextRequest } from "next/server";

import { config, proxy } from "../src/proxy.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

test("auth route locale cookies reach server rendering on a fresh request", () => {
  const expectedRoutes = [
    "/sign-in",
    "/sign-up",
    "/mfa/verify",
    "/mfa/enroll",
    "/recovery/request",
    "/recovery/confirm",
  ];

  // The shared root layout only knows the locale header forwarded by Proxy, so every public auth route must match it.
  assert.ok(expectedRoutes.every((route) => config.matcher.includes(route)));
});

test("auth locale forwarding bypasses session verification and retains the cookie locale", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response("{}", { status: 200 });
  };

  try {
    const response = await proxy(
      new NextRequest("https://lcsp.example/sign-in", {
        headers: {
          cookie: "lcsp_locale=vi; lcsp_session=non-production-fixture",
        },
      }),
    );

    // Authentication entry screens need the locale header but must not start the protected-route session verification path.
    assert.equal(response.headers.get("x-middleware-request-x-lcsp-locale"), "vi");
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Public auth entries were outside the old matcher; this locks their locale-only pass-through without a session.
test("all public auth routes remain accessible without a session and forward the default locale", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json({ ok: true, data: {} });
  };

  try {
    const publicRoutes = [
      "/sign-in",
      "/sign-up",
      "/mfa/verify",
      "/mfa/enroll",
      "/recovery/request",
      "/recovery/confirm",
    ];
    for (const route of publicRoutes) {
      const response = await proxy(
        new NextRequest(`https://lcsp.example${route}`),
      );
      assert.equal(response.headers.get("x-middleware-next"), "1", route);
      assert.equal(
        response.headers.get("x-middleware-request-x-lcsp-locale"),
        "en",
        route,
      );
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Protected route policy remains server-profile-driven: session presence alone cannot authorize the admin surface.
test("protected routes redirect anonymous users and customer sessions away from admin", async () => {
  const originalFetch = globalThis.fetch;
  let profileCalls = 0;
  globalThis.fetch = async (_input, init) => {
    profileCalls += 1;
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer r4-non-production-session",
    );
    return Response.json({
      ok: true,
      data: { role: AUTH_USER_ROLES.customer },
    });
  };

  try {
    const anonymousWorkspace = await proxy(
      new NextRequest("https://lcsp.example/workspace"),
    );
    assert.equal(
      anonymousWorkspace.headers.get("location"),
      "https://lcsp.example/sign-in?next=%2Fworkspace",
    );

    const anonymousAdmin = await proxy(
      new NextRequest("https://lcsp.example/admin/users"),
    );
    assert.equal(
      anonymousAdmin.headers.get("location"),
      "https://lcsp.example/sign-in?next=%2Fadmin%2Fusers",
    );

    const customerAdmin = await proxy(
      new NextRequest("https://lcsp.example/admin/users", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=r4-non-production-session` },
      }),
    );
    assert.equal(
      customerAdmin.headers.get("location"),
      "https://lcsp.example/workspace",
    );
    assert.equal(profileCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Valid admin sessions stay in admin routes, while stale sessions retain the existing cookie cleanup and sign-in redirect.
test("admin profile authorization and expired-session cleanup remain unchanged", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ ok: true, data: { role: AUTH_USER_ROLES.admin } });
    const authorizedAdmin = await proxy(
      new NextRequest("https://lcsp.example/admin", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=r4-non-production-session` },
      }),
    );
    assert.equal(authorizedAdmin.headers.get("x-middleware-next"), "1");

    globalThis.fetch = async () =>
      Response.json(
        {
          ok: false,
          problem: {
            type: "about:blank",
            status: 401,
            code: AUTH_ERROR_CODES.sessionInvalid,
            titleKey: PROBLEM_KEYS.sessionInvalidTitle,
            detailKey: PROBLEM_KEYS.sessionInvalidDetail,
            requiredAction: REQUIRED_ACTIONS.signIn,
            correlationId: "r4-fixture-correlation",
          },
        },
        { status: 401 },
      );
    const expiredSession = await proxy(
      new NextRequest("https://lcsp.example/workspace", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=expired-r4-fixture` },
      }),
    );
    assert.equal(
      expiredSession.headers.get("location"),
      "https://lcsp.example/sign-in?next=%2Fworkspace",
    );
    assert.equal(
      expiredSession.cookies.get(SESSION_COOKIE_NAME)?.value,
      "",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
