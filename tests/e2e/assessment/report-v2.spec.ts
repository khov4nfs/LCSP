import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse") as typeof import("pdf-parse");

type Fixture = {
  apiBase: string;
  assessmentId: string;
  artifactId: string;
  ownerToken: string;
  foreignToken: string;
  artifactHash: string;
  ruleIds: string[];
  schemaVersion: string;
  scenario?: string;
  expectedCounts?: {
    totalRules: number;
    applicableCompliant: number;
    applicableNonCompliant: number;
    notApplicable: number;
  };
};

function fixture(): Fixture {
  const path = process.env.LCSP_BROWSER_FIXTURE_FILE;
  if (!path) throw new Error("LCSP_BROWSER_FIXTURE_FILE is required");
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

const SECTION_HEADINGS = [
  "KẾT QUẢ ĐÁNH GIÁ",
  "DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG",
  "DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ",
  "CHI TIẾT TỪNG NGHĨA VỤ",
  "KẾ HOẠCH HÀNH ĐỘNG",
  "PHẠM VI, GIỚI HẠN VÀ NGUỒN TRUY VẾT",
];

test("renders the real V2 report and downloads verified JSON/PDF", async ({
  page,
  context,
}) => {
  const data = fixture();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await context.addCookies([
    {
      name: "lcsp_session",
      value: data.ownerToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "lcsp_locale",
      value: "vi",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);

  await page.goto(`/assessments/${data.assessmentId}/report`, {
    waitUntil: "networkidle",
  });
  await expect(page.locator('[data-slot="assessment-report"]')).toBeVisible();

  const headings = page.locator('h2[id^="report-section-"]');
  await expect(headings).toHaveCount(6);
  for (let i = 0; i < SECTION_HEADINGS.length; i += 1) {
    await expect(headings.nth(i)).toContainText(SECTION_HEADINGS[i]);
  }

  await expect(
    page.getByText(data.assessmentId, { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(data.artifactId, { exact: false }).first(),
  ).toBeVisible();
  for (const ruleId of data.ruleIds) {
    await expect(
      page.locator(`#report-rule-${encodeURIComponent(ruleId)}`),
    ).toBeVisible();
  }
  if (data.scenario === "all-na") {
    await expect(
      page.getByText("NOT_APPLICABLE", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("COMPLIANT", { exact: true })).toHaveCount(0);
    await expect(page.getByText("NON_COMPLIANT", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText(
        /100% compliant|Fully compliant|All requirements satisfied|Certified compliant/i,
      ),
    ).toHaveCount(0);
  } else {
    await expect(
      page.getByText("NOT_APPLICABLE", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("COMPLIANT", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("NON_COMPLIANT", { exact: true }).first(),
    ).toBeVisible();
  }
  await expect(
    page.getByText("Phiên bản nguồn pháp lý", { exact: false }).first(),
  ).toBeVisible();

  const jsonDownload = page.waitForEvent("download");
  await page.locator('[data-report-action="download"]').click();
  const jsonPath = await (await jsonDownload).path();
  expect(jsonPath).toBeTruthy();
  const jsonBytes = readFileSync(jsonPath!);
  const jsonText = jsonBytes.toString("utf8");
  const report = JSON.parse(jsonText) as Record<string, any>;
  expect(report.schemaVersion).toBe(data.schemaVersion);
  expect(report.assessmentId).toBe(data.assessmentId);
  expect(report.artifactId).toBe(data.artifactId);
  expect(report.ruleDetails).toHaveLength(data.ruleIds.length);
  if (data.expectedCounts)
    expect(report.outcomeSummary).toMatchObject(data.expectedCounts);
  expect(`sha256:${createHash("sha256").update(jsonBytes).digest("hex")}`).toBe(
    data.artifactHash,
  );

  // LCSP-323 locale switching must never rewrite the canonical V2 artifact.
  await context.addCookies([
    {
      name: "lcsp_locale",
      value: "en",
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('[data-slot="assessment-report"]')).toBeVisible();
  const englishJsonDownload = page.waitForEvent("download");
  await page.locator('[data-report-action="download"]').click();
  const englishJsonPath = await (await englishJsonDownload).path();
  expect(englishJsonPath).toBeTruthy();
  const englishJsonBytes = readFileSync(englishJsonPath!);
  expect(englishJsonBytes.equals(jsonBytes)).toBe(true);
  expect(
    `sha256:${createHash("sha256").update(englishJsonBytes).digest("hex")}`,
  ).toBe(data.artifactHash);

  const pdfDownload = page.waitForEvent("download");
  await page.locator('[data-report-action="download-pdf"]').click();
  const pdfPath = await (await pdfDownload).path();
  expect(pdfPath).toBeTruthy();
  const pdfBytes = readFileSync(pdfPath!);
  expect(pdfBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(pdfBytes.length).toBeGreaterThan(1000);
  const parsedPdf = new PDFParse({ data: pdfBytes });
  const pdfText = await parsedPdf.getText();
  await parsedPdf.destroy();
  for (const marker of [
    "KẾT QUẢ ĐÁNH GIÁ",
    "DỮ KIỆN LIÊN QUAN",
    "DANH MỤC",
    "CHI TIẾT",
    "KẾ HOẠCH",
    "PHẠM VI",
  ]) {
    expect(pdfText.text).toContain(marker);
  }
  expect(pdfText.text).toContain(data.assessmentId);
  expect(pdfText.text).toContain(data.artifactId);
  for (const ruleId of data.ruleIds) expect(pdfText.text).toContain(ruleId);
  expect(pdfText.pages).toHaveLength(pdfText.total);
  pdfText.pages.forEach((page, index) => {
    expect(page.text.match(/Page \d+ of \d+/g) ?? []).toHaveLength(1);
    expect(page.text).toContain(`Page ${index + 1} of ${pdfText.total}`);
    expect(page.text.replace(/Page \d+ of \d+/g, "").trim()).not.toBe("");
  });
  expect(consoleErrors).toEqual([]);
});

test("rejects an unauthenticated report page", async ({ page }) => {
  const data = fixture();
  const response = await page.request.get(
    `/api/assessments/${data.assessmentId}/artifacts/${data.artifactId}/report`,
  );
  expect(response.status()).toBe(401);
});

test("rejects a foreign customer through the Web BFF", async ({
  page,
  context,
}) => {
  const data = fixture();
  await context.addCookies([
    {
      name: "lcsp_session",
      value: data.foreignToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const response = await page.request.get(
    `/api/assessments/${data.assessmentId}/artifacts/${data.artifactId}/report`,
  );
  expect(response.status()).toBe(404);
});
