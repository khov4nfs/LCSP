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
  ASSESSMENT_REPORT_PUBLICATION_STATES,
  buildAssessmentReportPresentation,
  type AssessmentFinalReportV2,
  type AssessmentReportV2Presentation,
} from "@lcsp/contracts/assessment-report";
import { assessmentReportV2Html } from "./assessment-report-v2-pdf-html.js";
import type { ReportTranslationCatalog } from "./assessment-report-v2-pdf-presentation.js";

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
const printable = (v: unknown) =>
  typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
const esc = (v: unknown) =>
  printable(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const tx = (v: unknown, fallback = "—") => {
  const s = printable(v).trim();
  return s ? esc(s).replaceAll("\n", "<br>") : fallback;
};
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
const ul = (xs: readonly unknown[]) =>
  xs.length ? `<ul>${xs.map((x) => `<li>${tx(x)}</li>`).join("")}</ul>` : "—";
const status = (a: string, c: string | null) =>
  a === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
    ? "Không đánh giá tuân thủ"
    : c === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
      ? "Đáp ứng"
      : c === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
        ? "Chưa đáp ứng"
        : "Chưa đủ thông tin";

function html(
  model: AssessmentReportV2Presentation,
  publicationLabel: string,
): string {
  const rows = (items: string[][]) =>
    items
      .map(
        (row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
      )
      .join("");
  const list = (items: readonly unknown[]) =>
    items.length
      ? `<ul>${items.map((item) => `<li>${tx(item)}</li>`).join("")}</ul>`
      : "—";
  const ruleTitle = (
    rule: AssessmentReportV2Presentation["obligationDetails"][number],
  ) =>
    rule.legalRequirements
      .map((item) => printable(item.title).replace(/^Rule\s+/u, "Quy tắc "))
      .join("; ") || "Nghĩa vụ pháp lý";
  const files = [
    ...new Set(
      model.obligationDetails.flatMap((rule) =>
        rule.evidence
          .map((item) => item.safeLocator)
          .filter((item): item is string => Boolean(item)),
      ),
    ),
  ];
  const facts = [
    ...new Set(
      model.obligationDetails.flatMap((rule) =>
        rule.observedFacts.map((fact) => fact.statement.trim()),
      ),
    ),
  ];
  const references = (items: readonly unknown[]) => {
    const decision = items.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "origin" in item &&
        item.origin === "DECISION",
    ).length;
    const criterion = items.length - decision;
    return (
      [
        decision ? `quyết định: ${decision}` : "",
        criterion ? `tiêu chí: ${criterion}` : "",
      ]
        .filter(Boolean)
        .join(", ") || "Không có tham chiếu bổ sung"
    );
  };
  const detail = (
    rule: AssessmentReportV2Presentation["obligationDetails"][number],
    index: number,
  ) =>
    `<article class="rule" data-rule-id="${esc(rule.assessmentRuleId)}"><h3>Nghĩa vụ ${index + 1} — ${viText(ruleTitle(rule))}</h3><table class="detail"><tbody>${rows(
      [
        [
          "Nghĩa vụ pháp lý",
          rule.legalRequirements
            .map(
              (item) =>
                `<strong>${viText(item.title)}</strong><br>${viText(item.proposition)}`,
            )
            .join("<hr>"),
        ],
        [
          "Khái niệm và ý định pháp lý",
          `${viText(rule.concept)}<br><strong>Ý định:</strong> ${viText(rule.legalIntent)}`,
        ],
        ["Điều kiện áp dụng", list(rule.conditions)],
        ["Hướng dẫn áp dụng", viText(rule.applicabilityGuidance)],
        [
          "Điều kiện bổ sung và ngoại lệ",
          `${list(rule.qualifiers)}${list(rule.exceptions)}`,
        ],
        [
          "Dữ kiện quan sát",
          rule.observedFacts
            .map(
              (fact) =>
                `<div class="entity" data-fact-id="${esc(fact.factId)}"><strong>${viText(fact.statement)}</strong><br><small>Nguồn xác minh: ${viText(fact.authority)}</small></div>`,
            )
            .join("") || "—",
        ],
        [
          "Bằng chứng từ repository",
          rule.evidence
            .map(
              (item) =>
                `<div class="entity" data-evidence-id="${esc(item.evidenceId)}"><strong>${viText(item.type)}</strong><br>Vị trí: ${tx(item.safeLocator)}</div>`,
            )
            .join("") || "—",
        ],
        [
          "Kết quả đánh giá",
          `<strong>${tx(status(rule.applicability, rule.compliance))}</strong>`,
        ],
        [
          "Tiêu chí và kết quả",
          rule.criterionDecisions
            .map(
              (item) =>
                `<div class="entity" data-criterion-id="${esc(item.criterionId)}"><strong>${viText(item.statement)}</strong><br>${viText(item.outcome)}: ${viText(item.rationale)}<br><small>Tham chiếu: ${tx(references(item.references))}</small></div>`,
            )
            .join("") || "Không có tiêu chí áp dụng",
        ],
        ["Lý do kết luận", viText(rule.rationale)],
        ["Căn cứ quyết định", tx(references(rule.decisionReferences))],
        [
          "Căn cứ pháp lý",
          rule.legalReferences
            .map((item) => `${tx(item.documentId)} · ${tx(item.locator)}`)
            .join("<br>"),
        ],
        ["Việc cần thực hiện", list(rule.recommendations)],
      ],
    )}</tbody></table></article>`;
  const applicability = model.applicabilityFacts
    .map(
      (item) =>
        `<tr data-rule-id="${esc(item.assessmentRuleId)}"><td>${viText(item.conditions.join("; ") || "Phạm vi điều kiện")}</td><td>${item.facts.map((fact) => `<div class="entity" data-fact-id="${esc(fact.factId)}">${viText(fact.statement)}</div>`).join("") || "—"}</td><td>${item.evidence.map((evidence) => `<div class="entity" data-evidence-id="${esc(evidence.evidenceId)}">${viText(evidence.type)}<br>${tx(evidence.safeLocator)}</div>`).join("") || "—"}</td></tr>`,
    )
    .join("");
  const catalog = model.obligationCatalog
    .map(
      (item) =>
        `<tr data-rule-id="${esc(item.assessmentRuleId)}"><td>${item.legalRequirements.map((requirement) => `${viText(requirement.title)}<br><small>${viText(requirement.proposition)}</small>`).join("<hr>")}</td><td>${viText(item.applicability)}</td><td>${tx(status(item.applicability, item.compliance))}</td></tr>`,
    )
    .join("");
  const actions = model.actionPlan
    .map(
      (item) =>
        `<tr data-rule-id="${esc(item.assessmentRuleId)}"><td>${viText(item.obligation)}</td><td>${item.actions.map((action) => `<div>${viText(action)}</div>`).join("") || "—"}</td></tr>`,
    )
    .join("");
  const scope = rows([
    [
      "Phiên bản báo cáo",
      `${tx(model.scopeTraceability.schemaVersion)} · lần hiệu chỉnh ${tx(model.scopeTraceability.caseRevision)}`,
    ],
    [
      "Nguồn pháp lý / Bộ quy tắc",
      `${tx(model.scopeTraceability.legalSourceVersion)}<br>${tx(model.scopeTraceability.ruleSetVersion)}`,
    ],
    [
      "Kho mã nguồn được đánh giá",
      `<strong>Vị trí mã nguồn:</strong>${files.length ? list(files) : " Không có locator được ghi nhận."}<br><strong>Nội dung quan sát:</strong>${facts.length ? `<ul>${facts.map((fact) => `<li>${viText(fact)}</li>`).join("")}</ul>` : " Không có dữ kiện repository được ghi nhận."}`,
    ],
    ["Trạng thái báo cáo", tx(publicationLabel)],
    ["Giới hạn phạm vi", list(model.scopeTraceability.scopeLimitations)],
    [
      "Thông tin kỹ thuật",
      `<small>Commit: ${tx(model.scopeTraceability.repositoryCommit.slice(0, 8))}<br>Các mã định danh và hash đầy đủ nằm trong phụ lục kỹ thuật.</small>`,
    ],
  ]);
  const appendix = `<p><strong>Mã đánh giá:</strong> ${tx(model.scopeTraceability.assessmentId)}<br><strong>Mã báo cáo:</strong> ${tx(model.scopeTraceability.artifactId)}<br><strong>Commit của repository:</strong> ${tx(model.scopeTraceability.repositoryCommit)}</p>${model.obligationDetails.map((rule) => `<h3>${tx(rule.assessmentRuleId)} — ${tx(ruleTitle(rule))}</h3><table><tbody>${rows(rule.legalRequirements.map((requirement) => [tx(requirement.id), viText(requirement.title)]))}${rows(rule.evidence.map((item) => [tx(item.evidenceId), `${tx(item.safeLocator)}<br>${tx(item.contentSha256)}`]))}</tbody></table>`).join("")}<p><strong>Vị trí mã nguồn đã ghi nhận:</strong> ${tx(files.join(", "))}<br><strong>Nguồn tài liệu:</strong> ${tx(model.obligationDetails.flatMap((rule) => rule.legalReferences.map((reference) => `${reference.documentId} ${reference.locator} ${reference.contentSha256}`)).join(", "))}</p>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src 'self' data:;img-src 'none';script-src 'none';connect-src 'none"><style>@page{size:A4;margin:16mm 18mm 18mm}*{box-sizing:border-box}body{font-family:"Noto Sans",Arial,sans-serif;color:#40586b;font-size:9.5pt;line-height:1.38}h1{font-size:25pt;line-height:1.05;color:#19364c;margin:5mm 0 4mm}h2{font-size:14pt;color:#19364c;border-left:4px solid #187985;padding-left:9px;margin:9mm 0 4mm;break-after:avoid}h3{font-size:11pt;color:#fff;background:#19364c;padding:8px 10px;margin:0;break-after:avoid}.eyebrow{color:#187985;font-size:8pt;text-transform:uppercase}.meta{display:grid;grid-template-columns:1fr 1fr;gap:7px}.meta div,.status,.kpi{border:1px solid #cbd9e0;border-radius:5px}.meta div{background:#edf3f6;padding:9px;min-height:46px}.meta b{display:block;color:#187985;font-size:7pt;text-transform:uppercase}.status{background:#eaf5f4;padding:11px;margin-top:10px;color:#19364c;font-weight:600}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.kpi{text-align:center;padding:8px;background:#f5f8fa}.kpi strong{display:block;font-size:18pt;color:#19364c}.kpi span{font-size:7.5pt}table{width:100%;border-collapse:collapse;margin:4mm 0 7mm}thead{display:table-header-group}th{background:#187985;color:#fff;font-size:8pt;text-align:left;padding:7px}td{border:1px solid #cbd9e0;padding:7px;vertical-align:top}tbody tr:nth-child(even){background:#f5f8fa}small{font-size:7.3pt;color:#557080;overflow-wrap:anywhere}.entity{margin:0 0 4px}.entity+.entity{border-top:1px solid #d9e4e8;padding-top:4px}.rule{border:1px solid #cbd9e0;border-radius:6px;margin:5mm 0;break-inside:auto}.appendix{font-size:8pt}.appendix h3{font-size:9pt;padding:4px 6px}.appendix table{margin:1mm 0 2mm;font-size:7.5pt}.detail{margin:0}.detail td:first-child{width:27%;font-weight:600;color:#19364c;background:#f5f8fa}hr{border:0;border-top:1px solid #d9e4e8;margin:5px 0}ul{margin:2px 0 2px 16px;padding:0}li{margin:1px 0}</style></head><body><div class="eyebrow">LCSP / ĐÁNH GIÁ DỰA TRÊN NGUỒN VÀ BẰNG CHỨNG</div><h1>BÁO CÁO ĐÁNH GIÁ<br>NGHĨA VỤ PHÁP LÝ</h1><p>Báo cáo được lập từ các quyết định đánh giá đã được chấp thuận và nội dung kho mã nguồn đã được tiến trình thu thập, đối chiếu trong bản ghi bất biến.</p><div class="meta"><div><b>Trạng thái báo cáo</b>${tx(publicationLabel)}</div><div><b>Nguồn pháp lý / Bộ quy tắc</b>${tx(model.header.legalSourceVersion)} · ${tx(model.header.ruleSetVersion)}</div><div><b>Kho mã nguồn được đánh giá</b>${files.length ? tx(files.join(", ")) : "Không có locator"}</div><div><b>Phiên bản</b>${tx(model.header.schemaVersion)}</div></div><div class="status">${model.summary.applicableNonCompliant > 0 ? "ĐÃ GHI NHẬN NGHĨA VỤ KHÔNG ĐÁP ỨNG" : "CHƯA GHI NHẬN NGHĨA VỤ KHÔNG ĐÁP ỨNG"}<br><span style="font-weight:400">Không áp dụng không đồng nghĩa với Đáp ứng.</span></div><div class="kpis"><div class="kpi"><strong>${model.summary.totalRules}</strong><span>Tổng nghĩa vụ</span></div><div class="kpi"><strong>${model.summary.applicableCompliant}</strong><span>Áp dụng · Đáp ứng</span></div><div class="kpi"><strong>${model.summary.applicableNonCompliant}</strong><span>Áp dụng · Chưa đáp ứng</span></div><div class="kpi"><strong>${model.summary.notApplicable}</strong><span>Không áp dụng</span></div></div><h2>01 — KẾT QUẢ ĐÁNH GIÁ</h2><p>${viText(model.summary.statement === "NO_NON_COMPLIANT_FINDINGS" ? "Trong phạm vi các nghĩa vụ đã được ghim và chấp thuận, chưa ghi nhận nghĩa vụ áp dụng nhưng không đáp ứng." : "Các nghĩa vụ áp dụng nhưng không đáp ứng được liệt kê dưới đây cùng với nội dung và bằng chứng liên quan từ kho mã nguồn.")}</p>${
    model.summary.priorityIssues.length
      ? `<table><thead><tr><th>Nghĩa vụ</th><th>Vấn đề</th><th>Việc cần làm</th></tr></thead><tbody>${model.summary.priorityIssues
          .map((item) => [
            viText(item.obligation),
            viText(item.issue),
            viText(item.action),
          ])
          .map(
            (item) =>
              `<tr>${item.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table>`
      : '<p class="status">Chưa có phát hiện ưu tiên trong dữ liệu quyết định.</p>'
  }<h2>02 — DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG</h2><table><thead><tr><th>Điều kiện</th><th>Dữ kiện được xác minh</th><th>Nguồn kiểm chứng</th></tr></thead><tbody>${applicability}</tbody></table><h2>03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ</h2><table><thead><tr><th>Căn cứ và nghĩa vụ</th><th>Áp dụng?</th><th>Kết quả</th></tr></thead><tbody>${catalog}</tbody></table><h2>04 — CHI TIẾT TỪNG NGHĨA VỤ</h2>${model.obligationDetails.map(detail).join("")}<h2>05 — KẾ HOẠCH HÀNH ĐỘNG</h2>${actions ? `<table><thead><tr><th>Nghĩa vụ</th><th>Việc cần làm</th></tr></thead><tbody>${actions}</tbody></table>` : '<p class="status">Không có hành động khắc phục trong dữ liệu quyết định.</p>'}<h2>06 — PHẠM VI, GIỚI HẠN VÀ NGUỒN TRUY VẾT</h2><table><tbody>${scope}</tbody></table><section class="appendix"><h2>PHỤ LỤC — ĐĂNG KÝ KỸ THUẬT</h2><p>Các mã định danh, hash và locator đầy đủ được giữ nguyên để kiểm tra độc lập.</p>${appendix}</section></body></html>`;
}

function legacyV2Html(
  model: AssessmentReportV2Presentation,
  publicationLabel: string,
): string {
  const title = (
    r: AssessmentReportV2Presentation["obligationDetails"][number],
  ) => r.legalRequirements.map((x) => x.title).join("; ") || r.assessmentRuleId;
  const rows = (xs: string[][]) =>
    xs
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("");
  const repositoryFiles = [
    ...new Set(
      model.obligationDetails.flatMap((detail) =>
        detail.evidence
          .map((item) => item.safeLocator)
          .filter((item): item is string => Boolean(item)),
      ),
    ),
  ];
  const repositoryFacts = [
    ...new Set(
      model.obligationDetails.flatMap((detail) =>
        detail.observedFacts.map((fact) => fact.statement.trim()),
      ),
    ),
  ];
  const humanReferenceSummary = (references: readonly unknown[]) => {
    const counts = references.reduce<Record<string, number>>(
      (result, reference) => {
        const origin =
          typeof reference === "object" &&
          reference !== null &&
          "origin" in reference
            ? String(reference.origin)
            : "DECISION";
        result[origin] = (result[origin] ?? 0) + 1;
        return result;
      },
      {} as Record<string, number>,
    );
    return Object.entries(counts)
      .map(
        ([origin, count]) =>
          `${origin === "CRITERION" ? "tiêu chí" : "quyết định"}: ${count}`,
      )
      .join(", ");
  };
  const rule = (
    r: AssessmentReportV2Presentation["obligationDetails"][number],
    index: number,
  ) =>
    `<article class="rule" data-rule-id="${esc(r.assessmentRuleId)}"><h3>Nghĩa vụ ${index + 1} — ${tx(title(r))}</h3><table class="detail"><tbody>${rows(
      [
        [
          "Nghĩa vụ pháp lý",
          r.legalRequirements
            .map(
              (x) => `<strong>${tx(x.title)}</strong><br>${tx(x.proposition)}`,
            )
            .join("<hr>"),
        ],
        [
          "Khái niệm và ý định pháp lý",
          `${tx(r.concept)}<br><strong>Ý định:</strong> ${tx(r.legalIntent)}`,
        ],
        ["Điều kiện áp dụng", ul(r.conditions)],
        ["Hướng dẫn áp dụng", tx(r.applicabilityGuidance)],
        [
          "Hướng dẫn, điều kiện bổ sung",
          `${ul(r.qualifiers)}${ul(r.exceptions)}`,
        ],
        [
          "Dữ kiện quan sát",
          r.observedFacts
            .map(
              (f) =>
                `<div class="entity" data-fact-id="${esc(f.factId)}"><strong>${tx(f.statement)}</strong><br><small>Nguồn xác minh: ${tx(f.authority)}</small></div>`,
            )
            .join("") || "—",
        ],
        [
          "Bằng chứng gắn với rule",
          r.evidence
            .map(
              (e) =>
                `<div class="entity" data-evidence-id="${esc(e.evidenceId)}"><strong>${tx(e.type)}</strong><br>Vị trí trong repository: ${tx(e.safeLocator)}</div>`,
            )
            .join("") || "—",
        ],
        [
          "Kết quả đánh giá",
          `<span data-field="applicability">${tx(r.applicability)}</span> · <span data-field="compliance">${tx(status(r.applicability, r.compliance))}</span>`,
        ],
        [
          "Tiêu chí và kết quả",
          r.criterionDecisions
            .map(
              (c) =>
                `<div class="entity criterion" data-criterion-id="${esc(c.criterionId)}"><strong>${tx(c.statement)}</strong><br><span>${tx(c.outcome)}</span>: ${tx(c.rationale)}<br><small>Tham chiếu: ${tx(humanReferenceSummary(c.references))}</small></div>`,
            )
            .join("") || "Không có tiêu chí áp dụng",
        ],
        ["Lý do kết luận", tx(r.rationale)],
        ["Căn cứ quyết định", tx(humanReferenceSummary(r.decisionReferences))],
        [
          "Căn cứ nguồn",
          r.legalReferences
            .map(
              (x) =>
                `<div>${tx(x.documentId)} · ${tx(x.locator)}<br><small>${tx(x.contentSha256)}</small></div>`,
            )
            .join(""),
        ],
        ["Việc cần thực hiện", ul(r.recommendations)],
      ],
    )}</tbody></table></article>`;
  const facts = model.applicabilityFacts
    .map(
      (x) =>
        `<tr data-rule-id="${esc(x.assessmentRuleId)}"><td><strong>${tx(x.conditions.join("; ") || "Phạm vi điều kiện")}</strong></td><td>${x.facts.map((f) => `<div class="entity" data-fact-id="${esc(f.factId)}">${tx(f.statement)}<br><small>Nguồn xác minh: ${tx(f.authority)}</small></div>`).join("")}</td><td>${x.evidence.map((e) => `<div class="entity" data-evidence-id="${esc(e.evidenceId)}">${tx(e.type)}<br>${tx(e.safeLocator)}</div>`).join("")}</td></tr>`,
    )
    .join("");
  const catalog = model.obligationCatalog
    .map(
      (x) =>
        `<tr data-rule-id="${esc(x.assessmentRuleId)}"><td>${x.legalRequirements.map((r) => `${tx(r.title)}<br><small>${tx(r.proposition)}</small>`).join("<hr>")}</td><td>${tx(x.applicability)}</td><td>${tx(status(x.applicability, x.compliance))}</td></tr>`,
    )
    .join("");
  const actions = model.actionPlan
    .map(
      (x) =>
        `<tr data-rule-id="${esc(x.assessmentRuleId)}"><td>${tx(x.obligation)}</td><td>${ul(x.actions)}</td><td>Chưa có dữ liệu</td></tr>`,
    )
    .join("");
  const scope = rows([
    [
      "Mã đánh giá / Mã báo cáo",
      `${tx(model.scopeTraceability.assessmentId)}<br>${tx(model.scopeTraceability.artifactId)}`,
    ],
    [
      "Phiên bản lược đồ / Phiên bản hồ sơ",
      `${tx(model.scopeTraceability.schemaVersion)} · ${tx(model.scopeTraceability.caseRevision)}`,
    ],
    [
      "Nguồn pháp lý / Bộ quy tắc",
      `${tx(model.scopeTraceability.legalSourceVersion)} (${tx(model.scopeTraceability.legalSourceVersionId)})<br>${tx(model.scopeTraceability.ruleSetVersion)} (${tx(model.scopeTraceability.ruleSetVersionId)})`,
    ],
    [
      "Ảnh chụp kho mã / commit",
      `${tx(model.scopeTraceability.repositorySnapshotId)}<br>${tx(model.scopeTraceability.repositoryCommit)}`,
    ],
    ["Trạng thái phát hành", tx(publicationLabel)],
    ["Giới hạn phạm vi", ul(model.scopeTraceability.scopeLimitations)],
    [
      "Mã truy vết",
      `<small>Yêu cầu: ${tx(model.scopeTraceability.legalRequirementIds.join(", "))}<br>Quy tắc: ${tx(model.scopeTraceability.assessmentRuleIds.join(", "))}<br>Dữ kiện: ${tx(model.scopeTraceability.factIds.join(", "))}<br>Bằng chứng: ${tx(model.scopeTraceability.evidenceIds.join(", "))}</small>`,
    ],
  ]);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src 'self' data:;img-src 'none';script-src 'none';connect-src 'none'"><style>@page{size:A4;margin:16mm 18mm 18mm}*{box-sizing:border-box}body{font-family:"Noto Sans",Arial,sans-serif;color:#40586b;font-size:9.5pt;line-height:1.38}h1{font-size:25pt;line-height:1.05;color:#19364c;margin:5mm 0 4mm}h2{font-size:14pt;color:#19364c;border-left:4px solid #187985;padding-left:9px;margin:9mm 0 4mm;break-after:avoid}h3{font-size:11pt;color:#fff;background:#19364c;padding:8px 10px;margin:0;break-after:avoid}.eyebrow{color:#187985;font-size:8pt;text-transform:uppercase}.meta{display:grid;grid-template-columns:1fr 1fr;gap:7px}.meta div,.status,.kpi{border:1px solid #cbd9e0;border-radius:5px}.meta div{background:#edf3f6;padding:9px;min-height:46px}.meta b{display:block;color:#187985;font-size:7pt;text-transform:uppercase}.status{background:#eaf5f4;padding:11px;margin-top:10px;color:#19364c;font-weight:600}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.kpi{text-align:center;padding:8px;background:#f5f8fa}.kpi strong{display:block;font-size:18pt;color:#19364c}.kpi span{font-size:7.5pt}table{width:100%;border-collapse:collapse;margin:4mm 0 7mm}thead{display:table-header-group}th{background:#187985;color:#fff;font-size:8pt;text-align:left;padding:7px}td{border:1px solid #cbd9e0;padding:7px;vertical-align:top}tbody tr:nth-child(even){background:#f5f8fa}small{font-size:7.3pt;color:#557080;overflow-wrap:anywhere}.entity{margin:0 0 4px}.entity+.entity{border-top:1px solid #d9e4e8;padding-top:4px}.rule{border:1px solid #cbd9e0;border-radius:6px;margin:5mm 0;break-inside:auto}.appendix{font-size:8pt}.appendix h3{font-size:9pt;padding:4px 6px}.appendix table{margin:1mm 0 2mm;font-size:7.5pt}.detail{margin:0}.detail td:first-child{width:27%;font-weight:600;color:#19364c;background:#f5f8fa}hr{border:0;border-top:1px solid #d9e4e8;margin:5px 0}ul{margin:2px 0 2px 16px;padding:0}li{margin:1px 0}</style></head><body><div class="eyebrow">LCSP / ĐÁNH GIÁ DỰA TRÊN NGUỒN VÀ BẰNG CHỨNG</div><h1>BÁO CÁO ĐÁNH GIÁ<br>NGHĨA VỤ PHÁP LÝ</h1><p>Báo cáo được lập từ các quyết định đánh giá đã được chấp thuận và nguồn pháp lý được ghim trong artifact bất biến.</p><div class="meta"><div><b>Đối tượng / Assessment</b>${tx(model.header.assessmentId)}</div><div><b>Nguồn pháp lý / Rule set</b>${tx(model.header.legalSourceVersion)} · ${tx(model.header.ruleSetVersion)}</div><div><b>Repository snapshot</b>${tx(model.header.repositorySnapshotId)}</div><div><b>Trạng thái báo cáo</b>${tx(publicationLabel)} · ${tx(model.header.schemaVersion)}</div></div><div class="status">${model.summary.applicableNonCompliant > 0 ? "ĐÃ GHI NHẬN NGHĨA VỤ KHÔNG ĐÁP ỨNG" : "CHƯA GHI NHẬN NGHĨA VỤ KHÔNG ĐÁP ỨNG"}<br><span style="font-weight:400">Kết luận chỉ phản ánh các rule đã được đánh giá; Không áp dụng không đồng nghĩa với Đáp ứng.</span></div><div class="kpis"><div class="kpi"><strong>${model.summary.totalRules}</strong><span>Tổng số rule</span></div><div class="kpi"><strong>${model.summary.applicableCompliant}</strong><span>Áp dụng · Đáp ứng</span></div><div class="kpi"><strong>${model.summary.applicableNonCompliant}</strong><span>Áp dụng · Chưa đáp ứng</span></div><div class="kpi"><strong>${model.summary.notApplicable}</strong><span>Không áp dụng</span></div></div><h2>01 — KẾT QUẢ ĐÁNH GIÁ</h2><p>${tx(model.summary.statement === "NO_NON_COMPLIANT_FINDINGS" ? "Trong phạm vi các rule đã được ghim và chấp thuận, chưa ghi nhận nghĩa vụ áp dụng nhưng không đáp ứng." : "Các nghĩa vụ áp dụng nhưng không đáp ứng được liệt kê dưới đây; nội dung chỉ phản ánh quyết định đã chấp thuận.")}</p>${model.summary.priorityIssues.length ? `<table><thead><tr><th>Nghĩa vụ</th><th>Vấn đề được ghi nhận</th><th>Việc cần làm</th></tr></thead><tbody>${rows(model.summary.priorityIssues.map((x) => [tx(x.obligation), tx(x.issue), tx(x.action)]))}</tbody></table>` : '<p class="status">Chưa có phát hiện ưu tiên được hỗ trợ trong dữ liệu quyết định.</p>'}<h2>02 — DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG</h2><table><thead><tr><th>ĐIỀU KIỆN CẦN LÀM RÕ</th><th>DỮ KIỆN ĐƯỢC XÁC MINH</th><th>NGUỒN KIỂM CHỨNG</th></tr></thead><tbody>${facts}</tbody></table><h2>03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ</h2><table><thead><tr><th>CĂN CỨ VÀ NGHĨA VỤ</th><th>MÃ RULE</th><th>ÁP DỤNG?</th><th>TUÂN THỦ?</th></tr></thead><tbody>${catalog}</tbody></table><h2>04 — CHI TIẾT TỪNG NGHĨA VỤ</h2>${model.obligationDetails.map(rule).join("")}<h2>05 — KẾ HOẠCH HÀNH ĐỘNG</h2>${actions ? `<table><thead><tr><th>RULE</th><th>NGHĨA VỤ</th><th>VIỆC CẦN LÀM</th><th>ĐẦU MỐI / THỜI HẠN</th></tr></thead><tbody>${actions}</tbody></table>` : '<p class="status">Không có hành động khắc phục được hỗ trợ trong dữ liệu quyết định.</p>'}<h2>06 — PHẠM VI, GIỚI HẠN VÀ NGUỒN TRUY VẾT</h2><table><tbody>${scope}</tbody></table><section class="appendix"><h2>PHỤ LỤC — ĐĂNG KÝ KỸ THUẬT</h2><p>Các mã định danh, hash và locator đầy đủ được giữ nguyên để kiểm tra độc lập.</p>${model.obligationDetails.map((r) => `<h3>${tx(r.assessmentRuleId)} — ${tx(title(r))}</h3><table><tbody>${rows(r.evidence.map((e) => [tx(e.evidenceId), `${tx(e.safeLocator)}<br>${tx(e.contentSha256)}`]))}</tbody></table>`).join("")}</section></body></html>`;
}

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
  async onModuleDestroy(): Promise<void> {
    const browser = await this.browserPromise?.catch(() => undefined);
    await browser?.close().catch(() => undefined);
    this.browserPromise = undefined;
  }
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
