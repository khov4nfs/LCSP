import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const operationalData = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/admin-tracking-untrusted.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

for (const { locale, heading, reason, investigationUnavailable } of [
  {
    locale: "en",
    heading: "Results needing investigation",
    reason: "The assessment has no pinned compliance rule set version.",
    investigationUnavailable:
      "Investigation details are not available in this view.",
  },
  {
    locale: "vi",
    heading: "Kết quả cần kiểm tra",
    reason: "Assessment chưa có phiên bản bộ quy tắc tuân thủ được cố định.",
    investigationUnavailable: "Chưa thể mở chi tiết điều tra từ trang này.",
  },
] as const) {
  test(`admin tracking explains unavailable rule sets in ${locale}`, async ({
    page,
  }) => {
    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
    await page.context().addCookies([
      {
        name: "lcsp_locale",
        value: locale,
        url: "http://127.0.0.1:3100",
        sameSite: "Lax",
      },
    ]);
    await page.route("**/api/admin/tracking/operational", (route) =>
      route.fulfill({ json: { ok: true, data: operationalData } }),
    );

    await page.goto("/admin/tracking");

    await expect(page.getByText(heading, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      investigationUnavailable,
    );
    await expect(
      page.getByRole("link", { name: /Open investigation|Mở điều tra/ }),
    ).toHaveCount(0);
    await expect(page.locator("[id^='investigation-']")).toHaveCount(0);
    await expect(page.getByText("RULE_SET_UNAVAILABLE")).toHaveCount(0);
    await expect(
      page.getByText(operationalData.untrustedProjections[0].detail, {
        exact: true,
      }),
    ).toHaveCount(0);
  });
}
