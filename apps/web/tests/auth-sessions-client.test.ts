import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  getAuthSessions,
  revokeAuthSession,
  revokeAllAuthSessions,
} from "../src/lib/api/auth-client.ts";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { API_OUTCOME_KINDS } from "../src/lib/api/outcome-kinds.ts";

test("auth sessions client accepts the real session payload without provider metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      data: {
        sessions: [
          {
            id: "session-1",
            created_at: "2026-09-05T04:00:00.000Z",
            updated_at: "2026-09-05T04:05:00.000Z",
            expires_at: "2026-09-06T04:00:00.000Z",
            revoked_at: null,
            mfa_verified_at: null,
            is_current: true,
          },
        ],
      },
    });

  try {
    const sessions = await getAuthSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, "session-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("revocation requires an exact backend acknowledgment", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ ok: true, data: { revoked_session_id: "wrong-target" } });
    assert.equal(
      (await revokeAuthSession("expected")).kind,
      API_OUTCOME_KINDS.error,
    );
    globalThis.fetch = async () =>
      Response.json({ ok: true, data: { revoked_session_id: "expected" } });
    assert.equal(
      (await revokeAuthSession("expected")).kind,
      API_OUTCOME_KINDS.saved,
    );
    globalThis.fetch = async () => Response.json({ ok: true, data: {} });
    assert.equal((await revokeAllAuthSessions()).kind, API_OUTCOME_KINDS.error);
    globalThis.fetch = async () =>
      Response.json({ ok: true, data: { revoked_all: true } });
    assert.equal((await revokeAllAuthSessions()).kind, API_OUTCOME_KINDS.saved);
  } finally {
    globalThis.fetch = original;
  }
});

test("session action failures preserve authentication challenges and missing targets", async () => {
  const original = globalThis.fetch;
  try {
    for (const [code, status, expected] of [
      [AUTH_ERROR_CODES.reauthRequired, 403, API_OUTCOME_KINDS.reauthRequired],
      [AUTH_ERROR_CODES.mfaRequired, 403, API_OUTCOME_KINDS.mfaRequired],
      [AUTH_ERROR_CODES.sessionInvalid, 401, API_OUTCOME_KINDS.sessionInvalid],
      [AUTH_ERROR_CODES.rbacDenied, 404, API_OUTCOME_KINDS.notFound],
    ] as const) {
      globalThis.fetch = async () =>
        Response.json({ ok: false, problem: { code, status } }, { status });
      assert.equal((await revokeAuthSession("target")).kind, expected);
    }
  } finally {
    globalThis.fetch = original;
  }
});
