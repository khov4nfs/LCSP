import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_FACT_AUTHORITIES } from "@lcsp/contracts/assessment-domain";
import type { AssessmentReportV2Presentation } from "@lcsp/contracts/assessment-report";
import {
  buildReportReferenceIndex,
  contentInVietnameseOrAppendix,
  criterionPresentation,
  decisionReferenceLabels,
  factEvidenceLabels,
  factPresentation,
  legalDocumentName,
  legalLocator,
  localizeReportText,
  localizedApplicability,
  localizedApplicabilityMode,
  localizedCompliance,
  localizedCriterionOutcome,
  localizedEvidenceType,
  reportDecisionExplanation,
  ruleTitleInVietnamese,
  sourceLabelsForRule,
  type ReportTranslationCatalog,
} from "./assessment-report-v2-pdf-presentation.js";

type RenderOptions = {
  preview?: boolean;
  translations?: ReportTranslationCatalog;
};
type RulePresentation =
  AssessmentReportV2Presentation["obligationDetails"][number];

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
  `<table class="${className}"><thead><tr>${headers.map((item) => `<th>${inline(item)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const badge = (label: string, variant: "positive" | "negative" | "neutral") =>
  `<span class="badge ${variant}">${inline(label)}</span>`;
const ruleTitle = (
  rule: RulePresentation,
  refs: ReturnType<typeof buildReportReferenceIndex>,
  translations: ReportTranslationCatalog,
) => inline(ruleTitleInVietnamese(rule, refs, translations));

function applicabilityRow(
  rule: RulePresentation,
  refs: ReturnType<typeof buildReportReferenceIndex>,
  translations: ReportTranslationCatalog,
) {
  const ruleRef = refs.ruleReference(rule.assessmentRuleId);
  const conditions = rule.conditions.map((item) =>
    contentInVietnameseOrAppendix(
      item,
      refs,
      `Điều kiện đã ghi nhận cho ${ruleRef}`,
      translations,
    ),
  );
  const facts = rule.observedFacts.map(
    (fact) =>
      `<div class="reference-item"><span class="ref">[${inline(refs.factReference(fact.factId))}]</span> ${inline(factPresentation(fact, refs, translations))}${factEvidenceLabels(
        fact,
        refs,
      )
        .map((ref) => ` <span class="ref">[${inline(ref)}]</span>`)
        .join("")}</div>`,
  );
  const evidence = rule.evidence.map(
    (item) =>
      `<div class="reference-item"><span class="ref">[${inline(refs.evidenceReference(item.evidenceId))}]</span> ${inline(localizedEvidenceType(item.type))}${item.safeLocator ? ` · ${inline(item.safeLocator)}` : ""}</div>`,
  );
  const acceptedApplicabilityRationale = localizeReportText(
    rule.rationale,
    translations,
  );
  const applicabilityBasis =
    rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE &&
    acceptedApplicabilityRationale
      ? `<p><strong>Căn cứ không áp dụng:</strong> ${inline(acceptedApplicabilityRationale)}</p>`
      : conditions.length
        ? list(conditions)
        : `<span class="muted">Không có điều kiện riêng được ghi nhận.</span>`;
  return [
    `<strong>${inline(ruleRef)}</strong><br>${ruleTitle(rule, refs, translations)}`,
    `${badge(localizedApplicability(rule.applicability), rule.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE ? "positive" : "neutral")}<div>${applicabilityBasis}</div>`,
    facts.join("") ||
      `<span class="muted">Chưa có dữ kiện được trích dẫn.</span>`,
    evidence.join("") ||
      `<span class="muted">Chưa có bằng chứng được trích dẫn.</span>`,
  ];
}

function ruleDetail(
  rule: RulePresentation,
  refs: ReturnType<typeof buildReportReferenceIndex>,
  translations: ReportTranslationCatalog,
) {
  const ruleRef = refs.ruleReference(rule.assessmentRuleId);
  const sourceLabels = sourceLabelsForRule(rule, refs);
  const linkedSources = rule.legalReferences.map((source) => {
    const ref = refs.legalReference(source);
    return `<div class="reference-item"><span class="ref">[${inline(ref)}]</span> ${inline(legalDocumentName(source.documentId))} · ${inline(legalLocator(source.locator))}</div>`;
  });
  const requirements = rule.legalRequirements.map((requirement) => {
    const localizedTitle = contentInVietnameseOrAppendix(
      requirement.title,
      refs,
      `Chưa có tiêu đề tiếng Việt đã xác minh ${sourceLabels.map((item) => `[${item}]`).join(", ")}`,
      translations,
    );
    const proposition = contentInVietnameseOrAppendix(
      requirement.proposition,
      refs,
      `Chưa có bản dịch tiếng Việt đã xác minh; nội dung gốc được giữ ở phụ lục kỹ thuật.`,
      translations,
    );
    return `<div class="obligation"><strong>${inline(localizedTitle)}</strong><p>${inline(proposition)}</p></div>`;
  });
  const applicabilityText = localizedApplicability(rule.applicability);
  const complianceText = localizedCompliance(
    rule.applicability,
    rule.compliance,
  );
  const rationaleRef = refs.textReference(rule.rationale);
  const rationale = contentInVietnameseOrAppendix(
    rule.rationale,
    refs,
    `Chưa có bản dịch tiếng Việt đã xác minh cho lý do đã chấp nhận${rationaleRef ? ` [${rationaleRef}]` : ""}.`,
    translations,
  );
  const factRows = rule.observedFacts.map((fact) => {
    const factRef = refs.factReference(fact.factId);
    const evidenceRefs = factEvidenceLabels(fact, refs);
    return `<div class="fact-card"><strong>[${inline(factRef)}] ${inline(localizedFactAuthority(fact.authority))}</strong><p>${inline(factPresentation(fact, refs, translations))}</p>${evidenceRefs.length ? `<small>Bằng chứng liên quan: ${evidenceRefs.map((item) => `[${inline(item)}]`).join(" · ")}</small>` : ""}</div>`;
  });
  const evidenceRows = rule.evidence.map(
    (item) =>
      `<div class="evidence-card"><strong>[${inline(refs.evidenceReference(item.evidenceId))}] ${inline(localizedEvidenceType(item.type))}</strong>${item.safeLocator ? `<div>Vị trí trong kho mã: <code>${inline(item.safeLocator)}</code></div><small>Đường dẫn là tham chiếu trong phạm vi kiểm tra; tự nó không chứng minh kết luận pháp lý.</small>` : ""}</div>`,
  );
  const criteriaRows = rule.criterionDecisions.map((criterion) => {
    const criterionText = contentInVietnameseOrAppendix(
      criterionPresentation(
        criterion,
        refs,
        ruleRef,
        translations,
        rule.legalRequirements,
      ),
      refs,
      `Chưa có bản dịch tiếng Việt đã xác minh cho tiêu chí ${refs.criterionReference(rule.assessmentRuleId, criterion.criterionId)}.`,
      translations,
    );
    const refsForCriterion = decisionReferenceLabels(
      criterion.references,
      refs,
    );
    const originalRationale = refs.textReference(criterion.rationale);
    const criterionReason = contentInVietnameseOrAppendix(
      criterion.rationale,
      refs,
      `Chưa có bản dịch tiếng Việt đã xác minh cho lý do tiêu chí${originalRationale ? ` [${originalRationale}]` : ""}.`,
      translations,
    );
    return [
      `<strong>${inline(criterionText)}</strong><br><small>Mã tiêu chí [${inline(refs.criterionReference(rule.assessmentRuleId, criterion.criterionId))}]</small>`,
      badge(
        localizedCriterionOutcome(criterion.outcome),
        criterion.outcome === RULE_DECISION_CRITERION_OUTCOMES.MET
          ? "positive"
          : criterion.outcome === RULE_DECISION_CRITERION_OUTCOMES.NOT_MET
            ? "negative"
            : "neutral",
      ),
      `${inline(criterionReason)}<br><small>Nghĩa vụ liên quan: ${sourceLabels.map((item) => `[${inline(item)}]`).join(" · ") || "Chưa có nguồn pháp lý"}${refsForCriterion.length ? `<br>Dữ kiện/bằng chứng: ${refsForCriterion.map((item) => `[${inline(item)}]`).join(" · ")}` : ""}</small>`,
    ];
  });
  const recommendations = rule.recommendations.map((item) =>
    contentInVietnameseOrAppendix(
      item,
      refs,
      `Khuyến nghị đã ghi nhận${refs.textReference(item) ? ` [${refs.textReference(item)}]` : ""} được lưu nguyên văn trong phụ lục.`,
      translations,
    ),
  );
  const applicabilityReason =
    rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      ? `Dữ kiện đã chấp nhận cho thấy chủ thể được đánh giá không thuộc nhóm đối tượng điều chỉnh. Vì vậy nghĩa vụ không áp dụng; báo cáo không xếp nghĩa vụ là đáp ứng hay chưa đáp ứng.${rationaleRef ? ` Căn cứ chi tiết: [${rationaleRef}].` : ""}`
      : `Trạng thái áp dụng thực tế được giữ nguyên theo quyết định đã chấp nhận và được phân biệt với chế độ áp dụng trong định nghĩa quy tắc.${rationaleRef ? " Lý do được trình bày cùng kết quả đánh giá." : ""}`;
  const mappingRefs = [
    ...sourceLabels.map((item) => `[${item}]`),
    ...rule.observedFactIds
      .map((item) => refs.factReference(item))
      .filter(Boolean)
      .map((item) => `[${item}]`),
    ...rule.evidenceIds
      .map((item) => refs.evidenceReference(item))
      .filter(Boolean)
      .map((item) => `[${item}]`),
  ];
  return `<article class="rule-card" data-rule-ref="${escapeHtml(ruleRef)}"><header class="rule-heading"><div><p class="eyebrow">Quy tắc đánh giá ${inline(ruleRef)}</p><h3>${ruleTitle(rule, refs, translations)}</h3></div><div class="status-badges">${badge(applicabilityText, rule.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE ? "positive" : "neutral")}${badge(complianceText, rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT ? "positive" : rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT ? "negative" : "neutral")}</div></header><div class="rule-content"><section><h4>1. Nghĩa vụ và căn cứ pháp lý</h4>${requirements.join("")}${linkedSources.join("") || `<p class="muted">Không có nguồn pháp lý được ghi nhận.</p>`}</section><section><h4>2. Phạm vi áp dụng</h4><p><strong>Chế độ trong định nghĩa quy tắc:</strong> ${inline(localizedApplicabilityMode(rule.applicabilityGuidance))}</p><p>${inline(applicabilityReason)}</p>${rule.conditions.length ? list(rule.conditions.map((item) => contentInVietnameseOrAppendix(item, refs, `Điều kiện đã ghi nhận cho ${ruleRef}`, translations))) : `<p class="muted">Không có điều kiện riêng được ghi nhận trong định nghĩa quy tắc.</p>`}${rule.qualifiers.length || rule.exceptions.length ? `<p><strong>Điều kiện bổ sung:</strong> ${inline(rule.qualifiers.map((item) => contentInVietnameseOrAppendix(item, refs, "Chưa có bản dịch đã xác minh.", translations)).join("; ") || "Không có")}</p><p><strong>Ngoại lệ:</strong> ${inline(rule.exceptions.map((item) => contentInVietnameseOrAppendix(item, refs, "Chưa có bản dịch đã xác minh.", translations)).join("; ") || "Không có")}</p>` : ""}</section><section><h4>3. Dữ kiện và bằng chứng liên quan</h4>${factRows.join("") || `<p class="muted">Không có dữ kiện được trích dẫn cho quy tắc này.</p>`}${evidenceRows.join("") || `<p class="muted">Không có bằng chứng được trích dẫn cho quy tắc này.</p>`}</section><section><h4>4. Tiêu chí đánh giá</h4>${criteriaRows.length ? table(["Tiêu chí", "Kết quả", "Căn cứ"], criteriaRows, "criteria-table") : `<p class="muted">Không có tiêu chí được ghi nhận trong quyết định này.</p>`}</section><section class="conclusion"><h4>5. Kết quả và căn cứ kết luận</h4><p>${inline(reportDecisionExplanation(rule))}</p><p>${inline(rationale)}</p><p class="mapping"><strong>Liên kết dữ liệu:</strong> ${mappingRefs.length ? mappingRefs.map((item) => `<span class="ref">${inline(item)}</span>`).join(" · ") : "Không có tham chiếu bổ sung."}</p></section>${recommendations.length ? `<section><h4>6. Kiến nghị đã ghi nhận</h4>${list(recommendations)}</section>` : ""}</div></article>`;
}

function localizedFactAuthority(authority: string): string {
  if (authority === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED)
    return "Do người dùng cung cấp";
  if (authority === ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED)
    return "Liên kết với bằng chứng được trích dẫn";
  return "Dữ kiện đã được ghi nhận";
}

export function assessmentReportV2Html(
  model: AssessmentReportV2Presentation,
  options: RenderOptions = {},
): string {
  const translations = options.translations ?? {};
  const refs = buildReportReferenceIndex(model, translations);
  const detailByRule = new Map(
    model.obligationDetails.map((rule) => [rule.assessmentRuleId, rule]),
  );
  const applicabilityRows = model.obligationDetails.map((rule) =>
    applicabilityRow(rule, refs, translations),
  );
  const factsRows = applicabilityRows;
  const applicabilityTable = `<table><thead><tr>${["Quy tắc / nghĩa vụ", "Khả năng áp dụng", "Dữ kiện được ghi nhận", "Bằng chứng được trích dẫn"].map((item) => `<th>${inline(item)}</th>`).join("")}</tr></thead><tbody>${applicabilityRows.join("")}</tbody></table>`;
  const catalogRows = model.obligationCatalog.map((item) => {
    const rule = detailByRule.get(item.assessmentRuleId);
    if (!rule) return ["", "", "", ""];
    const sourceLabels = sourceLabelsForRule(rule, refs);
    return [
      `<strong>${inline(refs.ruleReference(item.assessmentRuleId))}</strong><br>${ruleTitle(rule, refs, translations)}<br><small>Căn cứ: ${sourceLabels.map((ref) => `[${inline(ref)}]`).join(" · ") || "Chưa có nguồn"}</small>`,
      badge(
        localizedApplicability(item.applicability),
        item.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE
          ? "positive"
          : "neutral",
      ),
      badge(
        localizedCompliance(item.applicability, item.compliance),
        item.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
          ? "positive"
          : item.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
            ? "negative"
            : "neutral",
      ),
      inline(refs.ruleReference(item.assessmentRuleId)),
    ];
  });
  const issueRows = model.obligationDetails
    .filter(
      (rule) =>
        rule.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE &&
        rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    )
    .map((rule) => [
      ruleTitle(rule, refs, translations),
      inline(reportDecisionExplanation(rule)),
      rule.recommendations.length
        ? inline(
            rule.recommendations
              .map((item) =>
                contentInVietnameseOrAppendix(
                  item,
                  refs,
                  `Khuyến nghị gốc ${refs.textReference(item) ? `[${refs.textReference(item)}]` : ""} ở phụ lục`,
                  translations,
                ),
              )
              .join("; "),
          )
        : "Chưa có kiến nghị được ghi nhận.",
    ]);
  const actionsRows = model.actionPlan.flatMap((action) => {
    const rule = detailByRule.get(action.assessmentRuleId);
    if (!rule) return [];
    return action.actions.map((item) => [
      `<strong>${inline(refs.ruleReference(action.assessmentRuleId))}</strong><br>${ruleTitle(rule, refs, translations)}`,
      inline(
        contentInVietnameseOrAppendix(
          item,
          refs,
          `Nội dung khuyến nghị được lưu nguyên văn tại ${refs.textReference(item) ? `[${refs.textReference(item)}]` : "phụ lục"}.`,
          translations,
        ),
      ),
    ]);
  });
  const scopeLimitations = model.scopeTraceability.scopeLimitations.map(
    (item) =>
      contentInVietnameseOrAppendix(
        item,
        refs,
        `Giới hạn được lưu nguyên văn tại ${refs.textReference(item) ? `[${refs.textReference(item)}]` : "phụ lục"}.`,
        translations,
      ),
  );
  const sourceRows = refs.sources.map((source) => [
    `<strong>[${inline(source.reference)}]</strong> ${inline(source.documentName)}<br>${inline(source.locator)}`,
    `${inline(source.documentId)}<br><small>${inline(source.sourceLocator)}</small>`,
    inline(source.sourceHash),
  ]);
  const ruleMappingRows = refs.ruleMappings.map((item) => [
    `<strong>${inline(item.reference)}</strong>`,
    inline(item.id),
  ]);
  const criterionMappingRows = refs.criterionMappings.map((item) => [
    `<strong>${inline(item.reference)}</strong>`,
    inline(item.ruleReference),
    inline(item.id),
  ]);
  const criterionMappingTable = refs.criterionMappings.length
    ? `<h3>Tiêu chí</h3>${table(["Mã hiển thị", "Quy tắc", "Mã tiêu chí gốc"], criterionMappingRows, "compact")}`
    : "";
  const factRows = refs.facts.map((fact) => [
    `<strong>[${inline(fact.reference)}]</strong> ${inline(fact.authority)}`,
    inline(fact.id),
  ]);
  const evidenceRows = refs.evidence.map((evidence) => [
    `<strong>[${inline(evidence.reference)}]</strong> ${inline(evidence.type)}${evidence.locator ? `<br><code>${inline(evidence.locator)}</code>` : ""}`,
    `${inline(evidence.id)}<br><small>${inline(evidence.contentHash)}</small>`,
  ]);
  const originalRows = refs.technicalTexts.map(
    (item) =>
      `<div class="original-record"><strong>[${inline(item.reference)}]</strong> · ${inline(item.ruleReference)} · ${inline(item.field)}<div class="original-text">${inline(item.original)}</div></div>`,
  );
  const previewBanner = options.preview
    ? `<div class="preview-banner">BẢN XEM TRƯỚC — DỮ LIỆU MINH HỌA</div>`
    : "";
  const publication = options.preview
    ? "Bản xem trước; chưa phát hành"
    : "Đã phát hành";
  const nonApplicableNote = `<p class="note">“Không áp dụng” là trạng thái về phạm vi; không được tính là “Đáp ứng”.</p>`;
  const mainFindings = issueRows.length
    ? table(["Nghĩa vụ", "Kết quả đã ghi nhận", "Kiến nghị"], issueRows)
    : `<p class="note">Trong các nghĩa vụ áp dụng được ghi trong báo cáo, chưa có kết quả “Chưa đáp ứng”.</p>`;
  const technicalAppendix = `<section class="appendix"><h2>Phụ lục — Bảng truy vết kỹ thuật</h2><p>Mã ngắn trong phần chính quy chiếu duy nhất tới các định danh và dấu kiểm tra bên dưới. Văn bản gốc không được dịch hoặc sửa trong dữ liệu đánh giá.</p><h3>Phiên bản và ghim dữ liệu</h3>${table(
    ["Trường", "Giá trị"],
    [
      ["Mã đánh giá:", inline(model.scopeTraceability.assessmentId)],
      ["Mã artifact", inline(model.scopeTraceability.artifactId)],
      ["Phiên bản báo cáo", inline(model.scopeTraceability.schemaVersion)],
      ["Lần hiệu chỉnh hồ sơ", inline(model.scopeTraceability.caseRevision)],
      [
        "Phiên bản nguồn pháp lý",
        `${inline(model.scopeTraceability.legalSourceVersion)} · ${inline(model.scopeTraceability.legalSourceVersionId)}`,
      ],
      [
        "Phiên bản bộ quy tắc",
        `${inline(model.scopeTraceability.ruleSetVersion)} · ${inline(model.scopeTraceability.ruleSetVersionId)}`,
      ],
      [
        "Bản chụp kho mã nguồn",
        inline(model.scopeTraceability.repositorySnapshotId),
      ],
      ["Commit kho mã", inline(model.scopeTraceability.repositoryCommit)],
    ],
    "compact",
  )}${criterionMappingTable}<h3>Quy tắc</h3>${table(["Mã hiển thị", "Mã quy tắc gốc"], ruleMappingRows, "compact")}${refs.sources.length ? `<h3>Nguồn pháp lý</h3>${table(["Nguồn", "Mã tài liệu", "Dấu kiểm tra nguồn"], sourceRows, "compact")}` : ""}${refs.facts.length ? `<h3>Dữ kiện</h3>${table(["Mã hiển thị", "Mã dữ kiện gốc"], factRows, "compact")}` : ""}${refs.evidence.length ? `<h3>Bằng chứng</h3>${table(["Mã hiển thị", "Mã bằng chứng gốc"], evidenceRows, "compact")}` : ""}${originalRows.length ? `<h3>Nguyên văn cần đối chiếu</h3>${originalRows.join("")}` : ""}</section>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src 'self' data:;img-src 'none';script-src 'none';connect-src 'none'"><style>
@page{size:A4;margin:15mm 16mm 17mm}*{box-sizing:border-box}body{font-family:"Noto Sans",Arial,sans-serif;color:#40586b;font-size:9.5pt;line-height:1.42;margin:0}h1{font-size:24pt;line-height:1.08;color:#19364c;margin:4mm 0}h2{font-size:14pt;color:#19364c;border-left:4px solid #187985;padding-left:9px;margin:8mm 0 3mm;break-after:avoid}h3{font-size:11pt;color:#19364c;margin:4mm 0 2mm;break-after:avoid}h4{font-size:10pt;color:#19364c;margin:0 0 2mm;break-after:avoid}p{margin:2mm 0 3mm}small,.muted{font-size:8pt;color:#607989}.eyebrow{color:#187985;font-size:8pt;text-transform:uppercase;letter-spacing:.04em}.preview-banner{border:1px solid #cf8a24;background:#fff5df;color:#744e10;padding:8px 10px;font-weight:700;margin:0 0 5mm}.lead{font-size:10pt;color:#354f63}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px}.meta-card{border:1px solid #cbd9e0;border-radius:4px;background:#edf3f6;padding:8px;min-width:0}.meta-card strong{display:block;color:#187985;font-size:7.5pt;text-transform:uppercase;margin-bottom:2px}.status-summary{border:1px solid #9dcac5;background:#edf8f6;border-radius:4px;padding:10px;margin:4mm 0;color:#19364c}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:4mm 0}.kpi{border:1px solid #cbd9e0;background:#f5f8fa;text-align:center;padding:7px 3px;border-radius:4px}.kpi strong{display:block;font-size:17pt;color:#19364c}.kpi span{font-size:7.3pt}.note{border-left:3px solid #187985;padding:6px 9px;background:#f2f7f9}.badge{display:inline-block;border:1px solid;border-radius:12px;padding:3px 8px;font-size:8pt;font-weight:700;white-space:normal}.badge.positive{color:#17665f;border-color:#88c5b7;background:#eaf7f3}.badge.negative{color:#9a2c2c;border-color:#d99a9a;background:#fff0ee}.badge.neutral{color:#5b6570;border-color:#b8c3ca;background:#f4f6f7}.status-badges{display:flex;flex-direction:column;gap:5px;align-items:flex-start;max-width:145px}.ref{font-weight:700;color:#14747d;white-space:nowrap}.reference-item{margin:1mm 0;overflow-wrap:anywhere}.rule-card{border:1px solid #cbd9e0;border-radius:5px;margin:4mm 0 6mm;break-inside:auto}.rule-card+.rule-card{break-before:page}.rule-heading{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;background:#f3f7f8;padding:9px;border-bottom:1px solid #cbd9e0;break-after:avoid}.rule-heading h3{margin:0}.rule-heading .eyebrow{margin:0 0 2px}.rule-content{padding:9px}.rule-content section{margin:0 0 5mm;break-inside:auto}.rule-content section+section{border-top:1px solid #e1e8eb;padding-top:4mm}.obligation{border-left:2px solid #187985;padding-left:8px;margin:2mm 0}.obligation p{margin-bottom:0}.fact-card,.evidence-card{border:1px solid #d7e1e5;border-radius:4px;padding:7px;margin:2mm 0;break-inside:avoid}.fact-card p{margin:1mm 0}.conclusion{background:#f4f8f9;padding:8px;border-radius:4px}.mapping{font-size:8pt;color:#456172}.criteria-table{font-size:8.5pt}.criteria-table td:nth-child(2){width:22%}.criteria-table td:nth-child(3){width:38%}table{width:100%;border-collapse:collapse;margin:3mm 0 5mm;table-layout:fixed;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th{background:#187985;color:#fff;font-size:8pt;text-align:left;padding:6px}td{border:1px solid #cbd9e0;padding:6px;vertical-align:top;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f6f9fa}ul{margin:1mm 0 2mm 5mm;padding-left:4mm}li{margin:1mm 0}.appendix{break-before:page}.appendix h2{margin-top:0}.appendix h3{font-size:9.5pt;background:#edf3f6;padding:5px 7px}.compact{font-size:7.5pt;margin:2mm 0 4mm}.compact th,.compact td{padding:4px}.original-record{border-top:1px solid #cbd9e0;padding:2mm 1mm;margin:0;break-inside:avoid}.original-record:first-of-type{border-top:0}.original-text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin-top:1mm}.muted{font-style:italic}code{font-family:Consolas,"Courier New",monospace;font-size:8pt;overflow-wrap:anywhere}
</style></head><body>${previewBanner}<div class="eyebrow">LCSP · Báo cáo đánh giá dựa trên nguồn và bằng chứng</div><h1>Báo cáo đánh giá nghĩa vụ pháp lý</h1><p class="lead">Kết quả dưới đây giữ nguyên các quyết định đã được chấp nhận. Mỗi kết quả được nối với nghĩa vụ, tiêu chí và tham chiếu dữ kiện hoặc bằng chứng tương ứng.</p><div class="meta"><div class="meta-card"><strong>Phạm vi đánh giá</strong>${model.summary.totalRules} nghĩa vụ đã ghi nhận</div><div class="meta-card"><strong>Thông tin truy vết</strong>Phiên bản và định danh đầy đủ trong phụ lục</div><div class="meta-card"><strong>Nguồn đánh giá</strong>Nguồn pháp lý, quy tắc và kho mã đã ghim</div><div class="meta-card"><strong>Trạng thái báo cáo</strong>${inline(publication)}</div></div><div class="status-summary">${model.summary.applicableNonCompliant > 0 ? "Đã ghi nhận nghĩa vụ áp dụng chưa đáp ứng." : "Chưa ghi nhận nghĩa vụ áp dụng chưa đáp ứng."}<br><span class="muted">Không áp dụng không đồng nghĩa với Đáp ứng. Báo cáo không suy diễn ngoài các quyết định đã lưu.</span></div><div class="kpis"><div class="kpi"><strong>${model.summary.totalRules}</strong><span>Tổng quy tắc</span></div><div class="kpi"><strong>${model.summary.applicableCompliant}</strong><span>Áp dụng · Đáp ứng</span></div><div class="kpi"><strong>${model.summary.applicableNonCompliant}</strong><span>Áp dụng · Chưa đáp ứng</span></div><div class="kpi"><strong>${model.summary.notApplicable}</strong><span>Không áp dụng</span></div></div><h2>01 — KẾT QUẢ ĐÁNH GIÁ</h2><p>${inline(model.summary.applicableNonCompliant ? "Các nghĩa vụ áp dụng nhưng chưa đáp ứng được nêu cùng căn cứ và kiến nghị đã ghi nhận." : "CHƯA GHI NHẬN NGHĨA VỤ KHÔNG ĐÁP ỨNG trong phạm vi kết quả được đánh giá.")}</p>${mainFindings}${nonApplicableNote}<h2>02 — DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG</h2>${table(["Quy tắc / nghĩa vụ", "Khả năng áp dụng", "Dữ kiện được ghi nhận", "Nguồn kiểm chứng"], factsRows)}<h2>03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ</h2>${table(["Nghĩa vụ và căn cứ", "Trạng thái áp dụng", "Kết quả tuân thủ", "Mã đối chiếu"], catalogRows)}<h2>04 — CHI TIẾT TỪNG NGHĨA VỤ</h2>${model.obligationDetails.map((rule) => ruleDetail(rule, refs, translations)).join("")}<h2>05 — KẾ HOẠCH HÀNH ĐỘNG</h2>${actionsRows.length ? table(["Nghĩa vụ", "Kiến nghị đã ghi nhận"], actionsRows) : `<p class="note">Chưa có kiến nghị được ghi nhận trong dữ liệu quyết định.</p>`}<h2>06 — PHẠM VI, GIỚI HẠN VÀ NGUỒN TRUY VẾT</h2><p>Kho mã nguồn được đánh giá cùng phiên bản nguồn pháp lý và bộ quy tắc đã ghim trong hồ sơ. Những nội dung không thể xác nhận từ dữ liệu này cần được hiểu theo giới hạn đã ghi nhận.</p>${list(scopeLimitations)}<p class="note">Mã [PL], [DK], [BC], [TC] và [QT] trong phần chính được ánh xạ tới định danh đầy đủ ở phụ lục. Nội dung dịch là lớp trình bày; nguyên văn được giữ để đối chiếu.</p>${technicalAppendix}</body></html>`;
}
