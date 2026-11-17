import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { enPages, viPages } from "@lcsp/i18n";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/legal-rule-catalog.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const en = enPages.legalRuleCatalog,
  vi = viPages.legalRuleCatalog;
const pagePath = "/admin/compliance-rule-sets";

async function openWorkflow(page: Page, locale = "en") {
  await page.context().addCookies([
    {
      name: "lcsp_session",
      value: `${fixture.adminTokenPrefix}${randomUUID()}`,
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "lcsp_locale",
      value: locale,
      url: "http://127.0.0.1:3100",
      sameSite: "Lax",
    },
  ]);
  await page.goto(pagePath);
  await expect(
    page.getByRole("heading", {
      name: locale === "vi" ? vi.title : en.title,
      exact: true,
    }),
  ).toBeVisible();
}

async function chooseCatalog(page: Page, locale = "en") {
  await page
    .getByRole("combobox", {
      name: locale === "vi" ? vi.catalog : en.catalog,
      exact: true,
    })
    .click();
  await page
    .getByRole("option", {
      name: `${fixture.catalog.version} · 1`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: `${fixture.rules[0].legalRuleId} · ${fixture.rules[0].title}`,
      exact: true,
    }),
  ).toBeVisible();
}

test("cross-page explicit selection, changed filters and server Select all retain exact scope with no implicit preparation", async ({
  page,
}) => {
  const submissions: unknown[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname ===
        "/api/admin/legal-rule-catalog/preparations"
    )
      submissions.push(request.postDataJSON());
  });
  await openWorkflow(page);
  await chooseCatalog(page);
  await expect(page.getByTestId("legal-rule-selected-count")).toHaveText("0");
  await expect(
    page.getByRole("button", { name: en.prepare, exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: `${fixture.rules[0].legalRuleId} · ${fixture.rules[0].title}`,
      exact: true,
    })
    .check();
  await page
    .getByTestId("rule-set-preparation-entry-point")
    .getByRole("button", { name: en.next, exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: `${fixture.rules[50].legalRuleId} · ${fixture.rules[50].title}`,
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("checkbox", {
      name: `${fixture.rules[51].legalRuleId} · ${fixture.rules[51].title}`,
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByTestId("legal-rule-selected-count")).toHaveText("2");
  await page.getByLabel(en.search, { exact: true }).fill("LR001");
  await expect(
    page.getByRole("checkbox", {
      name: `${fixture.rules[0].legalRuleId} · ${fixture.rules[0].title}`,
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.getByTestId("legal-rule-selected-count")).toHaveText("2");
  await page.getByRole("button", { name: en.clear, exact: true }).click();
  await page.getByLabel(en.search, { exact: true }).fill("");
  const selected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/api/admin/legal-rule-catalog/selections" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: en.selectAll, exact: true }).click();
  expect((await (await selected).json()).data.selectedCount).toBe(51);
  await expect(page.getByTestId("legal-rule-selected-count")).toHaveText("51");
  expect(submissions).toHaveLength(0);
  await page.getByRole("button", { name: en.prepare, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`${en.confirmCount}: 51`);
  await dialog.getByText(en.confirmScope, { exact: true }).click();
  await expect(dialog).toContainText("ALL_MATCHING");
  await dialog.getByRole("button", { name: en.cancel, exact: true }).click();
  expect(submissions).toHaveLength(0);
});

test("bulk build shows partial results, retries only failure, and regenerates one rule with inspectable comparison", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openWorkflow(page);
  await chooseCatalog(page);
  await page.getByRole("button", { name: en.selectAll, exact: true }).click();
  await page.getByRole("button", { name: en.prepare, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: en.confirm, exact: true })
    .click();
  const batch = page.getByRole("region", { name: en.batch, exact: true });
  await expect(batch).toContainText(en.complete);
  await expect(
    batch.getByText(en.failedCount, { exact: true }).locator(".."),
  ).toContainText("1");
  const retryResponse = page.waitForResponse((response) =>
    /\/api\/admin\/legal-rule-catalog\/preparations\/[^/]+\/retries$/.test(
      new URL(response.url()).pathname,
    ),
  );
  await batch
    .getByRole("button", { name: en.retryFailed, exact: true })
    .click();
  const retried = (await (await retryResponse).json()).data;
  expect(retried.skipped).toBe(50);
  expect(retried.prepared).toBe(51);
  await expect(page).toHaveURL(new RegExp(`preparationBatchId=${retried.id}`));
  await page.reload();
  await expect(
    batch.getByText(en.preparedCount, { exact: true }).locator(".."),
  ).toContainText("51");
  const activityResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `/api/admin/compliance-rule-sets/preparations/${retried.items[0].preparationRunId}/activity`,
  );
  const first = batch.getByRole("listitem").filter({ hasText: "LR001" });
  await first.getByRole("button", { name: en.viewResult, exact: true }).click();
  expect((await activityResponse).status()).toBe(200);
  await page
    .getByRole("dialog")
    .getByText(en.activity, { exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
  await expect(
    page
      .getByRole("dialog")
      .getByText(fixture.output1.analysis, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: en.regenerate, exact: true })
    .click();
  const regenerateResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(
      `/rules/${fixture.rules[0].id}/regenerate`,
    ),
  );
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: en.regenerate, exact: true })
    .click();
  const regenerated = await regenerateResponse;
  expect(regenerated.request().postDataJSON().useLatestInputs).toBe(false);
  expect((await regenerated.json()).data.selected).toBe(1);
  await expect(
    page
      .getByRole("dialog")
      .getByText(fixture.output2.analysis, { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: en.compare, exact: true }).click();
  await page
    .getByRole("option", { name: `${en.revision} 1`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(fixture.output1.analysis, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(fixture.instruction1.fingerprint, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(fixture.instruction2.fingerprint, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .getByText(fixture.sourceId ?? fixture.catalog.legalSourceVersionId, {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("stale confirmation fails visibly, retains selection and dispatches nothing", async ({
  page,
}) => {
  await openWorkflow(page);
  await chooseCatalog(page);
  await page
    .getByRole("checkbox", {
      name: `${fixture.rules[0].legalRuleId} · ${fixture.rules[0].title}`,
      exact: true,
    })
    .check();
  let submissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/preparations")
    )
      submissions++;
  });
  await page.route("**/api/admin/legal-rule-catalog/selections", (route) =>
    route.fulfill({ status: 409, json: fixture.problemStale }),
  );
  await page.getByRole("button", { name: en.prepare, exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: en.error }),
  ).toBeVisible();
  await expect(page.getByTestId("legal-rule-selected-count")).toHaveText("1");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(submissions).toBe(0);
});

test("catalog authoring feeds the same build workflow without a separate test-only surface", async ({
  page,
}) => {
  await openWorkflow(page);
  await page
    .getByRole("button", { name: en.createCatalog, exact: true })
    .click();
  await page
    .getByLabel(en.version, { exact: true })
    .fill(fixture.authoring.version);
  await page
    .getByLabel(en.sourceId, { exact: true })
    .fill(fixture.catalog.legalSourceVersionId);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: en.create, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: en.addRule, exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: en.addRule, exact: true }).click();
  await page
    .getByLabel(en.ruleId, { exact: true })
    .fill(fixture.authoring.legalRuleId);
  await page
    .getByLabel(en.ruleTitle, { exact: true })
    .fill(fixture.authoring.title);
  await page
    .getByLabel(en.ruleDescription, { exact: true })
    .fill(fixture.authoring.description);
  await page
    .getByLabel(en.citations, { exact: true })
    .fill(fixture.authoring.citationText);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: en.save, exact: true })
    .click();
  const checkbox = page.getByRole("checkbox", {
    name: `${fixture.authoring.legalRuleId} · ${fixture.authoring.title}`,
    exact: true,
  });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: en.prepare, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(`${en.confirmCount}: 1`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: en.confirm, exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: en.batch, exact: true }),
  ).toContainText(fixture.authoring.title);
});

test("Vietnamese controls remain keyboard-accessible at mobile width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkflow(page, "vi");
  await chooseCatalog(page, "vi");
  const checkbox = page.getByRole("checkbox", {
    name: `${fixture.rules[0].legalRuleId} · ${fixture.rules[0].title}`,
    exact: true,
  });
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(page.getByTestId("legal-rule-selected-count")).toHaveText("1");
  await expect(
    page.getByRole("button", { name: vi.prepare, exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
