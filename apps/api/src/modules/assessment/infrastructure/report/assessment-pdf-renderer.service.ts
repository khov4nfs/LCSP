import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { chromium, type Browser } from "playwright";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  type AssessmentFinalReportArtifact,
} from "@lcsp/contracts/assessment-domain";
import {
  buildAssessmentReportPresentation,
  type AssessmentFinalReportV2,
} from "@lcsp/contracts/assessment-report";
import { assessmentReportV2Html } from "./assessment-report-v2-pdf-html.js";
import type { ReportTranslationCatalog } from "./assessment-report-v2-pdf-presentation.js";

/**
 * Business purpose: Normalize PDF resource settings while preserving their positive-integer safety guards.
 *
 * Business rules:
 * - Only positive safe integers may override time, size, or concurrency defaults.
 *
 * Execution flow:
 * 1. Parse the supplied configuration value.
 * 2. Return it when valid or use the caller's safe fallback.
 *
 * Failure cases:
 * - Missing, fractional, unsafe, or non-positive settings use the fallback rather than disabling the guard.
 *
 * Side effects:
 * - None: reads a configuration value and returns a normalized number.
 */
const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const TIMEOUT = positiveInt(process.env.LCSP_PDF_RENDER_TIMEOUT_MS, 30_000);
const START_TIMEOUT = positiveInt(
  process.env.LCSP_PDF_BROWSER_START_TIMEOUT_MS,
  10_000,
);
const MAX_BYTES = positiveInt(process.env.LCSP_PDF_MAX_REPORT_BYTES, 8_000_000);
/**
 * Business purpose: Convert report values to safe textual input before HTML escaping.
 *
 * Business rules:
 * - Preserve strings, represent nullish values as empty text, and JSON-serialize other structured values.
 *
 * Execution flow:
 * 1. Return a string unchanged when already textual.
 * 2. Return empty text for null or undefined, otherwise serialize the value as JSON.
 *
 * Failure cases:
 * - Values that cannot be JSON-serialized propagate the serialization error instead of being rendered as misleading text.
 *
 * Side effects:
 * - None: normalizes an in-memory display value only.
 */
const printable = (v: unknown) =>
  typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);

/**
 * Business purpose: Prevent report text from being interpreted as active HTML in the V1 PDF document.
 *
 * Business rules:
 * - Treat stored report text as data and escape all HTML-significant characters before rendering.
 *
 * Execution flow:
 * 1. Convert the value to safe display text.
 * 2. Escape ampersands and markup delimiters.
 *
 * Failure cases:
 * - Non-string values are safely stringified or represented as empty text by the renderer.
 *
 * Side effects:
 * - None: returns escaped text without changing the report artifact.
 */
const esc = (v: unknown) =>
  printable(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
/**
 * Business purpose: Render supported V1 report terminology in Vietnamese while preserving unrecognized source wording.
 *
 * Business rules:
 * - Apply only explicit presentation translations; do not alter stored decision, evidence, or legal meaning.
 *
 * Execution flow:
 * 1. Normalize the input to display text.
 * 2. Apply an exact known translation when available, otherwise preserve the source text.
 * 3. Escape the resulting text for HTML output.
 *
 * Failure cases:
 * - Empty values use the supplied display fallback; unknown terminology remains visible in its original form.
 *
 * Side effects:
 * - None: performs locale presentation only and does not modify authoritative report data.
 */
const viText = (value: unknown, fallback = "—") => {
  const text = printable(value).trim();
  if (!text) return fallback;
  const exact: Record<string, string> = {
    "The system stores notices with a receipt timestamp.":
      "Hệ thống lưu trữ thông báo kèm thời điểm tiếp nhận.",
    "Ensure the legal intent is met.": "Bảo đảm ý định pháp lý được đáp ứng.",
    "Applies when the described condition holds.":
      "Áp dụng khi điều kiện được mô tả xảy ra.",
    "The definition is context, not an assessable duty here.":
      "Định nghĩa này chỉ là bối cảnh, không phải nghĩa vụ cần đánh giá trong trường hợp này.",
    "The control exists.": "Biện pháp kiểm soát này tồn tại.",
    "Based on the cited source.": "Dựa trên nguồn đã được trích dẫn.",
    REPOSITORY_SOURCE: "Nguồn từ repository",
    EVIDENCE_CITED: "Bằng chứng đã trích dẫn",
    MET: "Đạt",
    NOT_MET: "Chưa đạt",
    [RULE_DECISION_APPLICABILITIES.APPLICABLE]: "Áp dụng",
    [RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE]: "Không áp dụng",
    [RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT]: "Đáp ứng",
    [RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT]: "Chưa đáp ứng",
  };
  const translated =
    exact[text] ??
    text
      .replace(/^Concept\s+(.+)$/u, "Khái niệm $1")
      .replace(/^Proposition\s+(.+)$/u, "Mệnh đề $1")
      .replace(/^Rule\s+(.+)$/u, "Quy tắc $1")
      .replace(
        /^([A-Z][A-Z0-9-]+) applies to the notice service\.$/u,
        "$1 áp dụng cho dịch vụ thông báo.",
      );
  return esc(translated).replaceAll("\n", "<br>");
};
/**
 * Business purpose: Preserve the existing customer-visible PDF layout for immutable V1 report artifacts.
 *
 * Business rules:
 * - Render the artifact's accepted findings, applicability, compliance, rationale, facts, evidence, and recommendations without recalculation.
 * - Escape untrusted text before including it in the document.
 *
 * Execution flow:
 * 1. Project each stored finding and its optional provenance sections.
 * 2. Compose the V1 summary and findings into a self-contained HTML document.
 *
 * Failure cases:
 * - Missing optional fact/evidence sections are omitted; invalid V1 schema is rejected by the renderer entrypoint.
 *
 * Side effects:
 * - None: constructs an in-memory document and does not change the immutable artifact.
 */
function legacyV1Html(report: AssessmentFinalReportArtifact): string {
  const findings = report.findings
    .map((finding) => {
      const basis = finding.decision.applicabilityBasis ?? [];
      const facts = finding.facts ?? [];
      const evidence = finding.evidence ?? [];
      const basisHtml = basis.length
        ? `<h4>Cơ sở áp dụng</h4><ul>${basis
            .map(
              (entry) =>
                `<li><b>${viText(entry.kind)} #${entry.index}</b>: ${viText(entry.finding)} — ${esc(entry.rationale)}</li>`,
            )
            .join("")}</ul>`
        : "";
      const factsHtml = facts.length
        ? `<h4>Dữ kiện</h4><ul>${facts
            .map(
              (fact) =>
                `<li><b>${esc(fact.factId)}</b>: ${esc(fact.statement)}</li>`,
            )
            .join("")}</ul>`
        : "";
      const evidenceHtml = evidence.length
        ? `<h4>Bằng chứng</h4><ul>${evidence
            .map(
              (item) =>
                `<li><b>${esc(item.evidenceId)}</b> — ${esc(item.path ?? "")}:${esc(item.startLine ?? "")}–${esc(item.endLine ?? "")}</li>`,
            )
            .join("")}</ul>`
        : "";
      return `<section class="finding"><h3>${esc(finding.assessmentRuleId)}</h3><p><b>Khả năng áp dụng:</b> ${viText(finding.decision.applicability)}</p><p><b>Kết quả tuân thủ:</b> ${viText(finding.decision.compliance)}</p><p><b>Cơ sở kết luận:</b> ${esc(finding.decision.rationale)}</p>${basisHtml}<h4>Tóm tắt</h4><p>${esc(finding.summary)}</p>${factsHtml}${evidenceHtml}${finding.recommendations.length ? `<h4>Khuyến nghị</h4><ul>${finding.recommendations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}</section>`;
    })
    .join("");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src 'self' data:;img-src 'none';script-src 'none';connect-src 'none"><style>@page{size:A4;margin:16mm 18mm 18mm}body{font-family:"Noto Sans",Arial,sans-serif;color:#40586b;font-size:9.5pt;line-height:1.4}h1{color:#19364c;margin-bottom:5mm}h2{color:#187985;border-bottom:1px solid #cbd9e0;padding-bottom:3mm}.finding{border:1px solid #cbd9e0;border-radius:6px;padding:10px;margin:0 0 8mm;break-inside:avoid}h3{color:#fff;background:#19364c;padding:8px;margin:-10px -10px 8px}h4{color:#19364c;margin:8px 0 3px}li{margin:2px 0;overflow-wrap:anywhere}.meta{background:#edf3f6;padding:10px}</style></head><body><h1>LCSP — Báo cáo đánh giá cuối cùng</h1><div class="meta"><b>Mã đánh giá:</b> ${esc(report.assessmentId)}<br><b>Mã báo cáo:</b> ${esc(report.artifactId)}<br><b>Phiên bản báo cáo:</b> ${esc(report.schemaVersion)}<br><b>Mã commit của kho mã:</b> ${esc(report.pins.repositoryCommit)}</div><h2>Tóm tắt</h2><p>${esc(report.summary)}</p><h2>Phát hiện</h2>${findings}</body></html>`;
}

@Injectable()
export class AssessmentPdfRenderer implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | undefined;
  private activeRenders = 0;
  private readonly maxConcurrent = positiveInt(
    process.env.LCSP_PDF_MAX_CONCURRENT,
    2,
  );
  /**
   * Business purpose: Produce a downloadable V2 PDF from the immutable report projection supplied by the authorized caller.
   *
   * Business rules:
   * - Require the V2 version discriminator, enforce input/output size and render concurrency limits, and block external page requests; callers validate the full artifact contract.
   * - Render the shared V2 presentation model without changing accepted decisions or source references.
   *
   * Execution flow:
   * 1. Validate the artifact version, projection, size, and available render capacity.
   * 2. Render the V2 HTML in an isolated JavaScript-disabled Chromium context.
   * 3. Return the complete PDF bytes after enforcing timeout and output-size bounds.
   *
   * Failure cases:
   * - A non-V2 version, invalid projection, exhausted concurrency, browser failure, timeout, empty output, or oversized input/output rejects the request.
   *
   * Side effects:
   * - Launches or reuses the local Chromium process and allocates a temporary browser context; no assessment or artifact records are written.
   */
  async render(
    report: AssessmentFinalReportV2,
    options: {
      preview?: boolean;
      translations?: ReportTranslationCatalog;
    } = {},
  ): Promise<Buffer> {
    if (report.schemaVersion !== ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION)
      throw new Error("PDF rendering requires an Assessment Final Report V2");
    const model = buildAssessmentReportPresentation(report);
    if (!("summary" in model)) throw new Error("Invalid V2 presentation model");
    if (Buffer.byteLength(JSON.stringify(report), "utf8") > MAX_BYTES)
      throw new Error("Assessment report exceeds PDF input limit");
    if (this.activeRenders >= this.maxConcurrent)
      throw new Error("PDF renderer concurrency limit reached");
    this.activeRenders += 1;
    let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
    try {
      const browser = await this.browser();
      context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        route.request().url() === "about:blank" ||
        route.request().url().startsWith("data:")
          ? route.continue()
          : route.abort("blockedbyclient"),
      );
      const document = assessmentReportV2Html(model, options);
      await page.setContent(document, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT,
      });
      const pdfPromise = page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font:8px Arial;color:#557080;text-align:center">LCSP · Trang <span class="pageNumber"></span> trên <span class="totalPages"></span></div>',
        margin: { top: "12mm", bottom: "14mm", left: "0mm", right: "0mm" },
      });
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void context?.close().catch(() => undefined);
          reject(new Error("PDF rendering timed out"));
        }, TIMEOUT);
      });
      const pdf = await Promise.race([pdfPromise, deadline]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (!pdf.length) throw new Error("Chromium returned an empty PDF");
      if (pdf.length > MAX_BYTES)
        throw new Error("Rendered PDF exceeds output limit");
      return pdf;
    } finally {
      await context?.close().catch(() => undefined);
      this.activeRenders -= 1;
    }
  }

  /**
   * Business purpose: Keep authorized downloads of previously stored V1 report artifacts available as PDF.
   *
   * Business rules:
   * - Accept only the V1 schema and render stored conclusions and provenance without upgrading or reinterpreting the artifact.
   * - Enforce the same bounded, isolated Chromium rendering policy as V2.
   *
   * Execution flow:
   * 1. Validate the V1 version, serialized size, and render capacity.
   * 2. Render the V1 compatibility document in a restricted browser context.
   * 3. Return non-empty PDF bytes within the configured output bound.
   *
   * Failure cases:
   * - Invalid V1 artifacts, browser failures, timeouts, empty output, or exceeded limits reject the download.
   *
   * Side effects:
   * - Uses a local Chromium process and temporary page/context; no report or assessment data is changed.
   */
  async renderLegacyV1(report: AssessmentFinalReportArtifact): Promise<Buffer> {
    if (report.schemaVersion !== ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION)
      throw new Error("PDF rendering requires an Assessment Final Report V1");
    const inputBytes = Buffer.byteLength(JSON.stringify(report), "utf8");
    if (inputBytes > MAX_BYTES)
      throw new Error("Assessment report exceeds PDF input limit");
    if (this.activeRenders >= this.maxConcurrent)
      throw new Error("PDF renderer concurrency limit reached");
    this.activeRenders += 1;
    let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
    try {
      const browser = await this.browser();
      context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        route.request().url() === "about:blank" ||
        route.request().url().startsWith("data:")
          ? route.continue()
          : route.abort("blockedbyclient"),
      );
      await page.setContent(legacyV1Html(report), {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT,
      });
      const pdfPromise = page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font:8px Arial;color:#557080;text-align:center">LCSP · Trang <span class="pageNumber"></span> trên <span class="totalPages"></span></div>',
        margin: { top: "12mm", bottom: "14mm", left: "0mm", right: "0mm" },
      });
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void context?.close().catch(() => undefined);
          reject(new Error("PDF rendering timed out"));
        }, TIMEOUT);
      });
      const pdf = await Promise.race([pdfPromise, deadline]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (!pdf.length) throw new Error("Chromium returned an empty PDF");
      if (pdf.length > MAX_BYTES)
        throw new Error("Rendered PDF exceeds output limit");
      return pdf;
    } finally {
      await context?.close().catch(() => undefined);
      this.activeRenders -= 1;
    }
  }
  /**
   * Business purpose: Release the renderer's Chromium resource when the API module shuts down.
   *
   * Business rules:
   * - Close only the browser instance owned by this renderer and clear its cached handle.
   *
   * Execution flow:
   * 1. Await any pending browser launch safely.
   * 2. Close the launched browser when present and clear local state.
   *
   * Failure cases:
   * - A failed or already-closed browser is ignored during shutdown so application teardown can continue.
   *
   * Side effects:
   * - Closes this renderer's local Chromium process; no assessment data is changed.
   */
  async onModuleDestroy(): Promise<void> {
    const browser = await this.browserPromise?.catch(() => undefined);
    await browser?.close().catch(() => undefined);
    this.browserPromise = undefined;
  }
  /**
   * Business purpose: Reuse one controlled headless browser for bounded V1 and V2 PDF rendering.
   *
   * Business rules:
   * - Launch Chromium headlessly with the configured startup timeout and sandbox enabled; clear failed or disconnected instances for safe later recovery.
   *
   * Execution flow:
   * 1. Return the current browser launch promise when one exists.
   * 2. Otherwise launch Chromium and track disconnect/rejection to reset the cached promise.
   *
   * Failure cases:
   * - Missing browser binaries or launch errors reject the active render; no substitute renderer is silently selected.
   *
   * Side effects:
   * - Starts a local Chromium process when needed and registers lifecycle handlers.
   */
  private browser(): Promise<Browser> {
    if (!this.browserPromise) {
      const launch = chromium.launch({
        headless: true,
        chromiumSandbox: true,
        ignoreDefaultArgs: ["--disable-dev-shm-usage"],
        timeout: START_TIMEOUT,
      });
      const tracked = launch.then(
        (browser) => {
          browser.once("disconnected", () => {
            if (this.browserPromise === tracked)
              this.browserPromise = undefined;
          });
          return browser;
        },
        (error: unknown) => {
          if (this.browserPromise === tracked) this.browserPromise = undefined;
          throw error;
        },
      );
      this.browserPromise = tracked;
      // The render caller observes the rejection; this handler prevents an
      // unhandled rejection when launch fails before a caller awaits it.
      void tracked.catch(() => undefined);
    }
    return this.browserPromise;
  }
}
