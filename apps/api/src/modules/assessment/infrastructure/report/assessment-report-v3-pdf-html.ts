import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_FACT_AUTHORITIES } from "@lcsp/contracts/assessment-domain";
import type { AssessmentReportV3Presentation } from "@lcsp/contracts/assessment-report";
import {
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
} from "@lcsp/contracts/assessment-report";
import {
  buildReportReferenceIndex,
  criterionPresentation,
  localizeReportText,
  localizedApplicability,
  localizedCompliance,
  localizedCriterionOutcome,
  localizedEvidenceType,
  ruleTitleInVietnamese,
  type ReportTranslationCatalog,
} from "./assessment-report-v2-pdf-presentation.js";

type RenderOptions = {
  preview?: boolean;
  translations?: ReportTranslationCatalog;
};

type RulePresentation =
  AssessmentReportV3Presentation["obligationDetails"][number];

const text = (value: unknown) => (typeof value === "string" ? value : "");
const escapeHtml = (value: unknown) =>
  text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const inline = (value: unknown) => escapeHtml(value).replaceAll("\n", "<br>");
const list = (values: readonly string[]) =>
  values.length
    ? `<ul>${values.map((value) => `<li>${inline(value)}</li>`).join("")}</ul>`
    : `<span class="muted">Chưa có thông tin được ghi nhận.</span>`;
const table = (headers: string[], rows: string[][], className = "") =>
  `<table class="${className}"><thead><tr>${headers.map((item) => `<th>${inline(item)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
const badge = (
  label: string,
  variant: "positive" | "negative" | "neutral" | "warning",
) => `<span class="badge ${variant}">${inline(label)}</span>`;

const priorityBadge = (priority: string) => {
  if (priority === ASSESSMENT_REPORT_ACTION_PRIORITIES.HIGH)
    return badge("Ưu tiên cao", "negative");
  if (priority === ASSESSMENT_REPORT_ACTION_PRIORITIES.MEDIUM)
    return badge("Ưu tiên trung bình", "warning");
  return badge("Ưu tiên thấp", "neutral");
};

/**
 * Business purpose: Produce valid, safe, and self-contained HTML for rendering Assessment Final Report V3 as PDF.
 *
 * Business rules:
 * - Render only accepted findings, canonical verdicts, authoritative source scope, and bounded action plans without recalculating compliance.
 * - Treat all persisted narrative, facts, locators, and limitation text as untrusted data and strictly escape them for HTML output.
 * - Forbid script execution, active markup, or remote resource loading through strict CSP and isolated styling.
 *
 * Execution flow:
 * 1. Build canonical reference indexes for legal sources, criteria, facts, evidence, and technical texts.
 * 2. Format executive summary, source scope banners, obligations catalog, and rule details with localized terms.
 * 3. Render bounded action plan derived from verified recommendations.
 * 4. Render technical traceability appendix with snapshot pins, scope limitations, and reference mappings.
 * 5. Return complete HTML document with embedded styles and security headers.
 *
 * Failure cases:
 * - Non-serializable objects throw during serialization; invalid models are rejected before rendering.
 *
 * Side effects:
 * - Pure function: creates an in-memory HTML document string.
 */
export function assessmentReportV3Html(
  model: AssessmentReportV3Presentation,
  options: RenderOptions = {},
): string {
  const translations = options.translations ?? {};
  const refs = buildReportReferenceIndex(model, translations);

  const scope = model.header.sourceScope;
  const isLimited =
    scope.visibility !==
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL ||
    scope.limitationReasons.length > 0;

  const scopeBanner = isLimited
    ? `<div class="scope-warning-banner"><strong>CẢNH BÁO PHẠM VI MÃ NGUỒN:</strong> Báo cáo này được thực hiện trong phạm vi khảo sát giới hạn (${inline(
        scope.mode,
      )} · ${inline(scope.visibility)}). ${
        scope.limitationReasons.length
          ? `<br><span class="muted">Lý do giới hạn: ${inline(
              scope.limitationReasons.join("; "),
            )}</span>`
          : ""
      }</div>`
    : "";

  const issueRows = model.summary.priorityIssues.map((item) => [
    inline(item.obligation),
    inline(item.issue),
    inline(item.action),
  ]);

  const factsRows = model.applicabilityFacts.map((factGroup) => {
    const detail = model.obligationDetails.find(
      (d) => d.assessmentRuleId === factGroup.assessmentRuleId,
    );
    const ruleRef = refs.ruleReference(factGroup.assessmentRuleId);
    const ruleHeader = ruleRef ? `<strong>[${inline(ruleRef)}]</strong> ` : "";
    const obligationTitle =
      detail?.legalRequirements.map((r) => r.title).join("; ") ??
      factGroup.assessmentRuleId;
    const applicabilityText = detail
      ? localizedApplicability(detail.applicability)
      : "";
    const factsList = factGroup.facts.length
      ? factGroup.facts
          .map((f) => {
            const factRef = refs.factReference(f.factId);
            const refLabel = factRef ? `[${inline(factRef)}] ` : "";
            return `<div>${refLabel}${inline(f.statement)}</div>`;
          })
          .join("")
      : '<span class="muted">Không có dữ kiện bổ sung.</span>';
    const evidenceList = factGroup.evidence.length
      ? factGroup.evidence
          .map((e) => {
            const evRef = refs.evidenceReference(e.evidenceId);
            const refLabel = evRef ? `[${inline(evRef)}] ` : "";
            const locator = e.safeLocator
              ? `<br><code>${inline(e.safeLocator)}</code>`
              : "";
            return `<div>${refLabel}${inline(localizedEvidenceType(e.type))}${locator}</div>`;
          })
          .join("")
      : '<span class="muted">Không có bằng chứng kiểm chứng.</span>';
    return [
      `${ruleHeader}${inline(obligationTitle)}`,
      applicabilityText,
      factsList,
      evidenceList,
    ];
  });

  const catalogRows = model.obligationCatalog.map((catalogItem) => {
    const detail = model.obligationDetails.find(
      (d) => d.assessmentRuleId === catalogItem.assessmentRuleId,
    );
    const ruleRef = refs.ruleReference(catalogItem.assessmentRuleId);
    const ruleHeader = ruleRef ? `<strong>[${inline(ruleRef)}]</strong> ` : "";
    const title =
      catalogItem.legalRequirements.map((r) => r.title).join("; ") ||
      catalogItem.assessmentRuleId;
    const related = catalogItem.relatedLegalContexts.length
      ? `<br><small class="muted">Bối cảnh liên quan: ${catalogItem.relatedLegalContexts
          .map(
            (ctx) =>
              `${inline(ctx.kind)}: ${inline(ctx.toLegalRequirementId)}${
                ctx.sourceRefs.length
                  ? ` (${ctx.sourceRefs.map((s) => inline(s.documentTitle ?? s.documentId)).join(", ")})`
                  : ""
              }`,
          )
          .join("; ")}</small>`
      : "";
    const appBadge = badge(
      localizedApplicability(catalogItem.applicability),
      catalogItem.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE
        ? "positive"
        : "neutral",
    );
    const compBadge = catalogItem.compliance
      ? badge(
          localizedCompliance(
            catalogItem.applicability,
            catalogItem.compliance,
          ),
          catalogItem.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
            ? "positive"
            : "negative",
        )
      : '<span class="muted">—</span>';
    const rationale = detail ? inline(detail.rationale) : "";
    return [
      `${ruleHeader}${inline(title)}${related}`,
      appBadge,
      compBadge,
      rationale,
    ];
  });

  const actionPlanRows = model.actionPlan.map((actionItem) => [
    priorityBadge(actionItem.priority),
    inline(actionItem.obligation),
    inline(actionItem.action),
  ]);

  const publicationText = options.preview
    ? "Bản xem trước; chưa phát hành"
    : "Đã phát hành";

  const previewBanner = options.preview
    ? `<div class="preview-banner">BẢN XEM TRƯỚC — DỮ LIỆU MINH HỌA</div>`
    : "";

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src 'self' data:;img-src 'none';script-src 'none';connect-src 'none'"><style>
@page{size:A4;margin:15mm 16mm 17mm}*{box-sizing:border-box}body{font-family:"Noto Sans",Arial,sans-serif;color:#40586b;font-size:9.5pt;line-height:1.42;margin:0}h1{font-size:24pt;line-height:1.08;color:#19364c;margin:4mm 0}h2{font-size:14pt;color:#19364c;border-left:4px solid #187985;padding-left:9px;margin:8mm 0 3mm;break-after:avoid}h3{font-size:11pt;color:#19364c;margin:4mm 0 2mm;break-after:avoid}p{margin:2mm 0 3mm}small,.muted{font-size:8pt;color:#607989}.eyebrow{color:#187985;font-size:8pt;text-transform:uppercase;letter-spacing:.04em}.preview-banner{border:1px solid #cf8a24;background:#fff5df;color:#744e10;padding:8px 10px;font-weight:700;margin:0 0 5mm}.scope-warning-banner{border:1px solid #d99a9a;background:#fff0ee;color:#9a2c2c;padding:8px 10px;border-radius:4px;margin:4mm 0}.lead{font-size:10pt;color:#354f63}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px}.meta-card{border:1px solid #cbd9e0;border-radius:4px;background:#edf3f6;padding:8px;min-width:0}.meta-card strong{display:block;color:#187985;font-size:7.5pt;text-transform:uppercase;margin-bottom:2px}.status-summary{border:1px solid #9dcac5;background:#edf8f6;border-radius:4px;padding:10px;margin:4mm 0;color:#19364c}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:4mm 0}.kpi{border:1px solid #cbd9e0;background:#f5f8fa;text-align:center;padding:7px 3px;border-radius:4px}.kpi strong{display:block;font-size:17pt;color:#19364c}.kpi span{font-size:7.3pt}.note{border-left:3px solid #187985;padding:6px 9px;background:#f2f7f9}.badge{display:inline-block;border:1px solid;border-radius:12px;padding:3px 8px;font-size:8pt;font-weight:700;white-space:normal}.badge.positive{color:#17665f;border-color:#88c5b7;background:#eaf7f3}.badge.negative{color:#9a2c2c;border-color:#d99a9a;background:#fff0ee}.badge.warning{color:#8a5600;border-color:#e0be82;background:#fff8eb}.badge.neutral{color:#5b6570;border-color:#b8c3ca;background:#f4f6f7}table{width:100%;border-collapse:collapse;margin:3mm 0 5mm;table-layout:fixed;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th{background:#187985;color:#fff;font-size:8pt;text-align:left;padding:6px}td{border:1px solid #cbd9e0;padding:6px;vertical-align:top;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f6f9fa}ul{margin:1mm 0 2mm 5mm;padding-left:4mm}li{margin:1mm 0}.appendix{break-before:auto}.appendix h2{margin-top:0}.appendix h3{font-size:9.5pt;background:#edf3f6;padding:5px 7px}.compact{font-size:7.5pt;margin:2mm 0 4mm}.compact th,.compact td{padding:4px}code{font-family:Consolas,"Courier New",monospace;font-size:8pt;overflow-wrap:anywhere}
</style></head><body>${previewBanner}<div class="eyebrow">LCSP · Báo cáo đánh giá nghĩa vụ pháp lý V3</div><h1>Báo cáo đánh giá nghĩa vụ pháp lý</h1><p class="lead">Kết quả đánh giá V3 tuân thủ chuẩn xác định danh và ràng buộc phạm vi khảo sát bất biến.</p>${scopeBanner}<div class="meta"><div class="meta-card"><strong>Phạm vi khảo sát</strong>${inline(
    scope.mode,
  )} (${inline(scope.visibility)})${
    model.header.sourcePathPrefix
      ? ` · Thư mục con: ${inline(model.header.sourcePathPrefix)}`
      : ""
  }</div><div class="meta-card"><strong>Tổng quy tắc</strong>${model.summary.totalRules} nghĩa vụ đã ghi nhận</div><div class="meta-card"><strong>Nguồn đánh giá</strong>Bộ quy tắc: ${inline(
    model.header.ruleSetVersion,
  )} · Nguồn: ${inline(model.header.legalSourceVersion)}</div><div class="meta-card"><strong>Trạng thái báo cáo</strong>${inline(
    publicationText,
  )}</div></div><div class="status-summary">${
    model.summary.applicableNonCompliant > 0
      ? "Đã ghi nhận nghĩa vụ áp dụng chưa đáp ứng."
      : "Chưa ghi nhận nghĩa vụ áp dụng chưa đáp ứng trong phạm vi khảo sát."
  }<br><span class="muted">Trạng thái “Không áp dụng” chỉ phạm vi, không đồng nghĩa với “Đáp ứng”.</span></div><div class="kpis"><div class="kpi"><strong>${
    model.summary.totalRules
  }</strong><span>Tổng quy tắc</span></div><div class="kpi"><strong>${
    model.summary.applicableCompliant
  }</strong><span>Áp dụng · Đáp ứng</span></div><div class="kpi"><strong>${
    model.summary.applicableNonCompliant
  }</strong><span>Áp dụng · Chưa đáp ứng</span></div><div class="kpi"><strong>${
    model.summary.notApplicable
  }</strong><span>Không áp dụng</span></div></div><h2>01 — KẾT QUẢ ĐÁNH GIÁ VÀ CÁC NGHĨA VỤ ƯU TIÊN</h2><p>${inline(
    model.summary.applicableNonCompliant
      ? "Danh sách các nghĩa vụ chưa đáp ứng được xếp theo độ ưu tiên giải quyết."
      : "Chưa ghi nhận nghĩa vụ không đáp ứng trong phạm vi khảo sát.",
  )}</p>${
    issueRows.length
      ? table(["Nghĩa vụ", "Kết quả đã ghi nhận", "Kiến nghị"], issueRows)
      : '<p class="note">Không có phát hiện chưa đáp ứng.</p>'
  }<h2>02 — DỮ KIỆN VÀ CĂN CỨ ÁP DỤNG</h2>${table(
    [
      "Nghĩa vụ",
      "Khả năng áp dụng",
      "Dữ kiện được ghi nhận",
      "Bằng chứng kiểm chứng",
    ],
    factsRows,
  )}<h2>03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ</h2>${table(
    ["Nghĩa vụ và bối cảnh", "Khả năng áp dụng", "Kết quả", "Giải thích"],
    catalogRows,
  )}<h2>04 — KẾ HOẠCH HÀNH ĐỘNG CÓ RÀNG BUỘC (ACTION PLAN)</h2>${
    actionPlanRows.length
      ? table(
          ["Mức độ", "Nghĩa vụ liên quan", "Hành động khắc phục"],
          actionPlanRows,
        )
      : '<p class="note">Chưa ghi nhận hành động khắc phục nào.</p>'
  }<h2>05 — PHẠM VI, GIỚI HẠN VÀ TRUY VẾT KỸ THUẬT</h2><p>Hồ sơ đánh giá được ghim với phiên bản nguồn và kho mã cụ thể.</p>${list(
    model.scopeTraceability.scopeLimitations,
  )}<section class="appendix"><h3>Ghim dữ liệu và nguồn gốc</h3>${table(
    ["Trường", "Giá trị"],
    [
      ["Mã đánh giá", inline(model.scopeTraceability.assessmentId)],
      ["Mã artifact", inline(model.scopeTraceability.artifactId)],
      ["Phiên bản báo cáo", inline(model.scopeTraceability.schemaVersion)],
      ["Lần hiệu chỉnh", inline(String(model.scopeTraceability.caseRevision))],
      [
        "Phiên bản nguồn pháp lý",
        `${inline(model.scopeTraceability.legalSourceVersion)} (${inline(model.scopeTraceability.legalSourceVersionId)})`,
      ],
      [
        "Phiên bản bộ quy tắc",
        `${inline(model.scopeTraceability.ruleSetVersion)} (${inline(model.scopeTraceability.ruleSetVersionId)})`,
      ],
      [
        "Bản chụp kho mã nguồn",
        inline(model.scopeTraceability.repositorySnapshotId),
      ],
      ["Commit kho mã", inline(model.scopeTraceability.repositoryCommit)],
      [
        "Tiền tố thư mục con (sourcePathPrefix)",
        inline(
          model.scopeTraceability.sourcePathPrefix ?? "Toàn bộ kho mã (null)",
        ),
      ],
      [
        "Chế độ phạm vi (Mode)",
        inline(model.scopeTraceability.sourceScope.mode),
      ],
      [
        "Độ khả kiến (Visibility)",
        inline(model.scopeTraceability.sourceScope.visibility),
      ],
    ],
    "compact",
  )}</section></body></html>`;
}
