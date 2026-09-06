import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import {
  reauthenticateWithPassword,
  toPasswordReauthOutcome,
} from "../src/lib/api/auth-client.ts";
import { confirmAccessPasswordSchema } from "../src/components/schemas/confirm-access-dialog.schema.ts";

function problem(code: string, status: number) {
  return {
    ok: false,
    problem: {
      type: `test/${code.toLowerCase().replaceAll("_", "-")}`,
      status,
      code,
      titleKey: "auth.errors.validationFailed.title",
      detailKey: "auth.errors.validationFailed.detail",
      requiredAction: "none",
      correlationId: "test-correlation",
    },
  };
}

test("password re-auth returns verified on success", () => {
  assert.deepEqual(toPasswordReauthOutcome({ verified: true }, true), {
    kind: "verified",
  });
});

test("password re-auth returns session invalid for expired sessions", () => {
  assert.deepEqual(
    toPasswordReauthOutcome(
      problem(AUTH_ERROR_CODES.sessionInvalid, 401),
      false,
    ),
    { kind: "session_invalid" },
  );
});

test("password re-auth preserves password whitespace", () => {
  const password = " CorrectHorseBatteryStaple! ";
  assert.equal(confirmAccessPasswordSchema.parse({ password }).password, password);
});

test("password re-auth client sends only the password in a same-origin JSON body", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInput: string | URL | Request | undefined;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return Response.json({ verified: true });
  };

  try {
    await reauthenticateWithPassword({
      password: "CorrectHorseBatteryStaple!",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedInput, "/api/auth/re-auth/password");
  assert.equal(capturedInit?.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    password: "CorrectHorseBatteryStaple!",
  });
});
