import { expect, test } from "@playwright/test";

test("workspace center pane scrolls when dashboard content exceeds the viewport", async ({
  page,
}) => {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("Playwright baseURL is required");
  await page.context().addCookies([
    {
      name: "lcsp_session",
      value: "billing-e2e-customer",
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace$/);

  const center = page.locator('[data-slot="assessment-center-scroll"]');
  await expect(center).toBeVisible();
  await expect(page.locator('main')).toBeVisible();

  await center.locator("main").evaluate((main) => {
    const content = document.createElement("div");
    content.style.minHeight = "1000px";
    main.append(content);
  });

  await expect
    .poll(() =>
      center.evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await center.hover();
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => center.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
});
