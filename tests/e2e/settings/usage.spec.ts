import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { MODEL_ATTEMPT_STATUSES } from "@lcsp/contracts/billing";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const report = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/customer-usage.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const authFixture = JSON.parse(
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
    fail: false,
    forbidden: false,
    expire: false,
    requests: [] as URLSearchParams[],
    hold: null as Promise<void> | null,
  };
  await page.route("**/api/billing/usage?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    state.requests.push(params);
    if (state.hold) await state.hold;
    if (state.fail || state.forbidden || state.expire) {
      const status = state.expire ? 401 : state.forbidden ? 403 : 503;
      return route.fulfill({
        status,
        json: {
          ...authFixture.failure,
          problem: {
            ...authFixture.failure.problem,
            status,
            code: state.expire
              ? AUTH_ERROR_CODES.sessionInvalid
              : state.forbidden
                ? AUTH_ERROR_CODES.rbacDenied
                : authFixture.failure.problem.code,
          },
        },
      });
    }
    const data = structuredClone(report);
    data.from = params.get("from");
    data.to = params.get("to");
    data.page = Number(params.get("page"));
    data.pageSize = Number(params.get("pageSize"));
    data.totalCount = 26;
    data.summary.calls = 26;
    data.items =
      data.page === 1
        ? data.items
        : [{ ...data.items[1], id: "second-page-receipt" }];
    if (params.get("model") === "missing") {
      data.items = [];
      data.totalCount = 0;
      data.summary.calls = 0;
      data.breakdowns = [];
    }
    return route.fulfill({ json: { ok: true, data } });
  });
  return state;
}

test("Usage shows precise tokens and partial costs, paginates and resets pages when filtering", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await setup(page);
  await page.goto("/workspace/settings?section=usage");
  const panel = page.locator('[data-component="CustomerUsageSettingsPanel"]');
  const sellingPrice = panel.locator(
    '[data-component="CustomerUsageSellingPrice"]',
  );
  await expect(
    sellingPrice.getByText("LCSP selling estimate (USD)"),
  ).toBeVisible();
  await expect(sellingPrice.getByText("0.0018", { exact: true })).toBeVisible();
  await expect(sellingPrice.getByText(/Reference cost × 1.8/)).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "AI token usage" }),
  ).toBeVisible();
  await expect(
    panel.getByText("9,007,199,254,740,993", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    panel.getByText("Partial estimate", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    panel.locator("dd").getByText("Unknown", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("customer-usage-desktop.png"),
  });
  await panel.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(panel.getByText("Page 2 of 2 · 26 calls")).toBeVisible();
  expect(state.requests.at(-1)!.get("page")).toBe("2");
  await panel
    .getByRole("combobox", { name: "Call status", exact: true })
    .click();
  await page.getByRole("option", { name: "Failed", exact: true }).click();
  await panel
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(panel.getByText("Page 1 of 2 · 26 calls")).toBeVisible();
  expect(state.requests.at(-1)!.get("page")).toBe("1");
  expect(state.requests.at(-1)!.get("attemptStatus")).toBe(
    MODEL_ATTEMPT_STATUSES.FAILED,
  );
  await panel
    .getByRole("combobox", { name: "Call status", exact: true })
    .click();
  await page.getByRole("option", { name: "All statuses", exact: true }).click();
  await panel
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    panel
      .getByRole("combobox", { name: "Call status", exact: true })
      .locator('[data-slot="select-value"]'),
  ).toHaveText("All statuses");
  await panel
    .getByRole("combobox", { name: "Usage breakdown", exact: true })
    .click();
  await page.getByRole("option", { name: "Provider", exact: true }).click();
  await expect(
    panel.getByRole("rowheader", { name: "provider-a", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "7 days", exact: true }).click();
  await expect
    .poll(() => {
      const params = state.requests.at(-1)!;
      return Date.parse(params.get("to")!) - Date.parse(params.get("from")!);
    })
    .toBe(7 * 86400000 - 1);
  const request = state.requests.at(-1)!;
  expect(request.get("attemptStatus")).toBeNull();
  expect(
    Date.parse(request.get("to")!) - Date.parse(request.get("from")!),
  ).toBe(7 * 86400000 - 1);
  await page.reload();
  await expect(
    panel.getByRole("heading", { name: "AI token usage" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "View wallet in Billing" }).click();
  await expect(page).toHaveURL(/section=billing/);
  expect(errors).toEqual([]);
});

test("loading, failures, retry, refresh and empty results remain distinct", async ({
  page,
}) => {
  const state = await setup(page);
  state.fail = true;
  let release!: () => void;
  state.hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.goto("/workspace/settings?section=usage");
  const panel = page.locator('[data-component="CustomerUsageSettingsPanel"]');
  await expect(panel.getByRole("status")).toHaveText("Loading usage…");
  await expect(
    panel.getByText("No recorded model calls", { exact: false }),
  ).toHaveCount(0);
  release();
  state.hold = null;
  await expect(panel.getByRole("alert")).toContainText("Could not load usage");
  state.fail = false;
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    panel.locator('[data-component="CustomerUsageSummary"]'),
  ).toBeVisible();
  state.fail = true;
  await panel
    .getByRole("button", { name: "Refresh usage", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(
    panel.locator('[data-component="CustomerUsageSummary"]'),
  ).toHaveCount(0);
  state.fail = false;
  await panel.getByLabel("Model", { exact: true }).fill("missing");
  await panel
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText(
    "No recorded model calls match this period and these filters.",
  );
  await expect(
    panel.locator('[data-component="CustomerUsageSummary"]'),
  ).toHaveCount(0);
});

test("invalid custom date range does not replace the applied report", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/workspace/settings?section=usage");
  const panel = page.locator('[data-component="CustomerUsageSettingsPanel"]');
  await expect(
    panel.locator('[data-component="CustomerUsageSummary"]'),
  ).toBeVisible();
  const reads = state.requests.length;
  await panel.getByLabel("From (UTC)", { exact: true }).fill("2020-01-01");
  await panel
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("at most 90 days");
  expect(state.requests).toHaveLength(reads);
});

test("mobile Vietnamese modal scrolls without clipping and opens Billing in the same modal", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page);
  await page
    .context()
    .addCookies([
      { name: "lcsp_locale", value: "vi", url: "http://127.0.0.1:3100" },
    ]);
  await page.goto("/workspace");
  await page
    .getByRole("button", { name: "Ẩn hiện điều hướng workspace", exact: true })
    .click();
  await page
    .locator('[data-component="SidebarAccountTrigger"]')
    .filter({ visible: true })
    .click();
  // Account popover follows the active locale.
  await page
    .locator('[data-component="AccountPopover"]')
    .getByText("Cài đặt", { exact: true })
    .click();
  const modal = page.locator('[data-presentation="modal"]');
  await modal.getByRole("button", { name: "Sử dụng", exact: true }).click();
  const panel = modal.locator('[data-component="CustomerUsageSettingsPanel"]');
  await expect(
    panel.getByRole("heading", { name: "Mức sử dụng token AI" }),
  ).toBeVisible();
  const status = panel.getByRole("combobox", {
    name: "Trạng thái lượt gọi",
    exact: true,
  });
  await status.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page
    .getByRole("option", { name: "Chưa xác định", exact: true })
    .press("Enter");
  await expect(status.locator('[data-slot="select-value"]')).toHaveText(
    "Chưa xác định",
  );
  await panel
    .getByRole("button", { name: "Áp dụng bộ lọc", exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("customer-usage-mobile.png"),
  });
  await panel.getByRole("button", { name: "Trang sau", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("Trang 2/2 · 26 lượt gọi")).toBeVisible();
  const dimensions = await panel.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  const bounds = await panel.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  await panel.getByRole("button", { name: "Xem ví trong Thanh toán" }).click();
  await expect(
    modal.locator('[data-component="BillingSettingsPanel"]'),
  ).toBeVisible();
});

test("forbidden usage is a role error and expired sessions follow shared sign-in routing", async ({
  page,
}) => {
  const state = await setup(page);
  state.forbidden = true;
  await page.goto("/workspace/settings?section=usage");
  const panel = page.locator('[data-component="CustomerUsageSettingsPanel"]');
  await expect(panel.getByRole("alert")).toHaveText(
    "Usage reporting is available to customer accounts only.",
  );
  await expect(
    panel.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  state.forbidden = false;
  state.expire = true;
  await page.reload();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});
