import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_ERROR_CODES,
  REQUIRED_ACTIONS,
} from "@lcsp/contracts/auth";
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
const security = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-account-security.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const sessions = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/settings-sessions.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

async function setup(page: Page, enrolled = false) {
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
  const state = {
    profile: { ...structuredClone(fixture.profile), mfa_enrolled: enrolled },
    writes: 0,
    disableWrites: 0,
    batches: 0,
    audits: 0,
    otpWrites: 0,
    mfaProof: false,
    passwordProof: false,
    requireProofs: false,
    ignoreSave: false,
    failRead: false,
    failAfterWrite: false,
    reject: false,
    invalidPassword: false,
    malformedCodes: false,
    enrolling: false,
    ambiguousBatch: false,
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const problem = (route: Route, code: string, status = 403) =>
    route.fulfill({
      status,
      json: {
        ...fixture.failure,
        problem: {
          ...fixture.failure.problem,
          code,
          status,
          requiredAction:
            code === AUTH_ERROR_CODES.reauthRequired
              ? REQUIRED_ACTIONS.reauthenticate
              : REQUIRED_ACTIONS.none,
        },
      },
    });
  const challenge = (route: Route) => {
    if (!state.requireProofs) return null;
    if (!state.mfaProof) return problem(route, AUTH_ERROR_CODES.mfaRequired);
    if (!state.passwordProof)
      return problem(route, AUTH_ERROR_CODES.reauthRequired);
    return null;
  };
  await page.route("**/api/auth/profile", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        status: state.failRead ? 503 : 200,
        json: state.failRead
          ? fixture.failure
          : { ok: true, data: state.profile },
      });
    state.writes++;
    if (state.reject)
      return problem(route, AUTH_ERROR_CODES.validationFailed, 400);
    const proof = challenge(route);
    if (proof) return proof;
    if (!state.ignoreSave)
      Object.assign(state.profile, route.request().postDataJSON());
    if (state.profile.recovery_email === "")
      state.profile.recovery_email = null;
    if (state.failAfterWrite) state.failRead = true;
    return route.fulfill({
      json: {
        ok: true,
        data: { updated_fields: Object.keys(route.request().postDataJSON()) },
      },
    });
  });
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { ok: true, data: state.profile } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({
      json: { ok: true, data: { sessions: sessions.sessions } },
    }),
  );
  await page.route("**/api/auth/re-auth/password", (route) => {
    if (state.invalidPassword)
      return problem(route, AUTH_ERROR_CODES.invalidCredentials, 401);
    state.passwordProof = true;
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  await page.route("**/api/auth/mfa/verify-otp", (route) => {
    state.otpWrites++;
    state.mfaProof = true;
    state.profile.mfa_verified = true;
    if (state.enrolling) {
      state.profile.mfa_enrolled = true;
      state.enrolling = false;
    }
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  await page.route("**/api/auth/mfa/enroll", (route) => {
    state.enrolling = true;
    return route.fulfill({ json: { ok: true, data: security.enrollment } });
  });
  await page.route("**/api/auth/mfa", (route) => {
    state.disableWrites++;
    const proof = challenge(route);
    if (proof) return proof;
    state.profile.mfa_enrolled = false;
    state.profile.mfa_verified = false;
    if (state.failAfterWrite) state.failRead = true;
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  await page.route("**/api/auth/mfa/recovery-codes", (route) => {
    state.batches++;
    const proof = challenge(route);
    if (proof) return proof;
    if (state.ambiguousBatch) return route.abort();
    return route.fulfill({
      json: {
        ok: true,
        data: state.malformedCodes ? security.malformed : security.replacement,
      },
    });
  });
  await page.route("**/api/auth/mfa/recovery-codes/access", (route) => {
    state.audits++;
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  return { state, errors };
}

const emailSection = (page: Page) =>
  page.getByRole("region", { name: "Recovery email and email preferences" });
const mfaSection = (page: Page) =>
  page.getByRole("region", { name: "Two-factor authentication", exact: true });
async function password(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Confirm access" });
  await dialog.locator('input[type="password"]').fill("test-only-verification");
  await dialog.locator('button[type="submit"]').click();
}
async function otp(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Confirm access" });
  await dialog
    .getByLabel("Authentication code", { exact: true })
    .fill("123456");
  await dialog.locator('button[type="submit"]').click();
}
async function confirm(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("dialog", { name, exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
}

test("validates email policy, saves through OTP and password challenges, and persists after reload", async ({
  page,
}) => {
  const { state, errors } = await setup(page, true);
  state.requireProofs = true;
  await page.goto("/workspace/settings?section=account");
  const section = emailSection(page);
  await expect(
    page.getByRole("button", { name: "Refresh account information" }),
  ).toHaveCount(0);
  await section
    .getByRole("combobox", { name: "Primary email address policy" })
    .click();
  await page
    .getByRole("option", { name: "Recovery email", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Save security preferences" })
    .click();
  await expect(section).toContainText(
    "Enter a recovery email before selecting it as the primary address.",
  );
  expect(state.writes).toBe(0);
  await section
    .getByLabel("Recovery email", { exact: true })
    .fill(` ${security.email.toUpperCase()} `);
  await section
    .getByRole("combobox", { name: "Backup recovery email policy" })
    .click();
  await page.getByRole("option", { name: "All verified addresses" }).click();
  await section
    .getByRole("button", { name: "Save security preferences" })
    .click();
  await otp(page);
  await password(page);
  await expect(section.getByRole("status")).toHaveText(
    "Security preferences saved and confirmed.",
  );
  expect(state.writes).toBe(3);
  expect(state.profile.backup_recovery_email_policy).toBe(
    AUTH_BACKUP_EMAIL_POLICIES.allVerified,
  );
  await page.reload();
  await expect(
    section.getByLabel("Recovery email", { exact: true }),
  ).toHaveValue(security.email);
  await page.screenshot({
    path: test.info().outputPath("account-security-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("keeps drafts on rejected or mismatched writes and cancellation", async ({
  page,
}) => {
  const { state } = await setup(page);
  await page.goto("/workspace/settings?section=account");
  const section = emailSection(page);
  await section
    .getByLabel("Recovery email", { exact: true })
    .fill(security.email);
  state.ignoreSave = true;
  await section
    .getByRole("button", { name: "Save security preferences" })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "Could not confirm the result",
  );
  await expect(section.getByRole("status")).toHaveCount(0);
  await expect(
    section.getByLabel("Recovery email", { exact: true }),
  ).toHaveValue(security.email);
  state.ignoreSave = false;
  state.reject = true;
  await section
    .getByRole("button", { name: "Save security preferences" })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "The email or policy was rejected",
  );
  state.reject = false;
  state.requireProofs = true;
  await section
    .getByRole("button", { name: "Save security preferences" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Confirm access" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(section.getByRole("alert")).toContainText(
    "Verification canceled",
  );
  expect(state.writes).toBe(3);
});

test("failed confirmation read keeps the email draft and reload confirms without a second write", async ({
  page,
}) => {
  const { state } = await setup(page);
  state.failAfterWrite = true;
  await page.goto("/workspace/settings?section=account");
  const section = emailSection(page);
  await section
    .getByLabel("Recovery email", { exact: true })
    .fill(security.email);
  await section
    .getByRole("button", { name: "Save security preferences" })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "Could not confirm the result",
  );
  await expect(
    section.getByLabel("Recovery email", { exact: true }),
  ).toHaveValue(security.email);
  state.failRead = false;
  await page.reload();
  await expect(
    section.getByRole("button", { name: "Save security preferences" }),
  ).toBeDisabled();
  expect(state.writes).toBe(1);
});

test("enrolls inline, validates OTP, confirms enabled state and clears codes after closing", async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.goto("/workspace/settings?section=account");
  const section = mfaSection(page);
  await section
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await expect(section.getByRole("img")).toBeVisible();
  await expect(section).toContainText("Authenticator is not enabled.");
  await section.getByLabel("Authentication code", { exact: true }).fill("12");
  await section.getByRole("button", { name: "Verify", exact: true }).click();
  expect(state.otpWrites).toBe(0);
  await section
    .getByLabel("Authentication code", { exact: true })
    .fill("123456");
  await section.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(section).toContainText("Authenticator verified and enabled.");
  await expect(section.getByRole("img")).toHaveCount(0);
  await expect(section).toContainText(security.enrollment.recovery_codes[0]);
  await section
    .getByRole("button", { name: "I have saved these codes" })
    .click();
  await expect(section).not.toContainText(
    security.enrollment.recovery_codes[0],
  );
  await page.reload();
  await expect(section).toContainText(
    "Authenticator enabled for this account.",
  );
  expect(errors).toEqual([]);
});

test("disable cancellation is safe and confirmed disable completes both proofs", async ({
  page,
}) => {
  const { state, errors } = await setup(page, true);
  state.requireProofs = true;
  await page.goto("/workspace/settings?section=account");
  await page
    .getByRole("button", {
      name: "Disable two-factor authentication",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: "Disable two-factor authentication" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(state.disableWrites).toBe(0);
  await confirm(page, "Disable two-factor authentication");
  await otp(page);
  state.invalidPassword = true;
  await password(page);
  await expect(
    page.getByRole("dialog", { name: "Confirm access" }),
  ).toBeVisible();
  expect(state.disableWrites).toBe(2);
  state.invalidPassword = false;
  await password(page);
  await expect(mfaSection(page)).toContainText(
    "Two-factor authentication disabled and confirmed.",
  );
  expect(state.disableWrites).toBe(3);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Set up authenticator", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("regenerates only after confirmation, audits downloads and discards codes on navigation", async ({
  page,
}) => {
  const { state, errors } = await setup(page, true);
  state.requireProofs = true;
  await page.goto("/workspace/settings?section=account");
  await confirm(page, "Generate new recovery codes");
  await otp(page);
  await password(page);
  const section = mfaSection(page);
  await expect(section).toContainText(security.replacement.recovery_codes[0]);
  expect(state.batches).toBe(3);
  const downloading = page.waitForEvent("download");
  await section.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("lcsp-recovery-codes.txt");
  expect(state.audits).toBe(1);
  await page.reload();
  await expect(section).not.toContainText(
    security.replacement.recovery_codes[0],
  );
  expect(errors).toEqual([]);
});

test("ambiguous recovery write is never retried and requires refresh", async ({
  page,
}) => {
  const { state } = await setup(page, true);
  state.ambiguousBatch = true;
  await page.goto("/workspace/settings?section=account");
  await confirm(page, "Generate new recovery codes");
  await expect(mfaSection(page).getByRole("alert")).toContainText(
    "Could not confirm the result",
  );
  await expect(
    page.getByRole("button", {
      name: "Generate new recovery codes",
      exact: true,
    }),
  ).toBeDisabled();
  expect(state.batches).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Generate new recovery codes",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.batches).toBe(1);
});

test("malformed successful recovery batches never expose partial codes or allow an immediate replacement", async ({
  page,
}) => {
  const { state } = await setup(page, true);
  state.malformedCodes = true;
  await page.goto("/workspace/settings?section=account");
  await confirm(page, "Generate new recovery codes");
  await expect(mfaSection(page).getByRole("alert")).toContainText(
    "Could not confirm the result",
  );
  await expect(mfaSection(page)).not.toContainText(
    security.replacement.recovery_codes[0],
  );
  await expect(
    page.getByRole("button", {
      name: "Generate new recovery codes",
      exact: true,
    }),
  ).toBeDisabled();
  expect(state.batches).toBe(1);
});

test("disable acknowledgement without a confirmation read never reports success", async ({
  page,
}) => {
  const { state } = await setup(page, true);
  state.failAfterWrite = true;
  await page.goto("/workspace/settings?section=account");
  await confirm(page, "Disable two-factor authentication");
  await expect(mfaSection(page).getByRole("alert")).toContainText(
    "Could not confirm the result",
  );
  await expect(mfaSection(page).getByRole("status")).toHaveCount(0);
  expect(state.disableWrites).toBe(1);
  state.failRead = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Set up authenticator", exact: true }),
  ).toBeEnabled();
  expect(state.disableWrites).toBe(1);
});

test("clearing a recovery address is confirmed as null while keeping a supported account policy", async ({
  page,
}) => {
  const { state } = await setup(page);
  state.profile.recovery_email = security.email;
  await page.goto("/workspace/settings?section=account");
  await emailSection(page)
    .getByLabel("Recovery email", { exact: true })
    .fill("");
  await emailSection(page)
    .getByRole("button", { name: "Save security preferences" })
    .click();
  await expect(emailSection(page).getByRole("status")).toHaveText(
    "Security preferences saved and confirmed.",
  );
  expect(state.profile.recovery_email).toBeNull();
  await page.reload();
  await expect(
    emailSection(page).getByLabel("Recovery email", { exact: true }),
  ).toHaveValue("");
});

test("policy-only mismatches never report a confirmed save", async ({
  page,
}) => {
  const { state } = await setup(page);
  state.profile.recovery_email = security.email;
  state.ignoreSave = true;
  await page.goto("/workspace/settings?section=account");
  const section = emailSection(page);
  for (const [label, option] of [
    ["Primary email address policy", "Recovery email"],
    ["Backup recovery email policy", "All verified addresses"],
  ]) {
    await section.getByRole("combobox", { name: label }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await section
      .getByRole("button", { name: "Save security preferences" })
      .click();
    await expect(section.getByRole("alert")).toContainText(
      "Could not confirm the result",
    );
    await expect(section.getByRole("status")).toHaveCount(0);
    await section.getByRole("button", { name: "Reset changes" }).click();
  }
  expect(state.writes).toBe(2);
});

test("copies committed codes only after successful access auditing", async ({
  page,
  context,
}) => {
  const { state } = await setup(page, true);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/workspace/settings?section=account");
  await confirm(page, "Generate new recovery codes");
  await page.route("**/api/auth/mfa/recovery-codes/access", (route) =>
    route.fulfill({ status: 503, json: fixture.failure }),
  );
  await mfaSection(page)
    .getByRole("button", { name: "Copy", exact: true })
    .click();
  await expect(mfaSection(page).getByRole("alert")).toContainText(
    "Could not record access or export codes",
  );
  expect(state.audits).toBe(0);
  await page.unroute("**/api/auth/mfa/recovery-codes/access");
  await page.route("**/api/auth/mfa/recovery-codes/access", (route) => {
    state.audits++;
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  await mfaSection(page)
    .getByRole("button", { name: "Copy", exact: true })
    .click();
  await expect(mfaSection(page).getByRole("status")).toHaveText(
    "Recovery codes copied.",
  );
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/),
  ).toEqual(security.replacement.recovery_codes);
  expect(state.audits).toBe(1);
});

test("mobile Settings modal renders security and preserves keyboard access", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
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
  const panel = modal.locator('[data-component="AccountSettingsPanel"]');
  await expect(
    panel.getByRole("heading", {
      name: "Recovery email and email preferences",
    }),
  ).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.getByLabel("Recovery email", { exact: true }).focus();
  await page.keyboard.type(security.email);
  await expect(
    emailSection(page).getByRole("button", {
      name: "Save security preferences",
    }),
  ).toBeEnabled();
  await page.screenshot({
    path: test.info().outputPath("account-security-mobile.png"),
  });
  expect(errors).toEqual([]);
});
