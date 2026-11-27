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
const baseUrl = process.env.LCSP_R3_BASE_URL ?? "http://127.0.0.1:3128";
const { CAPABILITY_POLICY_REASONS, DOMAIN_ALLOWLIST_MODES, TOOL_ACCESS_MODES } =
  await import("@lcsp/contracts/auth");

const profile = {
  user_id: "m12-layout-fixture",
  email: "m12-layout@example.test",
  email_verified: true,
  display_name: "M12 Demo User",
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
  current_session_id: "m12-layout-session",
  current_session_created_at: "2026-01-01T00:00:00.000Z",
  current_session_updated_at: "2026-01-01T00:00:00.000Z",
  current_session_expires_at: "2026-01-02T00:00:00.000Z",
};
const capabilities = {
  tool_access_mode: TOOL_ACCESS_MODES.loadWhenNeeded,
  connector_search: true,
  artifacts: true,
  cloud_code_execution: {
    enabled: false,
    enforced: true,
    policy: CAPABILITY_POLICY_REASONS.platformRestricted,
  },
  network_egress: {
    enabled: false,
    enforced: true,
    policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
  },
  domain_allowlist: {
    mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
    custom_domains_supported: false,
    allowed_domains: ["registry.npmjs.org", "pypi.org"],
  },
  updated_at: "2026-11-25T10:00:00.000Z",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
});
await context.addCookies([
  { name: "lcsp_session", value: "mock-session:customer", url: baseUrl },
  { name: "lcsp_locale", value: "en", url: baseUrl },
]);
const page = await context.newPage();
const apiData = new Map([
  ["/api/workspace", { user: { id: profile.user_id, display_name: profile.display_name, role: "CUSTOMER" } }],
  ["/api/assessments", { assessments: [] }],
  ["/api/auth/profile", profile],
  ["/api/auth/sessions", { sessions: [] }],
  ["/api/auth/oauth/identities", { identities: [] }],
  ["/api/auth/capabilities", capabilities],
]);

await page.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (request.method() === "GET" && apiData.has(pathname)) {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: apiData.get(pathname) }),
    });
    return;
  }
  await route.continue();
});

try {
  await page.goto(`${baseUrl}/workspace`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(700);
  const settingsTrigger = page.getByRole("button", { name: "Settings" }).first();
  await settingsTrigger.waitFor({ state: "visible", timeout: 20_000 });
  await settingsTrigger.click();
  const settings = page.getByRole("dialog").first();
  await settings.waitFor({ state: "visible" });
  const nameInput = settings.locator("#settings-full-name");
  await nameInput.waitFor({ state: "visible" });
  await nameInput.fill("Alexandra Nguyen Tran with a deliberately long display name");
  const actionGroup = nameInput.locator("xpath=following-sibling::div");
  const responsiveLayouts = [];
  for (const target of [
    { width: 1440, height: 900, rootFontPercent: 100 },
    { width: 768, height: 600, rootFontPercent: 100 },
    { width: 390, height: 844, rootFontPercent: 125 },
    { width: 320, height: 740, rootFontPercent: 125 },
    { width: 320, height: 740, rootFontPercent: 200 },
  ]) {
    await page.setViewportSize({ width: target.width, height: target.height });
    await page.evaluate((fontPercent) => {
      document.documentElement.style.fontSize = `${fontPercent}%`;
    }, target.rootFontPercent);
    const inputBox = await nameInput.boundingBox();
    const actionBox = await actionGroup.boundingBox();
    const saveButton = settings.getByRole("button", { name: "Save changes" });
    const cancelButton = settings.getByRole("button", { name: "Cancel" });
    await saveButton.scrollIntoViewIfNeeded();
    const saveBox = await saveButton.boundingBox();
    const cancelBox = await cancelButton.boundingBox();
    const actionControlsReachable = [saveBox, cancelBox].every(
      (box) => box && box.y >= 0 && box.y + box.height <= target.height,
    );
    responsiveLayouts.push({
      ...target,
      inputWidth: inputBox?.width ?? 0,
      inputRightEdge: inputBox ? inputBox.x + inputBox.width : 0,
      actionsVisible: await actionGroup.isVisible(),
      actionsWidth: actionBox?.width ?? 0,
      actionsRightEdge: actionBox ? actionBox.x + actionBox.width : 0,
      saveVisible: await saveButton.isVisible(),
      cancelVisible: await cancelButton.isVisible(),
      actionControlsReachable,
      saveTop: saveBox?.y ?? null,
      cancelTop: cancelBox?.y ?? null,
      documentWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    });
    await nameInput.scrollIntoViewIfNeeded();
  }
  await settings.locator('[data-settings-tab="capabilities"]').click();
  const domainList = settings.locator('[data-component="AllowedPackageManagerDomains"]');
  const domainListCount = await domainList.count();
  const domainListText = domainListCount ? await domainList.textContent() : "";
  const domainPresentation = {
    hasAuthoritativeDomains: domainListText?.includes("registry.npmjs.org") &&
      domainListText?.includes("pypi.org"),
    hasEditableDomainInput: await settings.locator("#settings-domain-input").count() > 0,
    hasAddAction: await settings.getByRole("button", { name: "Add", exact: true }).count() > 0,
  };

  const failures = [];
  for (const layout of responsiveLayouts) {
    if (layout.inputWidth < 180) {
      failures.push(`Display-name input width is ${layout.inputWidth}px at ${layout.width}px/${layout.rootFontPercent}% text (minimum 180px).`);
    }
    if (!layout.actionsVisible || !layout.saveVisible || !layout.cancelVisible || !layout.actionControlsReachable) {
      failures.push(`Display-name actions are not reachable at ${layout.width}px/${layout.rootFontPercent}% text.`);
    }
    if (layout.documentWidth > layout.width) {
      failures.push(`Settings document width ${layout.documentWidth}px overflows a ${layout.width}px viewport at ${layout.rootFontPercent}% text.`);
    }
    if (layout.inputRightEdge > layout.width || layout.actionsRightEdge > layout.width) {
      failures.push(`Display-name input/actions are clipped at ${layout.width}px/${layout.rootFontPercent}% text.`);
    }
  }
  if (!domainPresentation.hasAuthoritativeDomains) {
    failures.push("The read-only domain policy does not show contract-returned domains.");
  }
  if (domainPresentation.hasEditableDomainInput) failures.push("Unsupported custom-domain input is still rendered.");
  if (domainPresentation.hasAddAction) failures.push("Unsupported custom-domain Add action is still rendered.");
  assert.deepEqual(failures, [], JSON.stringify({ responsiveLayouts, domainPresentation, failures }, null, 2));

  console.log(JSON.stringify({ responsiveLayouts, domainPresentation }, null, 2));
} finally {
  await browser.close();
}
