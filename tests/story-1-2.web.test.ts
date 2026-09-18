import { test } from "node:test";
import * as assert from "node:assert/strict";

import { SIGN_UP_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  SESSION_COOKIE_NAME,
  mfaRecoveryCodeVerifySchema,
  mfaVerifySchema,
  profileSafetySchema,
  recoveryConfirmSchema,
  recoveryRequestSchema,
  signInSchema,
  signUpSchema,
  sessionCookieOptions,
  toSignInOutcome,
  toSignUpOutcome,
} from "@lcsp/web";

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

test("successful sign-in outcomes redirect without exposing a session token", () => {
  assert.deepEqual(toSignInOutcome({ ok: true, mfa_required: false }, true), {
    kind: "authenticated",
  });
  assert.deepEqual(toSignInOutcome({ ok: true, mfa_required: true }, true), {
    kind: "mfa_required",
  });
});

test("sign-in errors expose safe i18n keys", () => {
  assert.deepEqual(
    toSignInOutcome(problem("INVALID_CREDENTIALS", 401), false),
    {
      kind: "error",
      titleKey: "auth.errors.invalidCredentials.title",
      detailKey: "auth.errors.invalidCredentials.detail",
    },
  );
  assert.deepEqual(toSignInOutcome(problem("TEMPORARY_LOCKED", 429), false), {
    kind: "error",
    titleKey: "auth.errors.temporaryLock.title",
    detailKey: "auth.errors.temporaryLock.detail",
  });
});

test("session storage is an httpOnly same-site cookie", () => {
  assert.equal(SESSION_COOKIE_NAME, "lcsp_session");
  assert.equal(sessionCookieOptions.httpOnly, true);
  assert.equal(sessionCookieOptions.sameSite, "lax");
});

test("sign-in schema rejects malformed credentials without retaining a password outside the form", () => {
  assert.equal(
    signInSchema.safeParse({
      email: "reviewer@lcsp.test",
      password: "correct-horse",
    }).success,
    true,
  );
  assert.equal(
    signInSchema.safeParse({ email: "not-an-email", password: "correct-horse" })
      .success,
    false,
  );
  assert.equal(
    signInSchema.safeParse({ email: "reviewer@lcsp.test", password: "" })
      .success,
    false,
  );
});

test("sign-up outcomes establish a session without exposing session credentials", () => {
  assert.deepEqual(toSignUpOutcome({ authenticated: true }, true), {
    kind: "authenticated",
  });
  assert.deepEqual(
    toSignUpOutcome(
      problem(SIGN_UP_ERROR_CODES.emailAlreadyExists, 409),
      false,
    ),
    { kind: "email_already_exists" },
  );
  assert.deepEqual(
    toSignUpOutcome(problem(SIGN_UP_ERROR_CODES.passwordTooShort, 422), false),
    { kind: "password_too_short" },
  );
});

test("sign-up schema validates account fields", () => {
  assert.equal(
    signUpSchema.safeParse({
      display_name: "New Manager",
      email: "manager@example.test",
      password: "twelve-chars",
      confirm_password: "twelve-chars",
    }).success,
    true,
  );
  assert.equal(
    signUpSchema.safeParse({
      display_name: "New Manager",
      email: "manager@example.test",
      password: "twelve-chars",
      confirm_password: "different-pass",
    }).success,
    false,
  );
  assert.equal(
    signUpSchema.safeParse({
      display_name: "",
      email: "not-an-email",
      password: "short",
      confirm_password: "short",
    }).success,
    false,
  );
  assert.equal(
    signUpSchema.safeParse({
      display_name: "a".repeat(101),
      email: "manager@example.test",
      password: "twelve-chars",
      confirm_password: "twelve-chars",
    }).success,
    false,
  );
  assert.equal(
    signUpSchema.safeParse({
      display_name: "New Manager",
      email: "  manager@example.test  ",
      password: "eleven-char",
      confirm_password: "eleven-char",
    }).success,
    false,
  );
  const parsed = signUpSchema.safeParse({
    display_name: "  Trimmed Manager  ",
    email: "  manager@example.test  ",
    password: "twelve-chars",
    confirm_password: "twelve-chars",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.display_name, "Trimmed Manager");
    assert.equal(parsed.data.email, "manager@example.test");
  }
});

test("sign-in schema derives from canonical contract and trims email", () => {
  assert.equal(
    signInSchema.safeParse({
      email: "  user@example.com  ",
      password: "some-password",
    }).success,
    true,
  );
  assert.equal(
    signInSchema.safeParse({
      email: "not-an-email",
      password: "pass",
    }).success,
    false,
  );
  assert.equal(
    signInSchema.safeParse({
      email: "user@example.com",
      password: "",
    }).success,
    false,
  );
});

test("recovery request schema trims email according to shared contract", () => {
  const parsed = recoveryRequestSchema.safeParse({
    email: "  user@example.com  ",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.email, "user@example.com");
  }
  assert.equal(
    recoveryRequestSchema.safeParse({ email: "invalid-email" }).success,
    false,
  );
});

test("recovery confirm schema enforces canonical password rules", () => {
  assert.equal(
    recoveryConfirmSchema.safeParse({
      token: "valid-token",
      new_password: "short",
    }).success,
    false,
  );
  assert.equal(
    recoveryConfirmSchema.safeParse({
      token: "valid-token",
      new_password: "twelve-chars-valid",
    }).success,
    true,
  );
});

test("mfa verify schemas validate otp and recovery code formats", () => {
  assert.equal(mfaVerifySchema.safeParse({ otp: "123456" }).success, true);
  assert.equal(mfaVerifySchema.safeParse({ otp: "12345" }).success, false);
  assert.equal(mfaVerifySchema.safeParse({ otp: "abcdef" }).success, false);

  assert.equal(
    mfaRecoveryCodeVerifySchema.safeParse({ code: "ABCD-1234-EFGH" }).success,
    true,
  );
  assert.equal(
    mfaRecoveryCodeVerifySchema.safeParse({ code: "invalid-code" }).success,
    false,
  );
});

test("profile safety schema accepts optional valid recovery email and trims", () => {
  assert.equal(
    profileSafetySchema.safeParse({ recovery_email: "" }).success,
    true,
  );
  const parsed = profileSafetySchema.safeParse({
    recovery_email: "  recovery@example.com  ",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.recovery_email, "recovery@example.com");
  }
  assert.equal(
    profileSafetySchema.safeParse({ recovery_email: "invalid-email" }).success,
    false,
  );
});
