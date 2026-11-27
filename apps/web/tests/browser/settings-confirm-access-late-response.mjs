import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";

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
const reducedMotion = process.env.LCSP_R4_REDUCED_MOTION === "true";
const profile = {
  user_id: "m12-r4-security-fixture",
  email: "security@example.test",
  email_verified: true,
  display_name: "Security Fixture",
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
let releaseLateProof;
let signalLateProofStarted;
const lateProofStarted = new Promise((resolve) => {
  signalLateProofStarted = resolve;
});
const releaseLateProofPromise = new Promise((resolve) => {
  releaseLateProof = resolve;
});
let mfaDeleteCount = 0;
let passwordProofCount = 0;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: theme,
  reducedMotion: reducedMotion ? "reduce" : "no-preference",
});
await context.addCookies([
  { name: "lcsp_session", value: "mock-session:customer", url: baseUrl },
  { name: "lcsp_locale", value: locale, url: baseUrl },
]);
await context.addInitScript((initialTheme) => localStorage.setItem("theme", initialTheme), theme);
const page = await context.newPage();
assert.equal(
  await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
  reducedMotion,
  "The browser context must expose its configured motion preference.",
);

// The test models only the documented challenge and confirmation envelopes; it never sends proof to a real service.
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (request.method() === "DELETE" && pathname === "/api/auth/mfa") {
    mfaDeleteCount += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        problem: {
          type: "auth/reauth-required",
          status: 403,
          code: AUTH_ERROR_CODES.reauthRequired,
          titleKey: "auth.errors.reauthRequired.title",
          detailKey: "auth.errors.reauthRequired.detail",
          requiredAction: REQUIRED_ACTIONS.reauthenticate,
          correlationId: "m12-r4-fixture",
        },
      }),
    });
    return;
  }
  if (request.method() === "POST" && pathname === "/api/auth/re-auth/password") {
    passwordProofCount += 1;
    if (passwordProofCount === 1) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          problem: {
            type: "auth/invalid-credentials",
            status: 401,
            code: AUTH_ERROR_CODES.invalidCredentials,
            titleKey: "auth.errors.invalidCredentials.title",
            detailKey: "auth.errors.invalidCredentials.detail",
            requiredAction: REQUIRED_ACTIONS.none,
            correlationId: "m12-r4-fixture",
          },
        }),
      });
      return;
    }
    signalLateProofStarted();
    await releaseLateProofPromise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { verified: true } }),
    });
    return;
  }

  const dataByPath = new Map([
    ["/api/workspace", { user: { id: profile.user_id, display_name: profile.display_name, role: "CUSTOMER" } }],
    ["/api/assessments", { assessments: [] }],
    ["/api/auth/profile", profile],
    ["/api/auth/sessions", { sessions: [
      {
        id: "m12-r4-current-session",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2027-01-01T00:00:00.000Z",
        revoked_at: null,
        mfa_verified_at: "2026-01-01T00:00:00.000Z",
        is_current: true,
      },
      {
        id: "m12-r4-other-session",
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        expires_at: "2027-01-02T00:00:00.000Z",
        revoked_at: null,
        mfa_verified_at: null,
        is_current: false,
      },
    ] }],
    ["/api/auth/oauth/identities", { identities: [] }],
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
  await page.goto(`${baseUrl}/workspace`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /settings|cài đặt/i }).first().click();
  const settings = page.getByRole("dialog").first();
  await settings.waitFor({ state: "visible" });
  await settings.locator('[data-settings-tab="account"]').click();
  const account = settings.locator('[data-component="AccountSettingsPanel"]');
  await account.waitFor({ state: "visible" });

  const sessionRows = account.locator("ul > li");
  await sessionRows.first().waitFor({ state: "visible" });
  if (screenshotDirectory) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(screenshotDirectory, { recursive: true });
    // Hide only Next's development badge so evidence shows the app surface without browser tooling.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({
      path: path.join(screenshotDirectory, `frame-30-account-sessions-${locale}-${theme}.png`),
      fullPage: true,
    });
  }
  assert.equal(await sessionRows.count(), 2, "Only contract-returned sessions are rendered.");
  if (screenshotDirectory) {
    await sessionRows.first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(screenshotDirectory, `frame-30-session-list-${locale}-${theme}.png`),
    });
  }
  assert.equal(await sessionRows.nth(0).getByRole("button").count(), 0, "The current session has no revoke action.");
  assert.equal(await sessionRows.nth(1).getByRole("button", { name: /revoke|thu hồi/i }).count(), 1, "The other session has its supported revoke action.");

  const mfaSection = account.locator('section[aria-labelledby="settings-mfa-heading"]');
  const disableButton = mfaSection.getByRole("button").nth(1);
  await disableButton.scrollIntoViewIfNeeded();
  await disableButton.click();
  await page.getByRole("dialog").last().locator("button").nth(-2).click();
  const accessDialog = page.locator('[role="dialog"]').last();
  await accessDialog.waitFor({ state: "visible" });
  // Wait for the shared popup's entry scale to settle before comparing its desktop frame width.
  await page.waitForFunction((element) => !element.hasAttribute("data-starting-style"), await accessDialog.elementHandle());
  await accessDialog.locator("#confirm-access-password").waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  assert.ok(
    await accessDialog.evaluate((dialog) => dialog.contains(document.activeElement)),
    "Opening Confirm Access must move focus into the topmost dialog.",
  );
  for (let tabIndex = 0; tabIndex < 16; tabIndex += 1) {
    await page.keyboard.press("Tab");
    // Base UI redirects its hidden focus sentinel on the next animation frame; observe the settled focus target.
    await page.waitForTimeout(50);
    const focusState = await accessDialog.evaluate((dialog) => ({
      contained: dialog.contains(document.activeElement),
      activeTag: document.activeElement?.tagName,
      activeId: document.activeElement?.id,
      activeName: document.activeElement?.getAttribute("aria-label"),
      activeText: document.activeElement?.textContent?.trim().slice(0, 50),
    }));
    assert.ok(focusState.contained, `Tab navigation must remain contained by Confirm Access: ${JSON.stringify(focusState)}`);
  }
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(50);
  assert.ok(
    await accessDialog.evaluate((dialog) => dialog.contains(document.activeElement)),
    "Reverse tab navigation must remain contained by Confirm Access.",
  );
  const passwordInput = accessDialog.locator("#confirm-access-password");
  const passwordToggle = passwordInput.locator("xpath=..").locator("button");
  await passwordToggle.focus();
  await page.keyboard.press("Space");
  assert.equal(await passwordInput.getAttribute("type"), "text", "The password visibility control must be keyboard operable.");
  await page.keyboard.press("Space");
  assert.equal(await passwordInput.getAttribute("type"), "password", "Keyboard activation must restore masked password entry.");
  await accessDialog.locator("#confirm-access-password").evaluate((input) => input.blur());
  const dialogBox = await accessDialog.boundingBox();
  const dialogStyle = await accessDialog.evaluate((element) => ({
    className: element.className,
    maxWidth: getComputedStyle(element).maxWidth,
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
  }));
  assert.ok(dialogBox && Math.abs(dialogBox.width - 480) < 2, `Frame 39 desktop dialog width should be 480px: ${JSON.stringify({ dialogBox, dialogStyle })}`);

  // The nested step-up popup replaces an unmounted confirmation button, so focus returns to the selected Settings tab.
  await page.keyboard.press("Escape");
  await passwordInput.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("dialog").count(), 1, "Escape dismisses Confirm Access while preserving Settings.");
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("data-settings-tab")),
    "account",
    "Closing Confirm Access must restore focus to the active Account tab when the initiating confirmation is unmounted.",
  );
  await disableButton.click();
  await page.getByRole("dialog").last().locator("button").nth(-2).click();
  await accessDialog.waitFor({ state: "visible" });
  await page.waitForFunction((element) => !element.hasAttribute("data-starting-style"), await accessDialog.elementHandle());
  await passwordInput.waitFor({ state: "visible" });

  const responsiveProfiles = [
    { width: 390, height: 844, fontSize: "100%", name: "390-normal" },
    { width: 390, height: 844, fontSize: "125%", name: "390-root125" },
    { width: 320, height: 740, fontSize: "100%", name: "320-normal" },
    { width: 320, height: 740, fontSize: "125%", name: "320-root125" },
    { width: 320, height: 740, fontSize: "200%", name: "320-root200" },
  ];
  const dialogBody = accessDialog.locator('[data-slot="dialog-body"]');
  const identityCard = accessDialog.locator('[data-slot="card"]').first();
  const identityHandle = identityCard.locator("p").nth(1);
  const supportCard = accessDialog.locator('[data-slot="card"]').nth(1);
  const submit = accessDialog.locator('button[type="submit"]');
  if (screenshotDirectory) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(screenshotDirectory, { recursive: true });
    // Hide only Next's development badge so evidence shows the current Settings UI.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: path.join(screenshotDirectory, `frame-39-confirm-access-password-${locale}-${theme}.png`) });
  }
  for (const responsiveProfile of responsiveProfiles) {
    await page.setViewportSize({ width: responsiveProfile.width, height: responsiveProfile.height });
    await page.evaluate((fontSize) => { document.documentElement.style.fontSize = fontSize; }, responsiveProfile.fontSize);
    await page.waitForTimeout(150);
    await dialogBody.evaluate((element) => { element.scrollTop = 0; });
    const bounds = await accessDialog.boundingBox();
    const closeBounds = await accessDialog.locator('[data-slot="dialog-close"]').boundingBox();
    const titleBounds = await accessDialog.locator('[data-slot="dialog-title"]').boundingBox();
    const metrics = await accessDialog.evaluate((dialog) => {
      const header = dialog.querySelector('[data-slot="dialog-header"]');
      const title = dialog.querySelector('[data-slot="dialog-title"]');
      const range = document.createRange();
      if (title) range.selectNodeContents(title);
      return {
        titleLines: range.getClientRects().length,
        headerHeight: header?.getBoundingClientRect().height,
        cards: [...dialog.querySelectorAll('[data-slot="card"]')].map((card) => ({
          height: card.getBoundingClientRect().height,
          contentHeight: card.querySelector('[data-slot="card-content"]')?.getBoundingClientRect().height,
        })),
        bodyOverflowY: getComputedStyle(dialog.querySelector('[data-slot="dialog-body"]')).overflowY,
      };
    });
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= responsiveProfile.width, `Dialog fits ${responsiveProfile.name}: ${JSON.stringify(bounds)}`);
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= responsiveProfile.height + 1, `Dialog fits the short viewport ${responsiveProfile.name}: ${JSON.stringify(bounds)}`);
    assert.ok(closeBounds && closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= responsiveProfile.width && closeBounds.y >= 0, `Close remains visible at ${responsiveProfile.name}: ${JSON.stringify(closeBounds)}`);
    assert.ok(titleBounds && titleBounds.y >= 0, `Title remains visible at ${responsiveProfile.name}: ${JSON.stringify(titleBounds)}`);
    assert.ok(metrics.cards.every((card) => card.height >= (card.contentHeight ?? 0)), `Cards retain their content height at ${responsiveProfile.name}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.bodyOverflowY, "auto", `Content remains scrollable at ${responsiveProfile.name}.`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No horizontal overflow at ${responsiveProfile.name}.`);
    if (responsiveProfile.width === 320 && responsiveProfile.fontSize !== "100%") {
      assert.ok(metrics.titleLines <= 3, `Narrow Vietnamese title reflows at ${responsiveProfile.name}: ${JSON.stringify(metrics)}`);
    }
    if (screenshotDirectory && ["390-root125", "320-root125", "320-root200"].includes(responsiveProfile.name)) {
      await page.screenshot({
        path: path.join(screenshotDirectory, `frame-39-confirm-access-${responsiveProfile.name}-${locale}-${theme}.png`),
      });
    }
    await identityHandle.scrollIntoViewIfNeeded();
    const handleBounds = await identityHandle.boundingBox();
    const bodyBounds = await dialogBody.boundingBox();
    assert.ok(handleBounds && bodyBounds && handleBounds.y < bodyBounds.y + bodyBounds.height && handleBounds.y + handleBounds.height > bodyBounds.y, `Identity is reachable in the dialog scroll area at ${responsiveProfile.name}: ${JSON.stringify({ handleBounds, bodyBounds, metrics })}`);
    // At extreme root-text enlargement, the identity must not collapse to a narrow side column beside the avatar.
    if (responsiveProfile.name === "320-root200") {
      assert.ok(handleBounds && handleBounds.width >= 120, `The account identifier needs a usable reading width at ${responsiveProfile.name}: ${JSON.stringify(handleBounds)}`);
      const identityLayout = await identityCard.evaluate((card) => {
        const content = card.querySelector('[data-slot="card-content"]');
        const handle = card.querySelectorAll("p")[1];
        const contentBounds = content?.getBoundingClientRect();
        const handleBounds = handle?.getBoundingClientRect();
        return {
          contentRight: contentBounds?.right,
          handleLeft: handleBounds?.left,
          handleRight: handleBounds?.right,
          handleWidth: handleBounds?.width,
          scrollWidth: handle?.scrollWidth,
          clientWidth: handle?.clientWidth,
        };
      });
      assert.ok(
        identityLayout.handleLeft !== undefined && identityLayout.contentRight !== undefined &&
        identityLayout.handleRight !== undefined && identityLayout.handleLeft >= 0 &&
        identityLayout.handleRight <= identityLayout.contentRight + 1 &&
        (identityLayout.scrollWidth ?? 0) <= (identityLayout.clientWidth ?? 0) + 1,
        `The enlarged account identifier must wrap inside its card rather than overflow horizontally: ${JSON.stringify(identityLayout)}`,
      );
    }
    // Capture the identity after scrolling so the 200% stress evidence shows content that starts below the enlarged header.
    if (screenshotDirectory && responsiveProfile.name === "320-root200") {
      await page.screenshot({
        path: path.join(screenshotDirectory, `frame-39-confirm-access-${responsiveProfile.name}-identity-scroll-${locale}-${theme}.png`),
      });
    }
    await supportCard.locator("a, button").last().scrollIntoViewIfNeeded();
    const supportActionBounds = await supportCard.locator("a, button").last().boundingBox();
    const scrolledBodyBounds = await dialogBody.boundingBox();
    assert.ok(supportActionBounds && scrolledBodyBounds && supportActionBounds.y >= scrolledBodyBounds.y - 1 && supportActionBounds.y + supportActionBounds.height <= scrolledBodyBounds.y + scrolledBodyBounds.height + 1, `Support action is reachable at ${responsiveProfile.name}.`);
    // Capture the scrolled support actions separately to demonstrate they remain reachable without shrinking the card.
    if (screenshotDirectory && responsiveProfile.name === "320-root200") {
      await page.screenshot({
        path: path.join(screenshotDirectory, `frame-39-confirm-access-${responsiveProfile.name}-support-scroll-${locale}-${theme}.png`),
      });
    }
    await submit.scrollIntoViewIfNeeded();
    const submitBounds = await submit.boundingBox();
    assert.ok(submitBounds && submitBounds.y >= 0 && submitBounds.y + submitBounds.height <= responsiveProfile.height, `Submit is reachable at ${responsiveProfile.name}.`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
  await page.waitForTimeout(150);

  if (screenshotDirectory) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(screenshotDirectory, { recursive: true });
    // Hide only Next's development badge so evidence shows the app surface without browser tooling.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: path.join(screenshotDirectory, `frame-39-confirm-access-password-${locale}-${theme}.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(screenshotDirectory, `frame-39-confirm-access-password-mobile-${locale}-${theme}-root125.png`) });
    const mobileBox = await accessDialog.boundingBox();
    assert.ok(mobileBox && mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390, `Confirm Access must fit the mobile viewport: ${JSON.stringify(mobileBox)}`);
    // The narrow text-enlargement check ensures the dialog remains operable without relying on browser zoom.
    await page.setViewportSize({ width: 320, height: 740 });
    await page.waitForTimeout(200);
    const narrowDialog = await accessDialog.boundingBox();
    const narrowClose = await accessDialog.locator('[data-slot="dialog-close"]').boundingBox();
    const narrowTitle = await accessDialog.locator('[data-slot="dialog-title"]').boundingBox();
    const dialogBody = accessDialog.locator('[data-slot="dialog-body"]');
    const bodyOverflowY = await dialogBody.evaluate((element) => getComputedStyle(element).overflowY);
    assert.ok(narrowDialog && narrowDialog.x >= 0 && narrowDialog.x + narrowDialog.width <= 320, `Confirm Access must fit the narrow viewport: ${JSON.stringify(narrowDialog)}`);
    assert.ok(narrowClose && narrowClose.x >= 0 && narrowClose.x + narrowClose.width <= 320 && narrowClose.y >= 0, `The dialog close control must remain visible at 320px: ${JSON.stringify(narrowClose)}`);
    assert.ok(narrowTitle && narrowTitle.y >= 0, `The dialog title must remain visible at 320px: ${JSON.stringify(narrowTitle)}`);
    assert.equal(bodyOverflowY, "auto", "The dialog body retains its existing scroll behavior for enlarged content.");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "The narrow dialog must not introduce horizontal document overflow.");
    const submit = accessDialog.locator('button[type="submit"]');
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    assert.ok(submitBox && submitBox.y >= 0 && submitBox.y + submitBox.height <= 740, `The dialog action must remain reachable at 320px: ${JSON.stringify(submitBox)}`);
    // The signed-in identity card must scroll as a whole instead of shrinking its contents inside the dialog body.
    const identityCard = accessDialog.locator('[data-slot="card"]').first();
    const identityContent = identityCard.locator('[data-slot="card-content"]');
    const identityHandle = identityCard.locator("p").nth(1);
    const identityMetrics = await identityContent.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    const handleStyle = await identityHandle.evaluate((element) => ({
      textContent: element.textContent,
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflowWrap: getComputedStyle(element).overflowWrap,
    }));
    const headerMetrics = await accessDialog.evaluate((dialog) => {
      const header = dialog.querySelector('[data-slot="dialog-header"]');
      const title = dialog.querySelector('[data-slot="dialog-title"]');
      const range = document.createRange();
      if (title) range.selectNodeContents(title);
      return {
        headerHeight: header?.getBoundingClientRect().height,
        titleLineFragments: range.getClientRects().length,
        cards: [...dialog.querySelectorAll('[data-slot="card"]')].map((card) => ({
          height: card.getBoundingClientRect().height,
          contentHeight: card.querySelector('[data-slot="card-content"]')?.getBoundingClientRect().height,
        })),
        bodyScrollHeight: dialog.querySelector('[data-slot="dialog-body"]')?.scrollHeight,
      };
    });
    console.log(JSON.stringify({ narrowLayout: headerMetrics, identityContent: identityMetrics }));
    assert.ok(
      headerMetrics.cards.every((card) => card.height >= (card.contentHeight ?? 0)),
      `Confirm Access cards must not shrink below their content height: ${JSON.stringify(headerMetrics)}`,
    );
    assert.deepEqual(handleStyle, {
      textContent: "security@example.test",
      whiteSpace: "normal",
      overflowWrap: "break-word",
    }, "The signed-in identity must remain readable when the narrow card cannot fit its email on one line.");
    assert.ok(
      headerMetrics.titleLineFragments <= 3,
      `The mobile header should reflow before the Vietnamese title consumes four lines: ${JSON.stringify(headerMetrics)}`,
    );
    assert.ok(
      identityMetrics.scrollHeight <= identityMetrics.clientHeight + 1,
      `Identity content must not be clipped within its card: ${JSON.stringify(identityMetrics)}`,
    );
    await page.screenshot({ path: path.join(screenshotDirectory, `frame-39-confirm-access-mobile-320-${locale}-${theme}-root125.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
  }

  await accessDialog.getByRole("button", { name: /authenticator|ứng dụng xác thực/i }).click();
  await accessDialog.locator("#confirm-access-otp").waitFor({ state: "visible" });
  if (screenshotDirectory) {
    await page.screenshot({ path: path.join(screenshotDirectory, `frame-39-confirm-access-mfa-${locale}-${theme}.png`) });
  }
  const protectedActionRequestCount = mfaDeleteCount;
  await accessDialog.getByRole("button", { name: /password|mật khẩu/i }).click();
  await accessDialog.locator("#confirm-access-password").waitFor({ state: "visible" });

  await accessDialog.locator("#confirm-access-password").fill("synthetic-invalid-proof");
  await accessDialog.getByRole("button", { name: /^(confirm|xác nhận)$/i }).click();
  await accessDialog.getByRole("alert").waitFor({ state: "visible" });
  assert.equal(mfaDeleteCount, protectedActionRequestCount, "Invalid proof cannot resume the protected action.");

  await accessDialog.locator("#confirm-access-password").fill("synthetic-pending-proof");
  await accessDialog.getByRole("button", { name: /^(confirm|xác nhận)$/i }).click();
  await lateProofStarted;
  await accessDialog.locator('[data-slot="dialog-close"]').click();
  await page.locator("#confirm-access-password").waitFor({ state: "detached" });
  assert.equal(await page.getByRole("dialog").count(), 1, "Dismissing Confirm Access keeps the parent Settings modal open.");
  releaseLateProof();
  await page.waitForTimeout(400);

  assert.equal(mfaDeleteCount, protectedActionRequestCount, "A late verification response after dismissal must not resume the protected action.");
  assert.equal(passwordProofCount, 2, "Both proofs were synthetic and isolated to this browser fixture.");
  console.log(JSON.stringify({
    evidence: "FIXTURE_BFF_VERIFIED",
    locale,
    theme,
    reducedMotion,
    sessions: { returned: await sessionRows.count(), currentSessionRevocable: false, otherSessionRevokeAction: true },
    confirmAccess: { passwordAndOtpModesReachable: true, invalidProofDidNotResume: true, dismissedLateProofDidNotResume: true },
    calls: { mfaDisable: mfaDeleteCount, passwordProof: passwordProofCount },
  }, null, 2));
} finally {
  releaseLateProof();
  await context.close();
  await browser.close();
}
