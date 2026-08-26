import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import {
  toConfirmRecoveryOutcome,
  toEnrollMfaOutcome,
  toPasswordReauthOutcome,
  toRequestRecoveryOutcome,
  toSignInOutcome,
  toUpdateProfileOutcome,
} from "../src/lib/api/auth-client.ts";
import { toSafeSignInOutcome } from "../src/lib/api/sign-in-client.ts";
import { profileSafetySchema } from "../src/features/auth/schemas/profile-safety.schema.ts";
import { recoveryConfirmSchema } from "../src/features/auth/schemas/recovery-confirm.schema.ts";
import { recoveryRequestSchema } from "../src/features/auth/schemas/recovery-request.schema.ts";

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

test("sign-in routes required MFA without enrollment to the setup flow", () => {
  assert.deepEqual(
    toSignInOutcome({ ok: true, mfa_required: true, mfa_enrolled: false }, true),
    { kind: "mfa_enrollment_required" },
  );
});

test("sign-in shows a generic request failure for server errors", () => {
  assert.deepEqual(
    toSafeSignInOutcome(
      problem(AUTH_ERROR_CODES.validationFailed, 500),
      false,
      500,
      AUTH_ERROR_CODES.validationFailed,
    ),
    {
      kind: "error",
      titleKey: "pages.signIn.errors.requestFailedTitle",
      detailKey: "pages.signIn.errors.requestFailedDetail",
    },
  );

  assert.deepEqual(
    toSafeSignInOutcome(
      problem(AUTH_ERROR_CODES.invalidCredentials, 401),
      false,
      401,
      AUTH_ERROR_CODES.invalidCredentials,
    ),
    {
      kind: "error",
      titleKey: "auth.errors.invalidCredentials.title",
      detailKey: "auth.errors.invalidCredentials.detail",
    },
  );
});

test("MFA enrollment success returns the provisioning URI", () => {
  assert.deepEqual(
    toEnrollMfaOutcome({ ok: true, totp_uri: "otpauth://totp/LCSP:test" }, true),
    { kind: "loaded", totpUri: "otpauth://totp/LCSP:test", recoveryCodes: [] },
  );
});

test("MFA enrollment falls back to verify when enrollment already exists", () => {
  assert.deepEqual(
    toEnrollMfaOutcome(problem(AUTH_ERROR_CODES.mfaRequired, 403), false),
    { kind: "mfa_required" },
  );
});

test("MFA enrollment sends expired or unauthenticated sessions back to sign-in", () => {
  assert.deepEqual(
    toEnrollMfaOutcome(problem(AUTH_ERROR_CODES.authRequired, 401), false),
    { kind: "session_invalid" },
  );
});

test("MFA enrollment preserves upstream problem copy for unexpected known problems", () => {
  assert.deepEqual(
    toEnrollMfaOutcome(
      {
        ok: false,
        problem: {
          type: "test/validation-failed",
          status: 400,
          code: AUTH_ERROR_CODES.validationFailed,
          titleKey: "auth.errors.validationFailed.title",
          detailKey: "auth.errors.validationFailed.detail",
          requiredAction: "sign_in",
          correlationId: "test-correlation",
        },
      },
      false,
    ),
    {
      kind: "error",
      titleKey: "auth.errors.validationFailed.title",
      detailKey: "auth.errors.validationFailed.detail",
    },
  );
});

test("recovery request treats safe success as a generic requested outcome", () => {
  assert.deepEqual(toRequestRecoveryOutcome({ ok: true }, true), {
    kind: "requested",
  });
});

test("recovery confirm maps invalid tokens to a safe invalid outcome", () => {
  assert.deepEqual(
    toConfirmRecoveryOutcome(problem(AUTH_ERROR_CODES.recoveryInvalid, 400), false),
    { kind: "invalid" },
  );
});

test("profile update maps validation failures to field-safe outcomes", () => {
  assert.deepEqual(
    toUpdateProfileOutcome(problem(AUTH_ERROR_CODES.validationFailed, 400), false),
    {
      kind: "validation_error",
      titleKey: "auth.errors.validationFailed.title",
      detailKey: "auth.errors.validationFailed.detail",
    },
  );
});

test("password re-auth maps invalid credentials to a safe invalid outcome", () => {
  assert.deepEqual(
    toPasswordReauthOutcome(
      problem(AUTH_ERROR_CODES.invalidCredentials, 401),
      false,
    ),
    { kind: "invalid" },
  );
});

test("recovery request schema requires a valid work email", () => {
  assert.equal(recoveryRequestSchema.safeParse({ email: "user@example.com" }).success, true);
  assert.equal(recoveryRequestSchema.safeParse({ email: "" }).success, false);
  assert.equal(recoveryRequestSchema.safeParse({ email: "not-an-email" }).success, false);
});

test("recovery confirm schema requires token and a 12-char password", () => {
  assert.equal(
    recoveryConfirmSchema.safeParse({
      token: "token-123",
      new_password: "123456789012",
    }).success,
    true,
  );
  assert.equal(
    recoveryConfirmSchema.safeParse({
      token: "",
      new_password: "short",
    }).success,
    false,
  );
});

test("profile safety schema accepts blank recovery email and valid addresses only", () => {
  assert.equal(profileSafetySchema.safeParse({ recovery_email: "" }).success, true);
  assert.equal(
    profileSafetySchema.safeParse({ recovery_email: "ops@example.com" }).success,
    true,
  );
  assert.equal(
    profileSafetySchema.safeParse({ recovery_email: "broken-address" }).success,
    false,
  );
});
