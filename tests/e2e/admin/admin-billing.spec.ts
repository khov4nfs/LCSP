import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

test.describe("Admin Billing & Revenue release gate", () => {
  test("shows account-backed domain metrics, filters, pagination, and Figma 1320:2 viewport", async ({
    page,
  }) => {
    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
    await page.setViewportSize({ width: 1626, height: 1017 });
    await page.goto("/admin/billing");

    await expect(page).toHaveURL(/\/admin\/billing$/);
    await expect(
      page.locator('[data-testid="admin-billing-page"]'),
    ).toBeVisible();
    await expect(page.locator('a[href="/admin/billing"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("admin@example.com")).toBeVisible();
    await expect(
      page.getByText("Administrator", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("₫124,500,000")).toBeVisible();
    await expect(page.getByText("₫96,800,000")).toBeVisible();
    await expect(page.getByText("3 events")).toBeVisible();
    await expect(page.getByText("12 events")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Settled top-up trend" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Usage pricing policy" }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText([
      "Order",
      "Customer account",
      "Amount",
      "Credits",
      "Gateway",
      "Webhook",
      "Status",
      "Action",
    ]);
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await expect(page.getByText("min@example.com").first()).toBeVisible();
    await expect(page.getByText("LCSP260917K2M4").first()).toBeVisible();
    await expect(page.getByText("LCSP260914R8N6V").first()).toBeVisible();
    await page.getByRole("button", { name: "View" }).first().click();
    const paymentDialog = page.getByRole("dialog");
    await expect(paymentDialog).toContainText("LCSP260917K2M4");
    await expect(paymentDialog).not.toContainText(
      /rawBody|signature|webhookSecret|sanitizedPayload/i,
    );
    await page.getByRole("button", { name: "Close" }).click();

    await page
      .getByLabel("Filter payments by gateway")
      .selectOption(BILLING_ADMIN_GATEWAYS.sepay);
    await expect(page.getByText("LCSP260917K2M4").first()).toBeVisible();
    await page
      .getByLabel("Filter payments by gateway")
      .selectOption(BILLING_ADMIN_GATEWAYS.all);

    await page
      .locator("select")
      .nth(1)
      .selectOption(BILLING_ADMIN_PAYMENT_FILTERS.unmatched);
    await expect(page.getByText("LCSP260919P7X3D").first()).toBeVisible();
    await expect(page.getByText("LCSP260917K2M4")).toHaveCount(0);

    await page
      .locator("select")
      .nth(1)
      .selectOption(PAYMENT_RECONCILIATION_STATUSES.REJECTED);
    await expect(page.getByTestId("admin-billing-empty")).toBeVisible();
    await page
      .locator("select")
      .first()
      .selectOption(BILLING_ADMIN_PERIODS.d90);

    await page
      .locator("select")
      .nth(1)
      .selectOption(BILLING_ADMIN_PAYMENT_FILTERS.all);
    await expect(page.getByText(/(?:page 1 of 7|trang 1 \/ 7)/i)).toBeVisible();
    const pagination = page.getByTestId("admin-billing-pagination");
    await pagination.locator("button").last().click();
    await expect(page.getByText(/(?:page 2 of 7|trang 2 \/ 7)/i)).toBeVisible();
    await expect(page.getByText("LCSP-E2E-04").first()).toBeVisible();

    await page
      .locator("select")
      .nth(1)
      .selectOption(BILLING_ADMIN_PAYMENT_FILTERS.all);
    await page
      .locator("select")
      .first()
      .selectOption(BILLING_ADMIN_PERIODS.mtd);
    await page
      .getByLabel("Filter payments by gateway")
      .selectOption(BILLING_ADMIN_GATEWAYS.sepay);
    await expect(page.locator('[data-figma-node="1320:2"]')).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export report" }).click();
    const reportDownload = await downloadPromise;
    expect(reportDownload.suggestedFilename()).toMatch(
      /billing-report-mtd\.csv/,
    );
    const reportPath = await reportDownload.path();
    expect(reportPath).not.toBeNull();
    if (!reportPath) throw new Error("Billing export did not produce a file");
    const reportCsv = await readFile(reportPath, "utf8");
    expect(reportCsv).toContain("LCSP-E2E-21");
    await expect(
      page.getByText(/Billing is scoped to the customer account/),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("nextjs-portal").evaluateAll((nodes) => {
      nodes.forEach((node) => node.remove());
    });
    await expect(page).toHaveScreenshot("admin-billing-node-1320-2.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.05,
    });
  });

  test("denies customer routes and shows no fabricated metrics when the report API fails", async ({
    page,
  }) => {
    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
    await page.goto("/admin/billing");
    await expect(page).toHaveURL(/\/workspace$/);

    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.adminError);
    await page.goto("/admin/billing");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(/124,500,000/)).toHaveCount(0);
    await expect(page.getByText(/96,800,000/)).toHaveCount(0);
    await expect(page.getByText("LCSP260917K2M4")).toHaveCount(0);
  });
});
