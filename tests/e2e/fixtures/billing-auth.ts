import type { Page } from "@playwright/test";

export const BILLING_E2E_TOKENS = {
  admin: "billing-e2e-admin",
  adminError: "billing-e2e-admin-error",
  customer: "billing-e2e-customer",
} as const;

export async function authenticateBillingE2e(
  page: Page,
  token: (typeof BILLING_E2E_TOKENS)[keyof typeof BILLING_E2E_TOKENS],
) {
  await page.context().addCookies([
    {
      name: "lcsp_session",
      value: token,
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "lcsp_locale",
      value: "en",
      url: "http://127.0.0.1:3100",
      sameSite: "Lax",
    },
  ]);
}
