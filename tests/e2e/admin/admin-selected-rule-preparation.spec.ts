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
const preparedActivationPage = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/legal-rule-catalog-prepared-activation.json",
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

function ruleCheckboxName(rule: { legalRuleId: string; title: string }, locale = "en") {
  return `${locale === "vi" ? vi.selectRule : en.selectRule} ${rule.legalRuleId} · ${rule.title}`;
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
      name: ruleCheckboxName(fixture.rules[0], locale),
      exact: true,
    }),
  ).toBeVisible();
}

test("source picker shows original evidence for a missing reference and imports the exact selected provision", async ({
  page,
}) => {
  // Stub only fixture API boundaries so real browser events exercise the dialog and import client.
  const asset = (name: string) =>
    readFile(
      new URL(
        `../../../apps/web/src/public/assets/mocks/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ).then(JSON.parse);
  const [source, reference] = await Promise.all([
    asset("legal-source-management"),
    asset("legal-rule-reference-preview"),
  ]);
  const sourceVersionId = fixture.catalog.legalSourceVersionId;
  const doc = source.versionActive.documents[0];
  await page.route("**/api/admin/legal-sources", (route) =>
    route.fulfill({ json: { ok: true, data: source.list } }),
  );
  await page.route(
    `**/api/admin/legal-source-versions/${sourceVersionId}`,
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          data: {
            ...source.versionActive,
            id: sourceVersionId,
            documents: [{ ...doc, hasOriginal: true }],
          },
        },
      }),
  );
  await page.route(
    "**/api/admin/legal-rule-catalog/source-provisions?*",
    (route) =>
      route.fulfill({
        json: {
          ok: true,
          data: {
            sourceVersionId,
            documentId: doc.documentId,
            total: 1,
            page: 1,
            pageSize: 50,
            items: [
              {
                ...reference,
                sourceVersionId,
                documentId: doc.documentId,
                documentTitle: doc.title,
                citationLocatorRefs: [
                  { documentId: doc.documentId, locator: reference.locator },
                ],
              },
            ],
            limitations: [],
          },
        },
      }),
  );
  await page.route("**/source-provisions/import", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          rule: { id: fixture.rules[0].id },
          catalogRevision: fixture.catalog.revision + 1,
        },
      },
    }),
  );
  await openWorkflow(page);
  await chooseCatalog(page);
  await page
    .getByRole("button", { name: en.browseSourceDocuments, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const checkbox = dialog.getByRole("checkbox");
  await dialog.getByText(en.referenceContext, { exact: true }).click();
  await expect(
    dialog.getByText(reference.referenceContext[0].target.excerpt),
  ).toBeVisible();
  await expect(
    dialog.getByText(reference.referenceContext[0].target.locator, {
      exact: false,
    }),
  ).toBeVisible();
  const references = dialog
    .locator("details")
    .filter({ hasText: en.referenceContext });
  await expect(references.getByText(en.referenceUnresolved)).toBeVisible();
  await expect(references.getByText(doc.title, { exact: true })).toBeVisible();
  await expect(
    references.getByText(reference.description, { exact: true }),
  ).toBeVisible();
  // The source stays readable even when a stored original is available.
  await expect(
    references.getByRole("link", {
      name: enPages.legalSources.downloadOriginal,
    }),
  ).toHaveCount(0);
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  const request = page.waitForRequest(
    (req) =>
      req.url().endsWith("/source-provisions/import") &&
      req.method() === "POST",
  );
  await dialog
    .getByRole("button", { name: `${en.addSelectedRulesToCatalog} (1)` })
    .click();
  expect((await request).postDataJSON()).toEqual({
    documentId: doc.documentId,
    locator: reference.locator,
    expectedRevision: fixture.catalog.revision,
  });
  await expect(dialog).not.toBeVisible();
});

test("prepared results expose one activation checkbox in activation mode", async ({
  page,
}) => {
  await page.route(
    /\/api\/admin\/legal-rule-catalog\/[^/]+\/rules(?:\?.*)?$/u,
    (route) =>
      route.fulfill({
        status: 200,
        json: { ok: true, data: preparedActivationPage },
      }),
  );
  await openWorkflow(page);
  await chooseCatalog(page);
  await page.getByRole("combobox", { name: en.status, exact: true }).click();
  await page
    .getByRole("option", {
      name: en.preparedWithAssessmentRules,
      exact: true,
    })
    .click();

  const row = page
    .getByRole("listitem")
    .filter({ hasText: fixture.rules[0].legalRuleId });
  const checkbox = row.getByRole("checkbox");
  await expect(checkbox).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: en.selectAll, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: en.prepare, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: en.activateSelectedAssessmentRules,
      exact: true,
    }),
  ).toBeVisible();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
});

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
      name: ruleCheckboxName(fixture.rules[0]),
      exact: true,
    })
    .check();
  await page
    .getByTestId("rule-set-preparation-entry-point")
    .getByRole("button", { name: en.next, exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: ruleCheckboxName(fixture.rules[50]),
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("checkbox", {
      name: ruleCheckboxName(fixture.rules[51]),
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByTestId("legal-rule-selected-count")).toHaveText("2");
  await page.getByLabel(en.search, { exact: true }).fill("LR001");
  await expect(
    page.getByRole("checkbox", {
      name: ruleCheckboxName(fixture.rules[0]),
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
    dialog.getByText(fixture.output2.analysis, { exact: true }),
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
      name: ruleCheckboxName(fixture.rules[0]),
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
    name: ruleCheckboxName(fixture.authoring),
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
    name: ruleCheckboxName(fixture.rules[0], "vi"),
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

test("delete catalog permanently removes catalog and resets workflow state", async ({
  page,
}) => {
  await openWorkflow(page);
  await chooseCatalog(page);
  await expect(
    page.getByRole("button", { name: en.deleteCatalog, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: en.deleteCatalog, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: en.deleteCatalogTitle, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: en.deleteCatalogConfirm, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
