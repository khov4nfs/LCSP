import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  authenticateBillingE2e,
  BILLING_E2E_TOKENS,
} from "../fixtures/billing-auth.js";

const { profile } = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/admin-shell.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test.use({ viewport: { width: 1440, height: 900 } });

const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // Next's development badge covers the pinned account trigger; it is absent in production.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
  });
  await authenticateBillingE2e(page, BILLING_E2E_TOKENS.admin);
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({ json: { ok: true, data: profile } }),
  );
  // No UI action in this suite may start/retry preparation, even through an unexpected regression.
  await page.route("**/api/admin/compliance-rule-sets/**", (route) => {
    if (route.request().method() === "POST")
      throw new Error("Preparation is forbidden in shell verification");
    return route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
});

async function identity(page: Page) {
  const trigger = page.locator("[data-admin-account-trigger]");
  await expect(trigger).toHaveCount(1);
  await expect(trigger.locator("[data-admin-account-name]")).toHaveText(
    profile.display_name,
  );
  await expect(trigger.locator("[data-admin-account-email]")).toHaveText(
    profile.email,
  );
  await expect(trigger.locator('[data-slot="avatar-fallback"]')).toHaveText(
    "P",
  );
  return trigger;
}

for (const path of [
  "/admin/billing",
  "/admin/compliance-rule-sets",
  "/admin/users",
]) {
  test(`${path}: main owns long-content scrolling, sidebar and account stay in the viewport`, async ({
    page,
  }) => {
    await page.goto(path);
    const trigger = await identity(page);
    const main = page.locator("[data-admin-content]");
    // A clean installation has short lists: stress shared layout without creating domain data.
    await main.evaluate((main) => {
      const probe = document.createElement("div");
      probe.dataset.scrollProbe = "true";
      probe.style.height = "2000px";
      main.firstElementChild!.append(probe);
    });
    const sidebar = page.getByRole("complementary", {
      name: "Admin navigation",
    });
    const nav = page.getByRole("navigation", { name: "Admin sections" });
    const logo = sidebar.locator("img").first();
    const before = await Promise.all([
      sidebar.boundingBox(),
      nav.boundingBox(),
      logo.boundingBox(),
      trigger.boundingBox(),
    ]);
    await main.hover();
    await page.mouse.wheel(0, 3000);
    await expect
      .poll(() => main.evaluate((main) => main.scrollTop))
      .toBeGreaterThan(0);
    const after = await Promise.all([
      sidebar.boundingBox(),
      nav.boundingBox(),
      logo.boundingBox(),
      trigger.boundingBox(),
    ]);
    expect(after).toEqual(before);
    expect(before[0]?.height).toBe(900);
    expect(before[3]!.y + before[3]!.height).toBe(888);
    expect(
      await page.evaluate(() => ({
        scrollY,
        bodyHeight: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
      })),
    ).toEqual({ scrollY: 0, bodyHeight: 900, width: 1440, viewport: 1440 });
    const scrollSurfaces = await page.evaluate(() =>
      [...document.querySelectorAll("[data-admin-shell] *")]
        .filter((element) => {
          const el = element as HTMLElement;
          return (
            /auto|scroll/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight
          );
        })
        .map((element) => element.tagName),
    );
    expect(scrollSurfaces).toEqual(["MAIN"]);
    await page.screenshot({
      path: test.info().outputPath(`${path.split("/").pop()}-scrolled.png`),
    });
  });
}

test("route transitions keep a single identity and identically positioned upward account popover", async ({
  page,
}) => {
  await page.goto("/admin");
  let placement: unknown;
  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/billing",
    "/admin/compliance-rule-sets",
  ]) {
    if (path !== "/admin") await page.locator(`nav a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    const trigger = await identity(page);
    await trigger.click();
    const popup = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(popup).toBeVisible();
    await expect(popup.locator("[data-admin-account-name]")).toHaveText(
      profile.display_name,
    );
    await expect(popup.locator("[data-admin-account-email]")).toHaveText(
      profile.email,
    );
    await expect(popup.locator('[data-slot="avatar-fallback"]')).toHaveText(
      "P",
    );
    for (const action of ["Language", "Theme", "Sign out"])
      await expect(popup).toContainText(action);
    await expect(popup).toHaveAttribute("data-side", "top");
    await popup.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    const box = await popup.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      (await trigger.boundingBox())!.y,
    );
    if (placement) expect(box).toEqual(placement);
    placement = box;
    const name = trigger.locator("[data-admin-account-name]");
    expect(
      await name.evaluate((name) => ({
        fullText: name.textContent,
        overflow: name.scrollWidth > name.clientWidth,
        ellipsis: getComputedStyle(name).textOverflow,
      })),
    ).toEqual({
      fullText: profile.display_name,
      overflow: true,
      ellipsis: "ellipsis",
    });
    await page.screenshot({
      path: test
        .info()
        .outputPath(`${path.split("/").pop() || "overview"}-account.png`),
    });
    await page.keyboard.press("Escape");
  }
});

test("mobile uses one drawer account menu, closes on navigation and restores the desktop shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/compliance-rule-sets");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle Admin navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Admin navigation" });
  await expect(drawer).toBeVisible();
  const trigger = await identity(page);
  await trigger.click();
  const popup = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.keyboard.press("Escape");
  await drawer.locator('a[href="/admin/billing"]').click();
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/billing$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: test.info().outputPath("admin-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await identity(page);
  await expect(page.getByRole("complementary")).toHaveCount(1);
});

test("short desktop viewport scrolls sidebar navigation only as needed without covering account", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 400 });
  await page.goto("/admin/billing");
  const trigger = await identity(page);
  const before = await trigger.boundingBox();
  const sidebar = page.getByRole("complementary");
  await sidebar
    .locator(":scope > div")
    .first()
    .evaluate((nav) => {
      nav.scrollTop = nav.scrollHeight;
    });
  expect(await trigger.boundingBox()).toEqual(before);
  expect(before!.y + before!.height).toBe(388);
  await trigger.click();
  const box = await page
    .locator('[data-slot="dropdown-menu-content"]')
    .boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(400);
});
