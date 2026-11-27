import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import React, { act } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { getAppLocaleSnapshot, setAppLocale } from "../src/lib/locale.ts";
import { LocaleProvider } from "../src/components/providers/locale-provider.tsx";
import { AuthTextField } from "../src/features/auth/components/molecules/auth-form-primitives.tsx";
import { SignUpForm } from "../src/features/auth/components/organisms/sign-up-form.tsx";
import { RecoveryConfirmForm } from "../src/features/auth/components/organisms/recovery-confirm-form.tsx";
import { recoveryConfirmSchema } from "../src/features/auth/schemas/recovery-confirm.schema.ts";
import { render, settle } from "./support/dom.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

setAppLocale("vi");

const mockRouter = {
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
  prefetch: () => {},
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AppRouterContext.Provider value={mockRouter as never}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </AppRouterContext.Provider>,
  );
}

test("AuthTextField toggles password visibility and aria-label when type='password'", async () => {
  const root = render(
    <AuthTextField
      id="test-password"
      type="password"
      label="Mật khẩu"
      description="Nhập mật khẩu"
    />,
  );
  await settle();

  const input = root.querySelector(
    'input#test-password',
  ) as HTMLInputElement | null;
  assert.ok(input, "Expected password input element");
  assert.equal(input.type, "password");

  const toggleButton = root.querySelector(
    'button[aria-label="Hiển thị mật khẩu"]',
  ) as HTMLButtonElement | null;
  assert.ok(toggleButton, "Expected show password button");

  // Click to reveal password
  act(() => {
    toggleButton.click();
  });
  await settle();

  assert.equal(input.type, "text");
  assert.equal(toggleButton.getAttribute("aria-label"), "Ẩn mật khẩu");

  // Click to hide password
  act(() => {
    toggleButton.click();
  });
  await settle();

  assert.equal(input.type, "password");
  assert.equal(toggleButton.getAttribute("aria-label"), "Hiển thị mật khẩu");
});

test("sign-up locale switching updates copy and persists without losing the entered email", async () => {
  act(() => setAppLocale("en"));
  const root = renderWithProviders(
    <LocaleProvider>
      <SignUpForm />
    </LocaleProvider>,
  );
  await settle();
  assert.equal(root.querySelector("[data-locale]")?.getAttribute("data-locale"), "en");

  const emailInput = root.querySelector(
    'input[name="email"]',
  ) as HTMLInputElement | null;
  const displayNameInput = root.querySelector(
    'input[name="display_name"]',
  ) as HTMLInputElement | null;
  assert.ok(emailInput, "Expected the sign-up email field");
  assert.ok(displayNameInput, "Expected the sign-up name field");
  assert.equal(root.querySelector("h1")?.textContent, "Create your account");
  assert.equal(emailInput.placeholder, "Enter your email address");
  assert.equal(displayNameInput.placeholder, "Your full name");

  // Exercise locale changes while the registered RHF input remains mounted, matching the shell selector's state-preserving contract.
  const setInputValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  assert.ok(setInputValue, "Expected a native input value setter");
  act(() => {
    setInputValue.call(emailInput, "keep-me@example.com");
    emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    emailInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();

  act(() => setAppLocale("vi"));
  await settle();

  assert.equal(getAppLocaleSnapshot(), "vi");
  assert.equal(root.querySelector("[data-locale]")?.getAttribute("data-locale"), "vi");
  assert.equal(root.querySelector("h1")?.textContent, "Tạo tài khoản của bạn");
  assert.match(root.textContent ?? "", /Bạn đã có tài khoản\?/);
  assert.match(root.textContent ?? "", /Tạo tài khoản/);
  assert.equal(emailInput.value, "keep-me@example.com");
  assert.equal(emailInput.placeholder, "Nhập địa chỉ email của bạn");
  assert.equal(displayNameInput.placeholder, "Họ tên đầy đủ của bạn");
  assert.equal(document.documentElement.lang, "vi");
  assert.match(document.cookie, /lcsp_locale=vi/);

  act(() => setAppLocale("vi"));
});

test("sign-up keeps invalid field feedback associated and translates it after a locale switch", async () => {
  act(() => setAppLocale("en"));
  const root = renderWithProviders(
    <LocaleProvider>
      <SignUpForm />
    </LocaleProvider>,
  );
  await settle();

  const emailInput = root.querySelector(
    'input[name="email"]',
  ) as HTMLInputElement | null;
  const form = root.querySelector("#sign-up-form");
  assert.ok(emailInput, "Expected the registered sign-up email field");
  assert.ok(form, "Expected the sign-up form");

  // Trigger the real RHF/Zod submit path so the regression covers localized field feedback, not a test-only error setter.
  const setInputValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  assert.ok(setInputValue, "Expected a native input value setter");
  act(() => {
    setInputValue.call(emailInput, "not-an-email");
    emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    emailInput.dispatchEvent(new Event("change", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();

  assert.equal(emailInput.getAttribute("aria-invalid"), "true");
  assert.match(root.textContent ?? "", /Enter a valid work email\./);
  const describedIds = emailInput.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
  assert.ok(
    describedIds.some((id) =>
      [...root.querySelectorAll<HTMLElement>("[id]")]
        .find((element) => element.id === id)
        ?.textContent?.includes("Enter a valid work email."),
    ),
    "Expected the invalid email message to be referenced by aria-describedby",
  );

  act(() => setAppLocale("vi"));
  await settle();

  assert.equal(emailInput.value, "not-an-email");
  assert.equal(emailInput.getAttribute("aria-invalid"), "true");
  assert.match(root.textContent ?? "", /Nhập email công việc hợp lệ\./);
  assert.ok(
    describedIds.some((id) =>
      [...root.querySelectorAll<HTMLElement>("[id]")]
        .find((element) => element.id === id)
        ?.textContent?.includes("Nhập email công việc hợp lệ."),
    ),
    "Expected the translated error to remain associated with the invalid field",
  );
});

test("SignUpForm has independent password toggle eye icons for password and confirm_password", async () => {
  const root = renderWithProviders(<SignUpForm />);
  await settle();

  const passwordInput = root.querySelector(
    'input[name="password"]',
  ) as HTMLInputElement | null;
  const confirmPasswordInput = root.querySelector(
    'input[name="confirm_password"]',
  ) as HTMLInputElement | null;

  assert.ok(passwordInput, "Expected password input in SignUpForm");
  assert.ok(
    confirmPasswordInput,
    "Expected confirm_password input in SignUpForm",
  );
  assert.equal(passwordInput.type, "password");
  assert.equal(confirmPasswordInput.type, "password");

  const toggleButtons = Array.from(
    root.querySelectorAll('button[aria-label="Hiển thị mật khẩu"]'),
  ) as HTMLButtonElement[];
  assert.equal(
    toggleButtons.length,
    2,
    "Expected 2 password toggle buttons in SignUpForm",
  );

  // Toggle first password field
  act(() => {
    toggleButtons[0].click();
  });
  await settle();

  assert.equal(passwordInput.type, "text");
  assert.equal(confirmPasswordInput.type, "password");

  // Toggle second password field
  act(() => {
    toggleButtons[1].click();
  });
  await settle();

  assert.equal(passwordInput.type, "text");
  assert.equal(confirmPasswordInput.type, "text");
});

test("RecoveryConfirmForm has password toggle eye icon for new_password", async () => {
  const root = renderWithProviders(<RecoveryConfirmForm token="test-token" />);
  await settle();

  const newPasswordInput = root.querySelector(
    'input[name="new_password"]',
  ) as HTMLInputElement | null;
  assert.ok(
    newPasswordInput,
    "Expected new_password input in RecoveryConfirmForm",
  );
  assert.equal(newPasswordInput.type, "password");

  const toggleButton = root.querySelector(
    'button[aria-label="Hiển thị mật khẩu"]',
  ) as HTMLButtonElement | null;
  assert.ok(
    toggleButton,
    "Expected show password button in RecoveryConfirmForm",
  );

  act(() => {
    toggleButton.click();
  });
  await settle();

  assert.equal(newPasswordInput.type, "text");
  assert.equal(toggleButton.getAttribute("aria-label"), "Ẩn mật khẩu");
});

test("RecoveryConfirmForm exposes an independently toggled confirmation field", async () => {
  const root = renderWithProviders(<RecoveryConfirmForm token="test-token" />);
  await settle();

  const newPasswordInput = root.querySelector(
    'input[name="new_password"]',
  ) as HTMLInputElement | null;
  const confirmPasswordInput = root.querySelector(
    'input[name="confirm_new_password"]',
  ) as HTMLInputElement | null;
  assert.ok(newPasswordInput, "Expected new password input");
  assert.ok(confirmPasswordInput, "Expected confirmation password input");

  const toggles = Array.from(
    root.querySelectorAll('button[aria-label]'),
  ) as HTMLButtonElement[];
  assert.equal(toggles.length, 2);
  act(() => toggles[0].click());
  await settle();
  assert.equal(newPasswordInput.type, "text");
  assert.equal(confirmPasswordInput.type, "password");
  act(() => toggles[1].click());
  await settle();
  assert.equal(confirmPasswordInput.type, "text");
});

test("recovery confirmation requires matching passwords", () => {
  const mismatch = recoveryConfirmSchema.safeParse({
    token: "fixture-token",
    new_password: "ValidPassword123!",
    confirm_new_password: "DifferentPassword123!",
  });
  assert.equal(mismatch.success, false);
  if (!mismatch.success) {
    assert.deepEqual(mismatch.error.issues[0]?.path, ["confirm_new_password"]);
  }
});

// Lock the R3 presentation-only confirmation field out of the established recovery API payload.
test("recovery confirmation submits only the existing token and new_password contract", async () => {
  const originalFetch = globalThis.fetch;
  let submittedUrl = "";
  let submittedBody: unknown;
  act(() => setAppLocale("en"));
  globalThis.fetch = async (input, init) => {
    submittedUrl = String(input);
    submittedBody = JSON.parse(String(init?.body));
    return Response.json({ ok: true, data: { confirmed: true } });
  };

  try {
    const root = renderWithProviders(
      <LocaleProvider>
        <RecoveryConfirmForm token="r4-fixture-recovery-token" />
      </LocaleProvider>,
    );
    await settle();
    const form = root.querySelector<HTMLFormElement>("#recovery-confirm-form");
    const newPassword = root.querySelector<HTMLInputElement>(
      'input[name="new_password"]',
    );
    const confirmPassword = root.querySelector<HTMLInputElement>(
      'input[name="confirm_new_password"]',
    );
    const setInputValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    assert.ok(form, "Expected recovery confirmation form");
    assert.ok(newPassword, "Expected new password field");
    assert.ok(confirmPassword, "Expected confirmation password field");
    assert.ok(setInputValue, "Expected the native input value setter");

    act(() => {
      setInputValue.call(newPassword, "ValidPassword123!");
      newPassword.dispatchEvent(new Event("input", { bubbles: true }));
      newPassword.dispatchEvent(new Event("change", { bubbles: true }));
      setInputValue.call(confirmPassword, "ValidPassword123!");
      confirmPassword.dispatchEvent(new Event("input", { bubbles: true }));
      confirmPassword.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    assert.equal(submittedUrl, "/api/auth/recovery/confirm");
    assert.deepEqual(submittedBody, {
      token: "r4-fixture-recovery-token",
      new_password: "ValidPassword123!",
    });
  } finally {
    globalThis.fetch = originalFetch;
    act(() => setAppLocale("vi"));
  }
});

test("ConfirmAccessDialog (re-auth) implements password toggle eye icon and type switching", async () => {
  const confirmAccessPath = new URL(
    "../src/components/organisms/confirm-access-dialog.tsx",
    import.meta.url,
  );
  const source = await readFile(confirmAccessPath, "utf8");

  // 1. Imports EyeIcon and EyeOffIcon
  assert.match(
    source,
    /import.*EyeIcon.*EyeOffIcon.*from\s+["']lucide-react["']/,
    "Must import EyeIcon and EyeOffIcon in ConfirmAccessDialog",
  );

  // 2. Holds showPassword state
  assert.match(
    source,
    /const\s*\[showPassword,\s*setShowPassword\]\s*=\s*useState\(false\)/,
    "Must manage showPassword state in ConfirmAccessDialog",
  );

  // 3. Toggles type between text and password
  assert.match(
    source,
    /type=\{showPassword\s*\?\s*["']text["']\s*:\s*["']password["']\}/,
    "Must toggle input type based on showPassword state",
  );

  // 4. Accessible aria-label for show/hide password
  assert.match(
    source,
    /showPassword\s*\?\s*["']pages\.signIn\.hidePassword["']\s*:\s*["']pages\.signIn\.showPassword["']/,
    "Must provide accessible show/hide password label",
  );

  // 5. Renders EyeIcon and EyeOffIcon inside toggle button
  assert.match(
    source,
    /<EyeOffIcon className="size-4"/,
    "Must render EyeOffIcon when password is shown",
  );
  assert.match(
    source,
    /<EyeIcon className="size-4"/,
    "Must render EyeIcon when password is hidden",
  );
});
