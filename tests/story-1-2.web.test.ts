import { test } from "node:test";
import * as assert from "node:assert/strict";

import { SIGN_UP_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  SESSION_COOKIE_NAME,
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

test("sign-up schema validates account and workspace fields", () => {
  assert.equal(
    signUpSchema.safeParse({
      display_name: "New Manager",
      organization_name: "New Legal Team",
      email: "manager@example.test",
      password: "twelve-chars",
      confirm_password: "twelve-chars",
    }).success,
    true,
  );
  assert.equal(
    signUpSchema.safeParse({
      display_name: "New Manager",
      organization_name: "New Legal Team",
      email: "manager@example.test",
      password: "twelve-chars",
      confirm_password: "different-pass",
    }).success,
    false,
  );
  assert.equal(
    signUpSchema.safeParse({
      display_name: "",
      organization_name: "New Legal Team",
      email: "not-an-email",
      password: "short",
      confirm_password: "short",
    }).success,
    false,
  );
});
