import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES } from "@lcsp/contracts/legal-source";

// Transport/UI fixtures only; these are not legal evidence or admission results.
const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/legal-source-lifecycle-ui.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const evidence = "docs/implementation-artifacts/lcsp-418";

test("version lifecycle review, document dialogs, provenance and mobile layout", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "lcsp_session",
      value: "billing-e2e-admin",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let uploads = 0;
  let imports = 0;
  await page.route("**/api/admin/legal-source**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      if (url.pathname.endsWith("/upload")) {
        uploads++;
        expect(route.request().postData()).toContain(
          LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY,
        );
      } else if (url.pathname.endsWith("/import")) {
        imports++;
        expect(route.request().postDataJSON().corpusRole).toBe(
          LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY,
        );
      } else throw new Error(`Unexpected mutation: ${url.pathname}`);
      return route.fulfill({
        json: { ok: true, data: fixture.version.documents[0] },
      });
    }
    return route.fulfill({
      json: {
        ok: true,
        data: url.pathname.includes("legal-source-versions")
          ? fixture.version
          : fixture.source,
      },
    });
  });
  await page.goto(`/admin/legal-source-versions/${fixture.version.id}`);
  await expect(
    page.getByRole("heading", {
      name: `Version ${fixture.version.version}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/${process.env.LCSP_CAPTURE_BEFORE ? "before" : "after"}-version.png`,
    fullPage: true,
    animations: "disabled",
  });
  if (process.env.LCSP_CAPTURE_BEFORE) return;
  await page
    .getByRole("button", { name: "Review activation", exact: true })
    .click();
  const activation = page.getByRole("dialog");
  await expect(
    activation.getByRole("button", { name: "Activate version", exact: true }),
  ).toBeDisabled();
  await expect(
    activation.getByText(/LCSP-424\/425 admission/).first(),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/activation-blocked.png`,
    fullPage: true,
    animations: "disabled",
  });
  await activation
    .getByRole("button", { name: "Cancel", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Upload file", exact: true }).click();
  const upload = page.getByRole("dialog");
  await expect(upload).toBeVisible();
  await upload
    .getByLabel("Document purpose", { exact: true })
    .selectOption(LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY);
  await upload.locator('input[type="file"]').setInputFiles({
    name: "technical-stub.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Non-legal technical transport stub."),
  });
  await page.screenshot({
    path: `${evidence}/upload.png`,
    fullPage: true,
    animations: "disabled",
  });
  await upload
    .getByRole("button", { name: "Upload document", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(uploads).toBe(1);
  await expect(page.getByText(/Document accepted by the server/)).toBeVisible();
  await page
    .getByRole("button", { name: "Import from URL", exact: true })
    .click();
  const importDialog = page.getByRole("dialog");
  await importDialog
    .getByLabel("Document purpose", { exact: true })
    .selectOption(LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY);
  await importDialog
    .locator('input[type="url"]')
    .fill("https://example.test/technical-stub.txt");
  await importDialog
    .getByRole("button", { name: "Import document", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(imports).toBe(1);
  await page
    .getByText("Official source provenance", { exact: true })
    .first()
    .click();
  await expect(
    page.getByText(/Document number, issuing authority/).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${evidence}/mobile.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("deletion blocks protected references and shows a validated receipt only after confirmed deletion", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "lcsp_session",
      value: "billing-e2e-admin",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  let eligible = false;
  let deletes = 0;
  await page.route("**/api/admin/legal-sources**", async (route) => {
    if (route.request().method() === "DELETE") {
      deletes++;
      const body = route.request().postDataJSON();
      expect(body.confirmationSlug).toBe(fixture.source.slug);
      expect(body.expectedImpactEtag).toBe(fixture.impact.snapshot.etag);
      expect(body.reason.text).toBe(
        "Remove non-legal technical transport fixture",
      );
      return route.fulfill({ json: { ok: true, data: fixture.receipt } });
    }
    const impact = structuredClone(fixture.impact);
    if (eligible) {
      impact.versions[0].references.assessments = 0;
      impact.eligibility = { eligibleAtSnapshot: true, blockers: [] };
    }
    return route.fulfill({
      json: {
        ok: true,
        data: route.request().url().endsWith("/deletion-impact")
          ? impact
          : fixture.source,
      },
    });
  });
  await page.goto(`/admin/legal-sources/${fixture.source.id}`);
  await page
    .getByRole("button", { name: "Permanently delete source", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", {
    name: "Permanently delete",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByText(/protected|assessment/i).first()).toBeVisible();
  await page.screenshot({
    path: `${evidence}/deletion-blocked.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect(deletes).toBe(0);
  eligible = true;
  await dialog
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  const slugInput = dialog.getByLabel(
    `Type "${fixture.source.slug}" to confirm`,
    { exact: true },
  );
  await expect(slugInput).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Copy slug", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator("code")).toHaveCount(0);
  await expect(dialog.locator("#legal-source-delete-confirm-help")).toHaveCount(
    0,
  );
  const snapshot = dialog.getByText(/^Snapshot generated at:/);
  const expectedTimestamp = await page.evaluate(
    (iso) =>
      new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)),
    fixture.impact.snapshot.generatedAt,
  );
  await expect(snapshot).toContainText(expectedTimestamp);
  await expect(snapshot).not.toContainText(fixture.impact.snapshot.generatedAt);
  await slugInput.fill(`"${fixture.source.slug}"`);
  await expect(confirm).toBeDisabled();
  await dialog
    .locator("#legal-source-delete-confirm")
    .fill(fixture.source.slug);
  await dialog
    .locator("#legal-source-delete-reason-text")
    .fill("Remove non-legal technical transport fixture");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByText(fixture.receipt.deletionReceiptId, { exact: true }),
  ).toBeVisible();
  expect(deletes).toBe(1);
  await page.screenshot({
    path: `${evidence}/deletion-receipt.png`,
    fullPage: true,
    animations: "disabled",
  });
});

test("Vietnamese lifecycle copy and keyboard dialog focus", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "lcsp_session",
      value: "billing-e2e-admin",
      domain: "127.0.0.1",
      path: "/",
    },
    { name: "lcsp_locale", value: "vi", domain: "127.0.0.1", path: "/" },
  ]);
  await page.route("**/api/admin/legal-source**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: route.request().url().includes("legal-source-versions")
          ? fixture.version
          : fixture.source,
      },
    }),
  );
  await page.goto(`/admin/legal-source-versions/${fixture.version.id}`);
  const review = page.getByRole("button", {
    name: "Xem xét kích hoạt",
    exact: true,
  });
  await review.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/API chưa cung cấp phê duyệt/).first(),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "K\u00edch ho\u1ea1t phi\u00ean b\u1ea3n",
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({
    path: `${evidence}/activation-vi.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(review).toBeFocused();
});
