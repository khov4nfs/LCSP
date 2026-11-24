import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const profileFixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const sessionsFixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-sessions.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

async function setup(page: Page, identities: Array<{ id: string; provider: string; linked_at: string }> = []) {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);

  await page.route("**/api/auth/profile", (route) => {
    return route.fulfill({
      status: 200,
      json: { ok: true, data: profileFixture.profile },
    });
  });

  await page.route("**/api/auth/sessions", (route) => {
    return route.fulfill({
      status: 200,
      json: { ok: true, data: sessionsFixture },
    });
  });

  let currentIdentities = [...identities];
  let failIdentities = false;

  await page.route("**/api/auth/oauth/identities", (route) => {
    if (failIdentities) {
      return route.fulfill({
        status: 500,
        json: { ok: false, problem: { code: "UPSTREAM_UNAVAILABLE", status: 500 } },
      });
    }
    return route.fulfill({
      status: 200,
      json: { ok: true, data: { identities: currentIdentities } },
    });
  });

  return {
    setIdentities: (ids: typeof identities) => {
      currentIdentities = ids;
    },
    setFailIdentities: (fail: boolean) => {
      failIdentities = fail;
    },
  };
}

test.describe("Settings Account OAuth Linking", () => {
  test("TC01 - Unlinked account displays Not connected and Connect button", async ({ page }) => {
    await setup(page, []);
    await page.goto("/workspace/settings?section=account");

    const oauthSection = page.locator('[data-component="AccountOAuthSection"]');
    await expect(oauthSection).toBeVisible();
    await expect(oauthSection.getByText("Google")).toBeVisible();
    await expect(oauthSection.getByText("Not connected")).toBeVisible();
    await expect(oauthSection.getByRole("button", { name: "Connect" })).toBeVisible();
  });

  test("TC02 - Linked account displays Connected badge and linked date", async ({ page }) => {
    await setup(page, [
      {
        id: "google-link-1",
        provider: "google",
        linked_at: "2026-11-24T09:00:00.000Z",
      },
    ]);
    await page.goto("/workspace/settings?section=account");

    const oauthSection = page.locator('[data-component="AccountOAuthSection"]');
    await expect(oauthSection).toBeVisible();
    await expect(oauthSection.getByText("Google")).toBeVisible();
    await expect(oauthSection.getByText(/Linked on/)).toBeVisible();
    await expect(oauthSection.getByText("Connected", { exact: true })).toBeVisible();
    await expect(oauthSection.getByRole("button", { name: "Connect" })).not.toBeVisible();
  });

  test("TC13 - API identities failure displays error alert and Retry button", async ({ page }) => {
    const harness = await setup(page, []);
    harness.setFailIdentities(true);
    await page.goto("/workspace/settings?section=account");

    const oauthSection = page.locator('[data-component="AccountOAuthSection"]');
    await expect(oauthSection).toBeVisible();
    const errorAlert = oauthSection.locator('[data-testid="oauth-load-error-alert"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("TC14 - Manipulated URL with oauth_link=success does not show false success if backend is not linked", async ({ page }) => {
    await setup(page, []);
    await page.goto("/workspace/settings?section=account&oauth_link=success");

    const oauthSection = page.locator('[data-component="AccountOAuthSection"]');
    await expect(oauthSection).toBeVisible();
    // Because backend identities is empty, success banner MUST NOT be displayed
    const successBanner = oauthSection.locator('[data-testid="oauth-link-success-banner"]');
    await expect(successBanner).not.toBeVisible();
    // And provider status remains Not connected
    await expect(oauthSection.getByText("Not connected")).toBeVisible();
  });
});
