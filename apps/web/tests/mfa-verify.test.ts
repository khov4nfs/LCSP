import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildMfaVerifyApiBody } from "../src/app/api/auth/mfa/verify-otp/mfa-verify-proxy.ts";
import { mfaVerifySchema } from "../src/features/auth/schemas/mfa-verify.schema.ts";
import {
  toMfaVerifyOutcome,
  verifyMfaOtp,
  type MfaVerifyOutcome,
} from "../src/lib/api/auth-client.ts";

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

test("MFA verification accepts only a six-digit numeric OTP", () => {
  assert.equal(mfaVerifySchema.safeParse({ otp: "012345" }).success, true);
  assert.equal(mfaVerifySchema.safeParse({ otp: "12345" }).success, false);
  assert.equal(mfaVerifySchema.safeParse({ otp: "1234567" }).success, false);
  assert.equal(mfaVerifySchema.safeParse({ otp: "12a456" }).success, false);
});

test("successful MFA verification returns a workspace redirect outcome", () => {
  assert.deepEqual(toMfaVerifyOutcome({ verified: true }, true), {
    kind: "verified",
  });
});

test("successful MFA verification accepts the API success envelope payload", () => {
  assert.deepEqual(
    toMfaVerifyOutcome({ correlationId: "corr-verified" }, true),
    {
      kind: "verified",
    },
  );
});

test("invalid OTP responses use the shared non-leaking error contract", () => {
  const expected: MfaVerifyOutcome = {
    kind: "invalid",
    titleKey: "auth.errors.mfaInvalid.title",
    detailKey: "auth.errors.mfaInvalid.detail",
  };

  assert.deepEqual(
    toMfaVerifyOutcome(problem(AUTH_ERROR_CODES.mfaInvalid, 403), false),
    expected,
  );
});

test("MFA rate limiting returns a locked outcome", () => {
  assert.deepEqual(
    toMfaVerifyOutcome(problem(AUTH_ERROR_CODES.mfaRateLimited, 429), false),
    {
      kind: "rate_limited",
      titleKey: "auth.errors.mfaRateLimited.title",
      detailKey: "auth.errors.mfaRateLimited.detail",
    },
  );
});

test("undecryptable MFA enrollment redirects back to setup", () => {
  assert.deepEqual(
    toMfaVerifyOutcome(problem(AUTH_ERROR_CODES.mfaRequired, 403), false),
    { kind: "mfa_required" },
  );
});

test("invalid or expired pending sessions return a sign-in outcome", () => {
  assert.deepEqual(
    toMfaVerifyOutcome(problem(AUTH_ERROR_CODES.sessionInvalid, 401), false),
    { kind: "session_invalid" },
  );
});

test("MFA client sends the OTP only in a same-origin JSON body", async () => {
  const originalFetch = globalThis.fetch;
  let capturedInput: string | URL | Request | undefined;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return Response.json({ verified: true });
  };

  try {
    await verifyMfaOtp({ otp: "012345" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedInput, "/api/auth/mfa/verify-otp");
  assert.equal(capturedInit?.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { otp: "012345" });
});

test("MFA BFF body uses the server-side pending session", () => {
  assert.deepEqual(
    buildMfaVerifyApiBody("pending-session", {
      otp: "012345",
      session_token: "client-controlled-token",
    }),
    {
      session_token: "pending-session",
      otp: "012345",
    },
  );
});
