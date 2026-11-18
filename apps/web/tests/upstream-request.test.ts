import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { upstreamRequest } from "../src/lib/server/upstream-request.ts";

test("upstream fixtures require explicit mock mode, including during an outage", async (t) => {
  const flags = ["MOCK_MODE", "MDA_LOCAL_DEV", "NEXT_PUBLIC_MOCK_MODE"];
  const originalFlags = flags.map((flag) => process.env[flag]);
  t.after(() => {
    flags.forEach((flag, index) => {
      if (originalFlags[index] === undefined) delete process.env[flag];
      else process.env[flag] = originalFlags[index];
    });
  });
  flags.forEach((flag) => delete process.env[flag]);

  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("connection failed");
  });

  for (const path of ["/auth/profile", "/admin/users"]) {
    const offline = await upstreamRequest(path);
    assert.equal(offline.ok, false);
    assert.equal(offline.status, 503);
    assert.equal(offline.problemCode, SHARED_ERROR_CODES.upstreamUnavailable);
  }

  process.env.MOCK_MODE = "true";
  const fixture = await upstreamRequest("/auth/profile", {
    bearerToken: "mock-session:admin",
  });
  assert.equal(fixture.ok, true);
  assert.equal(fixture.status, 200);
  assert.equal((fixture.data as { role: string }).role, AUTH_USER_ROLES.admin);
  assert.equal(calls, 2);
});
