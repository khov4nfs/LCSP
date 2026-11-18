import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import React, { act } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { setAppLocale } from "../src/lib/locale.ts";
import { AuthTextField } from "../src/features/auth/components/molecules/auth-form-primitives.tsx";
import { SignUpForm } from "../src/features/auth/components/organisms/sign-up-form.tsx";
import { RecoveryConfirmForm } from "../src/features/auth/components/organisms/recovery-confirm-form.tsx";
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
