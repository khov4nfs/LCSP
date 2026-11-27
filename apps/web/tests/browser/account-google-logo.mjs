import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const { chromium } = createRequire(path.join(repositoryRoot, "package.json"))(
  "@playwright/test",
);
const baseUrl = process.env.LCSP_R4_BASE_URL ?? "http://127.0.0.1:3138";
const screenshotDirectory = process.env.LCSP_R4_SCREENSHOTS;
const locale = process.env.LCSP_R4_LOCALE ?? "en";
const theme = process.env.LCSP_R4_THEME ?? "light";

const profile = {
  user_id: "m12-r4-account-fixture",
  email: "account@example.test",
  email_verified: true,
  display_name: "Account Fixture",
  recovery_email: null,
  primary_email_address_policy: "ACCOUNT_EMAIL",
  backup_recovery_email_policy: "RECOVERY_EMAIL",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  role: "CUSTOMER",
  mfa_enrolled: true,
  mfa_enrolled_at: "2026-01-01T00:00:00.000Z",
  mfa_verified: true,
  mfa_verified_at: "2026-01-01T00:00:00.000Z",
  current_session_id: "m12-r4-current-session",
  current_session_created_at: "2026-01-01T00:00:00.000Z",
  current_session_updated_at: "2026-01-01T00:00:00.000Z",
  current_session_expires_at: "2027-01-01T00:00:00.000Z",
};

async function verifyLogo(browser, connected) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  await context.addCookies([
    { name: "lcsp_session", value: "mock-session:customer", url: baseUrl },
    { name: "lcsp_locale", value: locale, url: baseUrl },
  ]);
  await context.addInitScript((initialTheme) => localStorage.setItem("theme", initialTheme), theme);
  const page = await context.newPage();
  const imageResponses = [];
  page.on("response", (response) => {
    if (/google/i.test(response.url()) && response.request().resourceType() === "image") {
      imageResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const dataByPath = new Map([
      ["/api/workspace", { user: { id: profile.user_id, display_name: profile.display_name, role: "CUSTOMER" } }],
      ["/api/assessments", { assessments: [] }],
      ["/api/auth/profile", profile],
      ["/api/auth/sessions", { sessions: [] }],
      ["/api/auth/oauth/identities", {
        identities: connected
          ? [{ id: "m12-r4-google-identity", provider: "google", linked_at: "2026-01-02T00:00:00.000Z" }]
          : [],
      }],
    ]);
    const data = dataByPath.get(pathname);
    if (request.method() === "GET" && data) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, problem: { code: "FIXTURE_NOT_FOUND" } }),
    });
  });

  try {
    await page.goto(`${baseUrl}/workspace`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    // Wait for the workspace shell to hydrate before exercising its Settings trigger.
    await page.waitForTimeout(800);
    const settingsTrigger = page.getByRole("button", { name: /settings|cài đặt/i }).first();
    await settingsTrigger.waitFor({ state: "visible", timeout: 20_000 });
    await settingsTrigger.click();
    const settings = page.getByRole("dialog").first();
    await settings.waitFor({ state: "visible" });
    await settings.locator('[data-settings-tab="account"]').click();
    const oauthSection = settings.locator('[data-component="AccountOAuthSection"]');
    await oauthSection.waitFor({ state: "visible" });
    const statusLabel = locale === "vi"
      ? (connected ? "Đã liên kết" : "Chưa liên kết")
      : (connected ? "Connected" : "Not connected");
    await oauthSection.getByText(statusLabel, { exact: true }).waitFor({ state: "visible" });
    const image = oauthSection.locator("img");
    await image.waitFor({ state: "visible" });
    await page.waitForFunction(
      (element) => element instanceof HTMLImageElement && element.complete,
      await image.elementHandle(),
    );

    const imageState = await image.evaluate((element) => ({
      src: element.currentSrc,
      complete: element.complete,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
    }));
    assert.ok(imageState.naturalWidth > 0, `Google logo did not load: ${JSON.stringify(imageState)}`);
    assert.ok(imageState.naturalHeight > 0, `Google logo has no rendered asset dimensions: ${JSON.stringify(imageState)}`);
    assert.ok(imageResponses.length > 0, `No Google image response was observed: ${JSON.stringify(imageState)}`);
    assert.ok(imageResponses.every((response) => response.status === 200), JSON.stringify(imageResponses));

    const stateName = connected ? "connected" : "disconnected";
    if (screenshotDirectory) {
      const fs = await import("node:fs/promises");
      await fs.mkdir(screenshotDirectory, { recursive: true });
      // Hide only Next's development badge so evidence shows the app surface without browser tooling.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.screenshot({
        path: path.join(screenshotDirectory, `frame-30-google-${stateName}-${locale}-${theme}.png`),
        fullPage: true,
      });
    }

    return { state: stateName, locale, theme, imageState, imageResponses };
  } finally {
    await context.close();
  }
}

// This browser regression checks the bundled brand asset in both account states; all account data is synthetic and intercepted.
const browser = await chromium.launch({ headless: true });
try {
  const results = [];
  results.push(await verifyLogo(browser, false));
  results.push(await verifyLogo(browser, true));
  console.log(JSON.stringify({ fixture: "synthetic account and OAuth identity responses", results }, null, 2));
} finally {
  await browser.close();
}
