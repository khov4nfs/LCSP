import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const signInRoute = await readFile(
  new URL("../src/app/(auth)/sign-in/page.tsx", import.meta.url),
  "utf8",
);
const signInPage = await readFile(
  new URL("../src/features/auth/components/organisms/sign-in-page.tsx", import.meta.url),
  "utf8",
);
const signInForm = await readFile(
  new URL("../src/features/auth/components/organisms/sign-in-form.tsx", import.meta.url),
  "utf8",
);
const englishCopy = await readFile(
  new URL("../../../packages/i18n/src/locales/en/pages.ts", import.meta.url),
  "utf8",
);
const vietnameseCopy = await readFile(
  new URL("../../../packages/i18n/src/locales/vi/pages.ts", import.meta.url),
  "utf8",
);

test("the sign-in route maps OAuth callback failure to safe localized feedback", () => {
  assert.match(signInRoute, /searchParams/);
  assert.match(signInRoute, /oauth\s*===\s*["']failed["']/);
  assert.match(signInRoute, /oauthFailure/);
  assert.match(signInPage, /oauthFailure/);
  assert.match(signInForm, /oauthFailure/);
  assert.match(signInForm, /pages\.signIn\.errors\.oauthFailedTitle/);
  assert.match(signInForm, /pages\.signIn\.errors\.oauthFailedDetail/);
  assert.match(englishCopy, /oauthFailedTitle:\s*["']Google sign-in could not be completed["']/);
  assert.match(vietnameseCopy, /oauthFailedTitle:\s*["']Không thể hoàn tất đăng nhập Google["']/);
});
