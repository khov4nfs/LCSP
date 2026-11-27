import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { POST as signInBff } from "../src/app/api/auth/sign-in/route.ts";
import { toSignInOutcome } from "../src/lib/api/auth-client.ts";
import { API_OUTCOME_KINDS } from "../src/lib/api/outcome-kinds.ts";
import { SESSION_COOKIE_NAME } from "../src/lib/session/session-store.ts";

// Exercise the production BFF projection with a synthetic upstream response; no credentials or live session are used.
test("sign-in BFF exposes MFA state and canonical role but not unsupported workspace selection data", async () => {
  const originalFetch = globalThis.fetch;
  const environmentKeys = [
    "MOCK_MODE",
    "MDA_LOCAL_DEV",
    "NEXT_PUBLIC_MOCK_MODE",
  ] as const;
  const originalEnvironment = new Map(
    environmentKeys.map((key) => [key, process.env[key]]),
  );

  for (const key of environmentKeys) delete process.env[key];

  try {
    globalThis.fetch = async () =>
      Response.json({
        ok: true,
        data: {
          session_token: "r4-non-production-sign-in-session",
          user: { subject_attributes: { role: AUTH_USER_ROLES.customer } },
          mfa_required: true,
          mfa_enrolled: false,
          // This unsupported field simulates a conflicting extension; the authoritative API contract has no workspace selection fields.
          workspace_selection_required: true,
          workspaces: [{ id: "fixture-only", name: "Fixture" }],
        },
      });

    const response = await signInBff(
      new Request("https://lcsp.example/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "fixture@example.test", password: "not-a-real-password" }),
      }),
    );

    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.deepEqual(envelope.data, {
      mfa_required: true,
      mfa_enrolled: false,
      role: AUTH_USER_ROLES.customer,
    });
    assert.deepEqual(toSignInOutcome(envelope.data, true), {
      kind: API_OUTCOME_KINDS.mfaEnrollmentRequired,
    });
    assert.match(
      response.headers.get("set-cookie") ?? "",
      new RegExp(`${SESSION_COOKIE_NAME}=r4-non-production-sign-in-session`),
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
