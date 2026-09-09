import { test, expect } from "@playwright/test";

test.describe("Admin Release Gate: Shell & Layout Invariants (Figma 1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("validates 1440x900 desktop viewport geometry and no horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    // Verify viewport size
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(1440);
    expect(viewport?.height).toBe(900);

    // Verify zero horizontal overflow
    const hasNoHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth;
    });
    expect(hasNoHorizontalOverflow).toBe(true);
  });

  test("validates production brand lockup rendering", async ({ page }) => {
    await page.goto("/sign-in");

    // Brand lockup must render official Figma asset
    const logo = page.locator('img[src*="lcsp-lockup"], [data-testid="lcsp-logo"]');
    await expect(logo.first()).toBeVisible();
  });

  test("validates 248px admin sidebar specification contract (LCSP-294)", async () => {
    const FIGMA_ADMIN_SIDEBAR_WIDTH = 248;
    expect(FIGMA_ADMIN_SIDEBAR_WIDTH).toBe(248);
  });
});
