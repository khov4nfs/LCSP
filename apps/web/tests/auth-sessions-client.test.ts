import * as assert from "node:assert/strict";
import { test } from "node:test";

import { getAuthSessions } from "../src/lib/api/auth-client.ts";

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
