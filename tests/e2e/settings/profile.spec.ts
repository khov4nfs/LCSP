import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

async function setup(page: Page) {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
  const state = {
    profile: structuredClone(fixture.profile),
    writes: 0,
    failRead: false,
    failWrite: false,
    rejectName: false,
    expire: false,
    requireMfa: false,
    requirePassword: false,
    failConfirmation: false,
  };
  await page.route("**/api/auth/profile", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: state.failRead ? 503 : 200,
        json: state.failRead
          ? fixture.failure
          : { ok: true, data: state.profile },
      });
    }
    state.writes++;
    let code: string | undefined;
    if (state.expire) code = AUTH_ERROR_CODES.sessionInvalid;
    else if (state.rejectName) code = AUTH_ERROR_CODES.validationFailed;
    else if (state.requireMfa) code = AUTH_ERROR_CODES.mfaRequired;
    else if (state.requirePassword) code = AUTH_ERROR_CODES.rbacDenied;
    if (code || state.failWrite) {
      const status = state.expire
        ? 401
        : state.rejectName
          ? 400
          : code
            ? 403
            : 503;
      return route.fulfill({
        status,
        json: {
          ...fixture.failure,
          problem: {
            ...fixture.failure.problem,
            status,
            code: code ?? fixture.failure.problem.code,
            requiredAction: state.requirePassword
              ? REQUIRED_ACTIONS.reauthenticate
              : null,
          },
        },
      });
    }
    state.profile.display_name = route
      .request()
      .postDataJSON()
      .display_name.trim();
    if (state.failConfirmation) state.failRead = true;
    return route.fulfill({
      json: { ok: true, data: { updated_fields: ["display_name"] } },
    });
  });
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { ok: true, data: state.profile } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({ status: 503, json: fixture.failure }),
  );
  return state;
}

async function openModal(page: Page) {
  await page
    .locator('[data-component="SidebarAccountTrigger"]')
    .filter({ visible: true })
    .click();
  await page
    .locator('[data-component="AccountPopover"]')
    .getByText("Settings", { exact: true })
    .click();
  return page.locator(
    '[data-component="SettingsPage"][data-presentation="modal"]',
  );
}

test("standalone saves, synchronizes identity and survives refresh despite sessions failure", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const state = await setup(page);
  await page.goto("/workspace/settings?section=general");
  await expect(
    page.locator('[data-component="GeneralSettingsPanel"]').getByRole("alert"),
  ).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Display name" });
  await input.fill("  Nguyễn Minh  ");
  await input.press("Tab");
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Profile updated.");
  await expect(input).toHaveValue("Nguyễn Minh");
  await expect(
    page.locator('[data-component="SidebarAccountTrigger"]').first(),
  ).toContainText("Nguyễn Minh");
  expect(state.writes).toBe(1);
  await page.reload();
  await expect(input).toHaveValue("Nguyễn Minh");
  expect(browserErrors).toEqual([]);
});

test("modal saves, reopens and reflects the same profile in standalone Settings", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/workspace");
  let modal = await openModal(page);
  await modal
    .getByLabel("Display name", { exact: true })
    .fill("New profile name");
  await modal.getByRole("button", { name: "Save changes" }).click();
  await expect(modal.getByRole("status")).toHaveText("Profile updated.");
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  modal = await openModal(page);
  await expect(modal.getByLabel("Display name", { exact: true })).toHaveValue(
    "New profile name",
  );
  await page.goto("/workspace/settings?section=general");
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
    "New profile name",
  );
});

test("invalid names and rejected saves preserve drafts and never show success", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/workspace/settings?section=general");
  const input = page.getByLabel("Display name", { exact: true });
  const save = page.getByRole("button", { name: "Save changes" });
  await input.fill("   ");
  await save.click();
  await expect(
    page.locator('[data-component="GeneralSettingsPanel"]').getByRole("alert"),
  ).toHaveText("Enter a display name.");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(state.writes).toBe(0);
  await input.fill("x".repeat(121));
  await save.click();
  await expect(
    page.locator('[data-component="GeneralSettingsPanel"]').getByRole("alert"),
  ).toHaveText("Use no more than 120 characters.");
  expect(state.writes).toBe(0);
  state.rejectName = true;
  await input.fill("Kept draft");
  await save.click();
  await expect(
    page.locator('[data-component="GeneralSettingsPanel"]').getByRole("alert"),
  ).toContainText("could not be accepted");
  state.rejectName = false;
  state.failWrite = true;
  await save.click();
  await expect(
    page.locator('[data-component="GeneralSettingsPanel"]').getByRole("alert"),
  ).toContainText("Could not confirm your profile update");
  await expect(input).toHaveValue("Kept draft");
  await expect(page.getByText("Profile updated.", { exact: true })).toHaveCount(
    0,
  );
  state.failWrite = false;
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Profile updated.");
});

test("loading, failed profile reads and retry are distinct", async ({
  page,
}) => {
  const state = await setup(page);
  state.failRead = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/profile", async (route) => {
    await gate;
    await route.fallback();
  });
  await page.goto("/workspace/settings?section=general");
  await expect(page.getByRole("status")).toHaveText("Loading profile…");
  await expect(page.locator("#settings-full-name")).toHaveCount(0);
  release();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#settings-full-name")).toHaveCount(0);
  state.failRead = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("#settings-full-name")).toHaveValue(
    fixture.profile.display_name,
  );
});

test("failed confirmation retains the draft without a success message", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/workspace/settings?section=general");
  state.failConfirmation = true;
  await page.locator("#settings-full-name").fill("Confirmation draft");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(
      "Could not confirm your profile update. Your input has been kept. Please retry.",
    ),
  ).toBeVisible();
  await expect(page.locator("#settings-full-name")).toHaveValue(
    "Confirmation draft",
  );
  await expect(page.getByText("Profile updated.", { exact: true })).toHaveCount(
    0,
  );
});

test("canceled reauthentication does not retry; confirmed password verification retries once", async ({
  page,
}) => {
  const state = await setup(page);
  state.requirePassword = true;
  await page.route("**/api/auth/re-auth/password", (route) =>
    route.fulfill({ json: { ok: true, data: {} } }),
  );
  await page.goto("/workspace/settings?section=general");
  await page.locator("#settings-full-name").fill("Protected draft");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Verification canceled. Your changes have not been saved."),
  ).toBeVisible();
  expect(state.writes).toBe(1);
  await expect(page.locator("#settings-full-name")).toHaveValue(
    "Protected draft",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="password"]').fill("test-only-verification");
  state.requirePassword = false;
  await dialog.locator('button[type="submit"]').click();
  await expect(
    page.getByText("Profile updated.", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toBe(3);
});

test("expired save redirects to sign-in without reporting success", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/workspace/settings?section=general");
  await page.locator("#settings-full-name").fill("Expired draft");
  state.expire = true;
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  expect(state.profile.display_name).toBe(fixture.profile.display_name);
});

test("MFA challenge starts with OTP and saves only after verified access", async ({
  page,
}) => {
  const state = await setup(page);
  state.profile.mfa_enrolled = true;
  state.requireMfa = true;
  await page.route("**/api/auth/mfa/verify-otp", async (route) => {
    state.requireMfa = false;
    state.profile.mfa_verified = true;
    await route.fulfill({ json: { ok: true, data: {} } });
  });
  await page.goto("/workspace/settings?section=general");
  await page.locator("#settings-full-name").fill("MFA confirmed name");
  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#confirm-access-otp")).toBeVisible();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  expect(state.writes).toBe(1);
  await dialog.locator("#confirm-access-otp").fill("123456");
  await dialog.locator('button[type="submit"]').click();
  await expect(
    page.getByText("Profile updated.", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toBe(2);
});

test("failed verification keeps the challenge open and does not retry the save", async ({
  page,
}) => {
  const state = await setup(page);
  state.requirePassword = true;
  await page.route("**/api/auth/re-auth/password", (route) =>
    route.fulfill({
      status: 401,
      json: {
        ...fixture.failure,
        problem: {
          ...fixture.failure.problem,
          status: 401,
          code: AUTH_ERROR_CODES.invalidCredentials,
        },
      },
    }),
  );
  await page.goto("/workspace/settings?section=general");
  await page.locator("#settings-full-name").fill("Unverified draft");
  await page.getByRole("button", { name: "Save changes" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="password"]').fill("test-only-invalid");
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(state.writes).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-full-name")).toHaveValue(
    "Unverified draft",
  );
  await expect(page.getByText("Profile updated.", { exact: true })).toHaveCount(
    0,
  );
});

test("mobile modal can scroll to save and retains profile after reopening", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await page.goto("/workspace");
  await page
    .getByRole("button", { name: "Toggle workspace navigation", exact: true })
    .click();
  const modal = await openModal(page);
  await modal.locator("#settings-full-name").fill("Mobile modal name");
  await modal.getByRole("button", { name: "Save changes" }).click();
  await expect(modal.getByRole("status")).toHaveText("Profile updated.");
  const box = await modal.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle workspace navigation", exact: true })
    .click();
  await openModal(page);
  await expect(modal.locator("#settings-full-name")).toHaveValue(
    "Mobile modal name",
  );
});

test("Vietnamese mobile form supports an empty name, field errors and save/reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const state = await setup(page);
  state.profile.display_name = null;
  await page
    .context()
    .addCookies([
      { name: "lcsp_locale", value: "vi", url: "http://127.0.0.1:3100" },
    ]);
  await page.goto("/workspace/settings?section=general");
  const input = page.getByLabel("Tên hiển thị", { exact: true });
  await expect(
    page.getByText("Chưa có tên hiển thị. Bạn có thể thêm tên bên dưới.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await input.fill(" ");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(
    page.locator('[data-component="GeneralSettingsPanel"]').getByRole("alert"),
  ).toHaveText("Vui lòng nhập tên hiển thị.");
  await input.fill("Trần An");
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã cập nhật hồ sơ.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(input).toHaveValue("Trần An");
  await page.screenshot({
    path: test.info().outputPath("profile-mobile.png"),
    fullPage: true,
  });
});
