import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authRoot = new URL("../src/features/auth/components/", import.meta.url);

// Preserve WCAG 2.2 AA minimum target dimensions for standalone auth navigation controls.
test("shared authentication links provide at least a 24px vertical target", () => {
  const primitives = readFileSync(new URL("molecules/auth-form-primitives.tsx", authRoot), "utf8");
  const shell = readFileSync(new URL("organisms/auth-shell.tsx", authRoot), "utf8");

  assert.match(primitives, /"inline-flex min-h-6 items-center text-xs/, "AuthInlineLink should expose a 24px target while keeping link semantics");
  assert.match(shell, /className="inline-flex min-h-6 items-center gap-1 text-sm/, "the standalone Back to website action should expose a 24px target");
});

test("auth input and OTP boundaries use the measured AA contrast color", () => {
  const primitives = readFileSync(new URL("molecules/auth-form-primitives.tsx", authRoot), "utf8");
  const otp = readFileSync(new URL("organisms/mfa-verify-form.tsx", authRoot), "utf8");

  assert.ok(primitives.includes("border-[#7B8A98]"), "auth text fields should use the verified 3:1 control boundary");
  assert.ok(otp.includes("border-[#7B8A98]"), "OTP slots should use the same verified control boundary");
});

test("auth controls use a high-contrast visible focus ring", () => {
  const primitives = readFileSync(new URL("molecules/auth-form-primitives.tsx", authRoot), "utf8");
  const shell = readFileSync(new URL("organisms/auth-shell.tsx", authRoot), "utf8");
  const otp = readFileSync(new URL("organisms/mfa-verify-form.tsx", authRoot), "utf8");

  assert.match(primitives, /border-\[#7B8A98\].*focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"/, "auth fields should use the opaque semantic focus ring");
  assert.match(primitives, /rounded-sm border-\[#123E46\].*focus-visible:ring-ring/, "auth primary buttons should use the opaque semantic focus ring");
  assert.match(primitives, /rounded-sm border-input.*focus-visible:ring-ring/, "auth secondary buttons should use the opaque semantic focus ring");
  assert.match(shell, /aria-label=\{t\("pages\.authShell\.languageLabel"\)\} className="focus-visible:ring-ring"/, "the auth locale selector should override the low-opacity shared focus ring locally");
  assert.match(otp, /data-\[active=true\]:ring-2 data-\[active=true\]:ring-ring(?=\s|")/, "active OTP slots should use the opaque semantic focus ring");
});

test("screen-reader-only auth descriptions stay width-bounded when text is enlarged", () => {
  const primitives = readFileSync(new URL("molecules/auth-form-primitives.tsx", authRoot), "utf8");

  assert.match(
    primitives,
    /descriptionClassName\?\.split\(\/\\s\+\/\)\.includes\("sr-only"\)\s*\?\s*"max-w-px"/,
    "hidden field descriptions must not expand the document width at enlarged text sizes",
  );
});

test("MFA re-auth dialog scrolls within the viewport when text is enlarged", () => {
  const enrollForm = readFileSync(new URL("organisms/mfa-enroll-form.tsx", authRoot), "utf8");
  const sharedDialog = readFileSync(new URL("../../../components/organisms/confirm-access-dialog.tsx", authRoot), "utf8");
  const dialogTypes = readFileSync(new URL("../../../components/types/confirm-access-dialog.types.ts", authRoot), "utf8");

  assert.match(
    dialogTypes,
    /constrainToViewport\?: boolean/,
    "the shared confirmation dialog should expose an opt-in viewport constraint without changing its default",
  );
  assert.match(
    sharedDialog,
    /constrainToViewport\s*\?\s*"max-h-dvh"/,
    "the opt-in constraint must cap the popup without modifying the shared dialog primitive",
  );
  assert.match(
    sharedDialog,
    /<DialogBody\s+className=\{\s*constrainToViewport\s*\?\s*"min-h-0 flex-1 overflow-y-auto"\s*:\s*undefined\s*\}/,
    "only the dialog body should scroll so its title and close action remain available",
  );
  assert.match(
    enrollForm,
    /<ConfirmAccessDialog\s+constrainToViewport/,
    "the MFA re-auth dialog must keep its title and close action reachable while its content scrolls",
  );
});
