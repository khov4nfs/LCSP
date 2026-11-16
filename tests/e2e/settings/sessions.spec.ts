import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const sessionFixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-sessions.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

async function setup(page: Page) {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
  const state = {
    sessions: structuredClone(sessionFixture.sessions),
    failRead: false,
    failWrite: false,
    writes: 0,
    invalidPassword: false,
    expire: false,
    mfa: false,
  };
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({
      json: { ok: true, data: { ...fixture.profile, mfa_enrolled: state.mfa } },
    }),
  );
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { ok: true, data: fixture.profile } }),
  );
  await page.route("**/api/auth/sessions**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        status: state.failRead ? 503 : 200,
        json: state.failRead
          ? fixture.failure
          : { ok: true, data: { sessions: state.sessions } },
      });
    state.writes++;
    if (state.expire)
      return route.fulfill({
        status: 401,
        json: {
          ok: false,
          problem: {
            ...fixture.failure.problem,
            status: 401,
            code: AUTH_ERROR_CODES.sessionInvalid,
            requiredAction: REQUIRED_ACTIONS.signIn,
          },
        },
      });
    if (state.failWrite)
      return route.fulfill({ status: 503, json: fixture.failure });
    const id = new URL(route.request().url()).pathname.split("/").pop();
    if (id === "sessions") {
      state.sessions = [];
      return route.fulfill({
        json: { ok: true, data: { revoked_all: true } },
        headers: {
          "set-cookie":
            "lcsp_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        },
      });
    }
    state.sessions = state.sessions.filter(
      (session: { id: string }) => session.id !== id,
    );
    return route.fulfill({
      json: { ok: true, data: { revoked_session_id: id } },
    });
  });
  await page.route("**/api/auth/re-auth/password", (route) =>
    route.fulfill({
      status: state.invalidPassword ? 401 : 200,
      json: state.invalidPassword
        ? {
            ok: false,
            problem: {
              ...fixture.failure.problem,
              status: 401,
              code: AUTH_ERROR_CODES.invalidCredentials,
            },
          }
        : { ok: true, data: {} },
    }),
  );
  await page.route("**/api/auth/mfa/verify-otp", (route) =>
    route.fulfill({ json: { ok: true, data: {} } }),
  );
  return state;
}

async function verifyPassword(page: Page) {
  const dialog = page.getByRole("dialog").last();
  await dialog.locator('input[type="password"]').fill("test-only-verification");
  await dialog.locator('button[type="submit"]').click();
}

test("revokes another session, retains current session and persists after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await setup(page);
  await page.goto("/workspace/settings?section=account");
  const panel = page.locator('[data-component="AccountSettingsPanel"]');
  await expect(panel.locator("li")).toHaveCount(2);
  await panel.getByRole("button", { name: "Revoke", exact: true }).click();
  expect(state.writes).toBe(0);
  await verifyPassword(page);
  await expect(panel.getByRole("status")).toHaveText("Session revoked");
  await expect(panel.locator("li")).toHaveCount(1);
  await expect(panel).toContainText("Current session");
  await page.reload();
  await expect(panel.locator("li")).toHaveCount(1);
  expect(state.writes).toBe(1);
  expect(errors).toEqual([]);
});

test("canceled and rejected verification never revoke a session", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/workspace/settings?section=account");
  const revoke = page.getByRole("button", { name: "Revoke", exact: true });
  await revoke.click();
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[data-component="AccountSettingsPanel"]').getByRole("alert"),
  ).toHaveText("Verification canceled. No sessions were revoked.");
  state.invalidPassword = true;
  await revoke.click();
  await verifyPassword(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(state.writes).toBe(0);
});

test("read errors stay local, retry distinguishes empty data", async ({
  page,
}) => {
  const state = await setup(page);
  state.failRead = true;
  await page.goto("/workspace/settings?section=account");
  await expect(
    page.getByText("Could not load sessions. Please retry."),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("No sessions found.")).toHaveCount(0);
  await expect(page.getByText("Could not load your profile")).toHaveCount(0);
  state.failRead = false;
  state.sessions = [];
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("No sessions found.")).toBeVisible();
});

test("failed all-device logout keeps the session and offers another attempt", async ({
  page,
}) => {
  const state = await setup(page);
  state.failWrite = true;
  await page.goto("/workspace/settings?section=account");
  await page
    .getByRole("button", { name: "Log out of all devices", exact: true })
    .click();
  await verifyPassword(page);
  await expect(
    page.locator('[data-component="AccountSettingsPanel"]').getByRole("alert"),
  ).toHaveText("Could not confirm session revocation. Please retry.");
  await expect(page).toHaveURL(/section=account/);
  expect(
    (await page.context().cookies()).some((c) => c.name === "lcsp_session"),
  ).toBe(true);
  state.failWrite = false;
  await page
    .getByRole("button", { name: "Log out of all devices", exact: true })
    .click();
  await verifyPassword(page);
  await expect(page).toHaveURL(/\/sign-in/);
  expect(state.writes).toBe(2);
  expect(state.sessions).toHaveLength(0);
  expect(
    (await page.context().cookies()).some((c) => c.name === "lcsp_session"),
  ).toBe(false);
});

test("expired caller redirects without a revocation success", async ({
  page,
}) => {
  const state = await setup(page);
  state.expire = true;
  await page.goto("/workspace/settings?section=account");
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await verifyPassword(page);
  await expect(page).toHaveURL(/\/sign-in/);
  expect(state.sessions).toHaveLength(2);
});

test("mobile modal supports keyboard revocation through MFA", async ({
  page,
}) => {
  const state = await setup(page);
  state.mfa = true;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/workspace");
  await page
    .getByRole("button", { name: "Toggle workspace navigation", exact: true })
    .click();
  await page
    .locator('[data-component="SidebarAccountTrigger"]')
    .filter({ visible: true })
    .click();
  await page
    .locator('[data-component="AccountPopover"]')
    .getByText("Settings", { exact: true })
    .click();
  const modal = page.locator('[data-presentation="modal"]');
  await modal.getByRole("button", { name: "Account", exact: true }).click();
  const revoke = modal.getByRole("button", { name: "Revoke", exact: true });
  await revoke.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await dialog.locator('input[autocomplete="one-time-code"]').fill("123456");
  await dialog.locator('button[type="submit"]').click();
  await expect(modal.getByRole("status")).toHaveText("Session revoked");
  const bounds = await modal
    .locator('[data-component="AccountSettingsPanel"]')
    .boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(376);
  expect(state.writes).toBe(1);
});

test("loading is distinct from empty and Vietnamese timestamps use the selected locale", async ({
  page,
}) => {
  await setup(page);
  await page
    .context()
    .addCookies([
      { name: "lcsp_locale", value: "vi", url: "http://127.0.0.1:3100" },
    ]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sessions", async (route) => {
    await gate;
    return route.fulfill({ json: { ok: true, data: sessionFixture } });
  });
  await page.goto("/workspace/settings?section=account");
  const panel = page.locator('[data-component="AccountSettingsPanel"]');
  await expect(panel.getByRole("status")).toHaveText(
    "Đang tải phiên đăng nhập…",
  );
  await expect(panel.locator("li")).toHaveCount(0);
  release();
  await expect(panel.locator("li")).toHaveCount(2);
  await expect(panel).toContainText("Hết hạn lúc");
  const expectedDate = await page.evaluate(
    (value) =>
      new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    sessionFixture.sessions[0].created_at,
  );
  await expect(panel.locator("li").first().locator("dd").first()).toHaveText(
    expectedDate,
  );
});
