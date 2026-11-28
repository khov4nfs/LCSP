import { expect, test, type Page } from "@playwright/test";
import { MODEL_PRICING_SCOPES } from "@lcsp/contracts/billing";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const consoleErrors = new WeakMap<Page, string[]>();
const pageErrors = new WeakMap<Page, string[]>();
const mutatingPricingRequests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const cErrors: string[] = [];
  const pErrors: string[] = [];
  const mRequests: string[] = [];
  consoleErrors.set(page, cErrors);
  pageErrors.set(page, pErrors);
  mutatingPricingRequests.set(page, mRequests);

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      cErrors.push(msg.text());
    }
  });
  page.on("pageerror", (error) => {
    pErrors.push(error.message);
  });
  page.on("request", (request) => {
    if (
      request.url().includes("/api/admin/billing/model-pricing") &&
      request.method() !== "GET"
    ) {
      mRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  // Hide Next.js dev overlay portal so pointer/reflow assertions match production.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
  expect(mutatingPricingRequests.get(page)).toEqual([]);
});

test.describe("Admin Model Pricing read-only workbench (WP8 Phase B2)", () => {
  test("ADMIN desktop loads /admin/pricing via sidebar with precedence, posture, dialog, filters, and zero mutations", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);

    await page.goto("/admin/billing");
    const pricingResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/admin/billing/model-pricing") &&
        res.request().method() === "GET",
    );

    const sidebarLink = page.locator('nav a[href="/admin/pricing"]');
    await expect(sidebarLink).toBeVisible();
    await sidebarLink.click();

    await expect(page).toHaveURL(/\/admin\/pricing$/);
    await expect(sidebarLink).toHaveAttribute("aria-current", "page");

    const pricingResponse = await pricingResponsePromise;
    expect(pricingResponse.status()).toBe(200);

    const pricingPage = page.getByTestId("admin-pricing-page");
    await expect(pricingPage).toBeVisible();

    // Posture banner: MODEL_USAGE_DEBIT=OFF + Read-only notice + DB UTC clock
    const debitBadge = page.getByTestId("pricing-debit-mode-badge");
    await expect(debitBadge).toContainText("MODEL_USAGE_DEBIT=OFF");
    await expect(pricingPage).toContainText("Read-only");
    await expect(page.getByTestId("pricing-db-utc-now")).toContainText(
      "2026-11-26T00:00:00.000Z",
    );

    // Coverage precedence table: EXACT_MODEL -> PROVIDER_DEFAULT -> GLOBAL_DEFAULT -> Coverage gap
    const coverageTable = page.getByTestId("admin-pricing-coverage-table");
    await expect(coverageTable).toBeVisible();
    const coverageRows = coverageTable.locator("tbody tr");
    await expect(coverageRows).toHaveCount(4);
    await expect(coverageRows.nth(0)).toContainText("Exact model");
    await expect(coverageRows.nth(0)).toContainText("claude-sonnet-4-6");
    await expect(coverageRows.nth(1)).toContainText("Provider default");
    await expect(coverageRows.nth(1)).toContainText("claude-opus-4-1");
    await expect(coverageRows.nth(2)).toContainText("Global default");
    await expect(coverageRows.nth(2)).toContainText("claude-haiku-4-5");
    await expect(coverageRows.nth(3)).toContainText("Coverage gap");
    await expect(coverageRows.nth(3)).toContainText("gpt-4o-mini");

    // Versioned assignments (ACTIVE, SCHEDULED, SUPERSEDED)
    const assignmentsTable = page.getByTestId(
      "admin-pricing-assignments-table",
    );
    await expect(assignmentsTable).toBeVisible();
    await expect(assignmentsTable).toContainText("Active");
    await expect(assignmentsTable).toContainText("Scheduled");
    await expect(assignmentsTable).toContainText("Superseded");

    // Drafts (non-authoritative) & immutable snapshots & allowlist
    const draftsTable = page.getByTestId("admin-pricing-drafts-table");
    await expect(draftsTable).toBeVisible();
    await expect(draftsTable).toContainText("Non-authoritative");
    const snapshotsTable = page.getByTestId("admin-pricing-snapshots-table");
    await expect(snapshotsTable).toBeVisible();
    await expect(snapshotsTable).toContainText("Immutable");
    await expect(
      page.getByTestId("admin-pricing-allowlist-table"),
    ).toBeVisible();

    // Strictly read-only: zero mutation buttons inside the pricing page
    const controlLabels = await pricingPage
      .locator("button, a")
      .allTextContents();
    for (const label of controlLabels) {
      expect(label.trim()).not.toMatch(
        /^(create|new tariff|edit|publish|supersede|delete|save|remove)$/i,
      );
    }

    // Inspect Draft Dialog (operationalAssumptions + copy ID announcement + Escape)
    await draftsTable
      .locator('button[data-pricing-inspect="DRAFT"]')
      .first()
      .click();
    const draftDialog = page.getByRole("dialog");
    await expect(draftDialog).toBeVisible();
    await expect(draftDialog).toContainText("Non-authoritative");
    await expect(draftDialog).toContainText(
      "Anthropic / OpenAI Official Reference Sheet",
    );
    await draftDialog.getByRole("button", { name: "Copy ID" }).click();
    await expect(pricingPage.locator('[aria-live="polite"]')).toContainText(
      "draft_pricing_openai_mini",
    );
    await page.keyboard.press("Escape");
    await expect(draftDialog).toHaveCount(0);

    // Inspect Immutable Snapshot Dialog + Escape
    await snapshotsTable
      .locator('button[data-pricing-inspect="SNAPSHOT"]')
      .first()
      .click();
    const snapshotDialog = page.getByRole("dialog");
    await expect(snapshotDialog).toBeVisible();
    await expect(snapshotDialog).toContainText("pub-claude-sonnet-4-6-v3");
    await page.keyboard.press("Escape");
    await expect(snapshotDialog).toHaveCount(0);

    // Filter to scope=PROVIDER_DEFAULT + Apply -> 200 & scoped row
    const filterForm = page.getByTestId("admin-pricing-filters-form");
    const scopedFilterResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/admin/billing/model-pricing") &&
        res.url().includes(`scope=${MODEL_PRICING_SCOPES.providerDefault}`),
    );
    await filterForm
      .getByLabel("Scope")
      .selectOption(MODEL_PRICING_SCOPES.providerDefault);
    await filterForm.getByRole("button", { name: "Apply filters" }).click();
    expect((await scopedFilterResponse).status()).toBe(200);
    await expect(coverageRows).toHaveCount(1);
    await expect(coverageRows.nth(0)).toContainText("claude-opus-4-1");

    // Filter to nonexistent provider -> filter-empty + Reset filters
    await filterForm.getByLabel("Provider").fill("nonexistent-provider");
    await filterForm.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      page.getByTestId("admin-pricing-coverage-filter-empty"),
    ).toBeVisible();
    await page
      .getByTestId("admin-pricing-coverage-filter-empty")
      .getByRole("button", { name: "Reset filters" })
      .click();
    await expect(coverageRows).toHaveCount(4);

    // Zero horizontal document overflow and MAIN-only scroll surface
    const layoutMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      scrollSurfaces: [...document.querySelectorAll("[data-admin-shell] *")]
        .filter((element) => {
          const el = element as HTMLElement;
          return (
            /auto|scroll/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight
          );
        })
        .map((element) => element.tagName),
    }));
    expect(layoutMetrics.scrollWidth).toBeLessThanOrEqual(
      layoutMetrics.innerWidth,
    );
    expect(layoutMetrics.scrollSurfaces).toEqual(["MAIN"]);
    expect(consoleErrors.get(page)).toEqual([]);
  });

  test("ADMIN mobile (390x844) and narrow 320px reflow keep zero horizontal page overflow and focusable table regions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);

    await page.goto("/admin/pricing");
    await expect(page.getByTestId("admin-pricing-page")).toBeVisible();
    await expect(
      page.getByTestId("admin-pricing-coverage-table"),
    ).toBeVisible();

    const mobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(mobileOverflow.scrollWidth).toBeLessThanOrEqual(
      mobileOverflow.innerWidth,
    );

    const scrollRegions = page.locator(
      '[data-testid="admin-pricing-page"] [role="region"][tabindex="0"]',
    );
    expect(await scrollRegions.count()).toBeGreaterThanOrEqual(5);

    await page.setViewportSize({ width: 320, height: 640 });
    const reflowOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(reflowOverflow.scrollWidth).toBeLessThanOrEqual(
      reflowOverflow.innerWidth,
    );
    expect(consoleErrors.get(page)).toEqual([]);
  });

  test("CUSTOMER redirects to /workspace and adminError renders 503 alert with zero fabricated pricing data", async ({
    page,
  }) => {
    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
    await page.goto("/admin/pricing");
    await expect(page).toHaveURL(/\/workspace$/);

    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.adminError);
    await page.goto("/admin/pricing");

    const errorAlert = page.getByTestId("admin-pricing-error");
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toHaveAttribute("role", "alert");
    await expect(errorAlert.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText(/3,000,000/)).toHaveCount(0);
    await expect(page.getByText("claude-sonnet-4-6")).toHaveCount(0);
  });
});
