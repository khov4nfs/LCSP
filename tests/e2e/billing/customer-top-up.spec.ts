import { expect, test } from "@playwright/test";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

test.describe("Prepaid billing customer lifecycle", () => {
  test("creates an owner-scoped order and credits its wallet exactly once", async ({
    page,
  }) => {
    await authenticateBillingE2e(page, BILLING_E2E_TOKENS.customer);
    const reset = await page.request.post(
      "http://127.0.0.1:3102/__test__/reset",
      {
        headers: { authorization: `Bearer ${BILLING_E2E_TOKENS.customer}` },
      },
    );
    expect(reset.ok()).toBe(true);
    await page.goto("/workspace/settings?section=billing");

    const balance = page
      .locator('[aria-labelledby="billing-balance-heading"] p')
      .first();
    await expect(balance).toHaveText("0 VND");

    const idempotencyKeys: string[] = [];
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/billing/orders")
      ) {
        const key = requestEvent.headers()["idempotency-key"];
        if (key) idempotencyKeys.push(key);
      }
    });

    await page.locator("#billing-amount-vnd").fill("10000");
    await page.locator('form button[type="submit"]').click();
    await expect(
      page.getByText("LCSP-E2E-1", { exact: true }).first(),
    ).toBeVisible();
    expect(idempotencyKeys).toHaveLength(1);

    const replayBody = await page.evaluate(async (idempotencyKey) => {
      const response = await fetch("/api/billing/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ amount_vnd: "10000" }),
      });
      return response.json();
    }, idempotencyKeys[0]!);
    expect(replayBody.data.id).toBe("billing-order-e2e-1");

    const settlement = await page.request.post(
      "http://127.0.0.1:3102/__test__/settle",
      {
        headers: { authorization: `Bearer ${BILLING_E2E_TOKENS.customer}` },
        data: { orderId: replayBody.data.id },
      },
    );
    expect(settlement.ok()).toBe(true);

    await expect(balance).toHaveText(/10[.,]000 VND/, { timeout: 15_000 });
    await expect(
      page.getByText(/^(Credited|Đã ghi có)$/, { exact: true }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });

    const repeatedSettlement = await page.request.post(
      "http://127.0.0.1:3102/__test__/settle",
      {
        headers: { authorization: `Bearer ${BILLING_E2E_TOKENS.customer}` },
        data: { orderId: replayBody.data.id },
      },
    );
    expect(repeatedSettlement.ok()).toBe(true);
    await page.reload();
    await expect(
      page.locator('[aria-labelledby="billing-balance-heading"] p').first(),
    ).toHaveText(/10[.,]000 VND/);
    await expect(
      page.locator("tbody tr").filter({ hasText: "LCSP-E2E-1" }),
    ).toHaveCount(1);
  });
});
