import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_FACT_AUTHORITIES } from "@lcsp/contracts/assessment-domain";
import type { AssessmentReportV2Presentation } from "@lcsp/contracts/assessment-report";
import { legalDocumentDisplayName } from "@lcsp/contracts/legal-source";
import {
  buildReportReferenceIndex,
  criterionPresentation,
  legalLocator,
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
  AssessmentReportV2Presentation["obligationDetails"][number];

const acceptedFactStatement = (statement: string) =>
  statement.split("\nAgent-authored question (context only):", 1)[0]?.trim() ??
  "";

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
    .map((row) => {
      const keepApplicabilityCondition =
        className === "detail-table" &&
        row[0] === "\u0110i\u1ec1u ki\u1ec7n \u00e1p d\u1ee5ng";
      return `<tr${keepApplicabilityCondition ? ` class="keep-together"` : ""}>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
    })
    .join("")}</tbody></table>`;
const badge = (label: string, variant: "positive" | "negative" | "neutral") =>
  `<span class="badge ${variant}">${inline(label)}</span>`;
const ruleTitle = (
  rule: RulePresentation,
  translations: ReportTranslationCatalog,
) => inline(ruleTitleInVietnamese(rule, translations));

function legalBases(rule: RulePresentation) {
  type LocatorGroup = {
    article?: string;
    clause?: string;
    points: Set<string>;
    hasWholeClause: boolean;
    unparsedLocators: Set<string>;
  };
  type DocumentGroup = {
    documentId: string;
    documentTitle?: string;
    locators: Map<string, LocatorGroup>;
  };
  const documents = new Map<string, DocumentGroup>();
  for (const source of rule.legalReferences) {
    const documentKey = [
      source.legalSourceVersionId,
      source.legalSourceVersion,
      source.documentId,
    ].join("\u0000");
    let document = documents.get(documentKey);
    if (!document) {
      document = {
        documentId: source.documentId,
        ...(source.documentTitle
          ? { documentTitle: source.documentTitle }
          : {}),
        locators: new Map(),
      };
      documents.set(documentKey, document);
    } else if (!document.documentTitle && source.documentTitle) {
      document.documentTitle = source.documentTitle;
    }
    const article = source.locator.match(/(?:^|::)art-(\d+)/u)?.[1];
    const clause = source.locator.match(/(?:^|::)cl-(\d+)/u)?.[1];
    const point = source.locator.match(/(?:^|::)pt-([a-z0-9đ]+)/iu)?.[1];
    const parsed = Boolean(article || clause);
    const locatorKey = parsed
      ? `parsed:${article ?? ""}:${clause ?? ""}`
      : `raw:${source.locator}`;
    let locator = document.locators.get(locatorKey);
    if (!locator) {
      locator = {
        ...(article ? { article } : {}),
        ...(clause ? { clause } : {}),
        points: new Set(),
        hasWholeClause: false,
        unparsedLocators: new Set(),
      };
      document.locators.set(locatorKey, locator);
    }
    if (point) locator.points.add(point);
    else if (parsed) locator.hasWholeClause = true;
    else locator.unparsedLocators.add(source.locator);
  }
  const joinPoints = (points: string[]) =>
    points.length < 2
      ? points.join("")
      : `${points.slice(0, -1).join(", ")} và ${points.at(-1)}`;
  return [...documents.values()].map((document) => {
    const locators = [...document.locators.values()].map((locator) => {
      if (locator.unparsedLocators.size)
        return [...locator.unparsedLocators].map(legalLocator).join("; ");
      const base = [
        ...(locator.article ? [`Điều ${locator.article}`] : []),
        ...(locator.clause ? [`khoản ${locator.clause}`] : []),
      ].join(", ");
      const points = [...locator.points].sort((left, right) =>
        left.localeCompare(right, "vi"),
      );
      if (!points.length) return base || "Vị trí được ghi trong phụ lục";
      const pointText = `điểm ${joinPoints(points)}`;
      return locator.hasWholeClause
        ? `${base} (bao gồm ${pointText})`
        : `${base}, ${pointText}`;
    });
    return `${legalDocumentDisplayName(document.documentId, document.documentTitle)} — ${locators.join("; ")}.`;
  });
}

function decisionSummary(
  rule: RulePresentation,
  translations: ReportTranslationCatalog,
) {
  const explanation = localizeReportText(rule.rationale, translations);
  if (explanation) return explanation;
  return rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
    ? "Không đánh giá do nghĩa vụ không áp dụng. Quyết định đã chấp nhận trạng thái này; lý do chi tiết chưa có bản giải thích tiếng Việt đã duyệt trong dữ liệu báo cáo."
    : `Kết quả đã chấp nhận: ${localizedCompliance(rule.applicability, rule.compliance)}. Lý do chi tiết chưa có bản giải thích tiếng Việt đã duyệt trong dữ liệu báo cáo.`;
}

function applicabilityRow(
  rule: RulePresentation,
  translations: ReportTranslationCatalog,
) {
  const conditions = rule.conditions.map(
    (item) =>
      localizeReportText(item, translations) ??
      "Điều kiện áp dụng đã được ghi nhận nhưng chưa có bản giải thích tiếng Việt đã duyệt; nguyên văn được lưu trong phụ lục.",
  );
  const facts = rule.observedFacts.map((fact) => {
    const statement = localizeReportText(
      acceptedFactStatement(fact.statement),
      translations,
    );
    return `<div class="reference-item"><strong>${inline(localizedFactAuthority(fact.authority))}:</strong> ${inline(statement ?? "Dữ kiện đã được chấp nhận nhưng chưa có bản tiếng Việt đã duyệt; nguyên văn được giữ trong phụ lục.")}${fact.authority === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED ? `<br><small>Thông tin do người dùng cung cấp; chưa phải bằng chứng xác minh độc lập.</small>` : ""}</div>`;
  });
  const evidence = rule.evidence.map(
    (item) =>
      `<div class="reference-item">${inline(localizedEvidenceType(item.type))}${item.safeLocator ? ` · ${inline(item.safeLocator)}` : ""}</div>`,
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
    `${ruleTitle(rule, translations)}`,
    `${badge(localizedApplicability(rule.applicability), rule.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE ? "positive" : "neutral")}<div>${applicabilityBasis}</div>`,
    facts.join("") ||
      `<span class="muted">Chưa có dữ kiện được trích dẫn.</span>`,
    evidence.join("") ||
      `<span class="muted">Chưa có bằng chứng được trích dẫn.</span>`,
  ];
}

function ruleDetail(
  rule: RulePresentation,
  translations: ReportTranslationCatalog,
) {
  const title = ruleTitleInVietnamese(rule, translations);
  const titleKey = title.normalize("NFC").replace(/\s+/gu, " ").trim();
  const legalRows = rule.legalRequirements.map((requirement) => {
    const requirementTitle = localizeReportText(
      requirement.title,
      translations,
    )?.replace(/ \(nguyên văn song ngữ được lưu trong phụ lục\)$/u, "");
    const proposition = localizeReportText(
      requirement.proposition,
      translations,
    )?.replace(/ \(nguyên văn song ngữ được lưu trong phụ lục\)$/u, "");
    const propositionKey = proposition
      ?.normalize("NFC")
      .replace(/\s+/gu, " ")
      .trim();
    const requirementTitleKey = requirementTitle
      ?.normalize("NFC")
      .replace(/\s+/gu, " ")
      .trim();
    const beginsWithTitle = Boolean(
      propositionKey &&
      requirementTitleKey &&
      propositionKey.startsWith(requirementTitleKey),
    );
    const explanation = beginsWithTitle
      ? proposition
          ?.slice(requirementTitle?.length ?? 0)
          .replace(/^[\s,.;:–-]+/u, "")
      : proposition;
    const titleOverlaps = Boolean(
      requirementTitleKey &&
      (titleKey.startsWith(requirementTitleKey) ||
        requirementTitleKey.startsWith(titleKey)),
    );
    const distinctTitle =
      requirementTitle && !titleOverlaps
        ? `<strong>${inline(requirementTitle)}</strong>`
        : "";
    return `<div class="legal-requirement">${distinctTitle}${explanation ? `<p>${inline(explanation)}</p>` : !distinctTitle ? `<p>${inline(requirementTitle ?? "Nội dung giải thích pháp lý đầy đủ chưa được xác minh từ dữ liệu báo cáo hiện có.")}</p>` : ""}${!proposition ? `<p>${inline("Nội dung giải thích pháp lý đầy đủ chưa được xác minh từ dữ liệu báo cáo hiện có.")}</p>` : ""}</div>`;
  });
  const applicabilityText = localizedApplicability(rule.applicability);
  const complianceText = localizedCompliance(
    rule.applicability,
    rule.compliance,
  );
  const rationale = decisionSummary(rule, translations);
  const criteriaRows = rule.criterionDecisions.map((criterion) => {
    const criterionText = criterionPresentation(criterion, translations);
    const outcome = localizedCriterionOutcome(criterion.outcome);
    const variant =
      criterion.outcome === RULE_DECISION_CRITERION_OUTCOMES.MET
        ? "positive"
        : criterion.outcome === RULE_DECISION_CRITERION_OUTCOMES.NOT_MET
          ? "negative"
          : "neutral";
    return (
      '<div class="criterion-detail"><strong>' +
      inline(criterionText) +
      "</strong><p>Kết quả tiêu chí: " +
      badge(outcome, variant) +
      "</p></div>"
    );
  });
  const factRows = rule.observedFacts.map((fact) => {
    const statement = localizeReportText(
      acceptedFactStatement(fact.statement),
      translations,
    );
    return `<div><strong>${inline(localizedFactAuthority(fact.authority))}</strong><p>${inline(statement ?? "Nội dung dữ kiện chưa có bản tiếng Việt đã duyệt; nguyên văn được giữ trong phụ lục.")}</p>${fact.authority === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED ? `<small>Đây là thông tin do người dùng cung cấp, không phải bằng chứng độc lập từ mã nguồn.</small>` : ""}</div>`;
  });
  const evidenceGroups = new Map<string, string[]>();
  for (const item of rule.evidence) {
    const label = localizedEvidenceType(item.type);
    const locations = evidenceGroups.get(label) ?? [];
    locations.push(item.safeLocator ?? "Vị trí nguồn không được ghi nhận.");
    evidenceGroups.set(label, locations);
  }
  const evidenceRows = [...evidenceGroups].map(
    ([label, locations]) =>
      `<div><strong>${inline(label)}</strong><ul>${locations
        .map((location) => `<li><code>${inline(location)}</code></li>`)
        .join("")}</ul></div>`,
  );
  const conditions = rule.conditions.map(
    (item) =>
      localizeReportText(item, translations) ??
      "Điều kiện pháp lý được ghi nhận nhưng chưa có bản tiếng Việt đã duyệt; nguyên văn ở phụ lục.",
  );
  const qualifiers = rule.qualifiers.map(
    (item) =>
      localizeReportText(item, translations) ??
      "Điều kiện bổ sung được ghi nhận nhưng chưa có bản tiếng Việt đã duyệt; nguyên văn ở phụ lục.",
  );
  const exceptions = rule.exceptions.map(
    (item) =>
      localizeReportText(item, translations) ??
      "Ngoại lệ được ghi nhận nhưng chưa có bản tiếng Việt đã duyệt; nguyên văn ở phụ lục.",
  );
  const criterionObservations = [
    ...new Set(
      rule.criterionDecisions
        .map((criterion) =>
          localizeReportText(criterion.rationale, translations),
        )
        .filter((item): item is string => Boolean(item)),
    ),
  ].filter((item) => item !== localizeReportText(rule.rationale, translations));
  const rows: string[][] = [
    [
      "Căn cứ pháp lý",
      inline(
        legalBases(rule).join("; ") ||
          "Chưa có căn cứ pháp lý trong dữ liệu báo cáo.",
      ),
    ],
    [
      "Quy định yêu cầu gì?",
      legalRows.map((item) => item).join("") ||
        "Nội dung giải thích pháp lý đầy đủ chưa được xác minh từ dữ liệu báo cáo hiện có.",
    ],
    [
      "Quy định áp dụng như thế nào?",
      rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
        ? "Không áp dụng theo quyết định đã chấp nhận; lý do được nêu riêng bên dưới."
        : "Nghĩa vụ được xác định áp dụng theo quyết định đã chấp nhận; dữ kiện liên quan được trình bày bên dưới.",
    ],
    [
      "Điều kiện áp dụng",
      conditions.length
        ? list(conditions)
        : rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
          ? "Không ghi nhận điều kiện bổ sung trong dữ liệu quy tắc; phạm vi chủ thể được trình bày trong phần nghĩa vụ pháp lý và lý do không áp dụng."
          : "Không có điều kiện riêng được ghi nhận trong dữ liệu quy tắc; trạng thái áp dụng thực tế vẫn theo quyết định đã chấp nhận.",
    ],
  ];
  if (rule.qualifiers.length)
    rows.push(["Điều kiện bổ sung", list(qualifiers)]);
  if (rule.exceptions.length)
    rows.push([
      "Ngoại lệ được nêu trong quy định",
      `${list(exceptions)}<small>Đây là các trường hợp được nêu trong căn cứ pháp lý; việc có được viện dẫn trong assessment hay không được trình bày riêng ở phần giải thích kết luận.</small>`,
    ]);
  if (rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE) {
    rows.push([
      "Dữ kiện xác định chủ thể",
      factRows.join("") || "Không có dữ kiện liên quan trong dữ liệu báo cáo.",
    ]);
    rows.push(["Vì sao không áp dụng?", inline(rationale)]);
    rows.push([
      "Kết quả",
      "Không đánh giá tuân thủ vì nghĩa vụ không áp dụng; đây không phải kết quả Đáp ứng hoặc Chưa đáp ứng.",
    ]);
    rows.push([
      "Khi nào cần đánh giá lại?",
      "Đánh giá lại nếu thông tin về chủ thể hoặc phạm vi hoạt động thay đổi.",
    ]);
  } else {
    rows.push([
      "Tiêu chí đánh giá",
      criteriaRows.join("") ||
        "Không có tiêu chí được ghi nhận; không suy diễn kết quả tiêu chí.",
    ]);
    rows.push([
      "Dữ kiện được sử dụng",
      factRows.join("") || "Không có dữ kiện được trích dẫn cho quy tắc này.",
    ]);
    rows.push([
      "Nguồn đã kiểm tra",
      evidenceRows.join("") ||
        "Không có bằng chứng được trích dẫn cho quy tắc này.",
    ]);
    if (criterionObservations.length)
      rows.push(["Nhận xét được ghi nhận", list(criterionObservations)]);
    rows.push([
      "Kết luận cuối cùng",
      badge(
        complianceText,
        rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT
          ? "positive"
          : rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
            ? "negative"
            : "neutral",
      ),
    ]);
    rows.push(["Giải thích kết luận", inline(rationale)]);
    rows.push([
      "Giới hạn của kết luận",
      rule.evidence.some((item) => item.safeLocator)
        ? "Kết luận về nguồn trong repository chỉ phản ánh nội dung và phạm vi đã kiểm tra; không xác nhận biện pháp vận hành bên ngoài repository."
        : "Kết luận chỉ phản ánh dữ kiện và bằng chứng được ghi nhận trong hồ sơ; nội dung ngoài phạm vi đó chưa được xác minh.",
    ]);
  }
  const continuationLabel =
    rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      ? "Vì sao không áp dụng?"
      : "Kết luận cuối cùng";
  const continuationIndex = rows.findIndex(
    ([label]) => label === continuationLabel,
  );
  const detailTable = (items: string[][]) =>
    table(
      ["Hạng mục", "Nội dung"],
      items.map(([label, value]) => [inline(label), value]),
      "detail-table",
    );
  const detailContent =
    continuationIndex < 0
      ? detailTable(rows)
      : `${detailTable(rows.slice(0, continuationIndex))}<div class="decision-continuation" style="break-inside:avoid;page-break-inside:avoid">${detailTable(rows.slice(continuationIndex))}</div>`;
  return `<article class="rule-card"><header class="rule-heading"><div><p class="eyebrow">Nghĩa vụ được đánh giá</p><h3>${inline(title)}</h3></div><div class="status-badges">${badge(applicabilityText, rule.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE ? "positive" : "neutral")}${badge(complianceText, rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT ? "positive" : rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT ? "negative" : "neutral")}</div></header><div class="rule-content">${detailContent}</div></article>`;
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
    applicabilityRow(rule, translations),
  );
  const factsRows = applicabilityRows;
  const catalogRows = model.obligationCatalog.map((item) => {
    const rule = detailByRule.get(item.assessmentRuleId);
    if (!rule) return ["", "", "", ""];
    const legalCitations = legalBases(rule);
    return [
      `<strong>${ruleTitle(rule, translations)}</strong><br><small>${inline(legalCitations.join("; ") || "Chưa có căn cứ pháp lý trong dữ liệu báo cáo.")}</small>`,
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
      inline(decisionSummary(rule, translations)),
    ];
  });
  const issueRows = model.obligationDetails
    .filter(
      (rule) =>
        rule.applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE &&
        rule.compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    )
    .map((rule) => [
      inline(ruleTitleInVietnamese(rule, translations)),
      inline(decisionSummary(rule, translations)),
      rule.recommendations.length
        ? inline(
            rule.recommendations
              .map(
                (item) =>
                  localizeReportText(item, translations) ??
                  "Khuyến nghị đã ghi nhận nhưng chưa có bản tiếng Việt đã duyệt; nguyên văn được lưu trong phụ lục.",
              )
              .join("; "),
          )
        : "Chưa có kiến nghị được ghi nhận.",
    ]);
  const actionsRows = model.actionPlan.flatMap((action) => {
    const rule = detailByRule.get(action.assessmentRuleId);
    if (!rule) return [];
    return action.actions.map((item) => [
      `<strong>${ruleTitle(rule, translations)}</strong>`,
      inline(
        localizeReportText(item, translations) ??
          "Khuyến nghị đã ghi nhận nhưng chưa có bản tiếng Việt đã duyệt; nguyên văn được lưu trong phụ lục.",
      ),
    ]);
  });
  const scopeLimitations = model.scopeTraceability.scopeLimitations.map(
    (item) =>
      localizeReportText(item, translations) ??
      "Giới hạn đã được ghi nhận nhưng chưa có bản tiếng Việt đã duyệt; nguyên văn được lưu trong phụ lục.",
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
  const technicalAppendix = `<section class="appendix"><h2>Phụ lục — Bảng truy vết kỹ thuật</h2><p>Phụ lục lưu các định danh kỹ thuật và tham chiếu nguồn đầy đủ để phục vụ kiểm tra, đối chiếu. Văn bản gốc được giữ nguyên trong dữ liệu đánh giá.</p><h3>Phiên bản và ghim dữ liệu</h3>${table(
    ["Trường", "Giá trị"],
    [
      ["Mã đánh giá:", inline(model.scopeTraceability.assessmentId)],
      ["Mã artifact", inline(model.scopeTraceability.artifactId)],
      ["Phiên bản báo cáo", inline(model.scopeTraceability.schemaVersion)],
      ...(Number.isSafeInteger(model.scopeTraceability.caseRevision)
        ? [
            [
              "Lần hiệu chỉnh hồ sơ",
              inline(String(model.scopeTraceability.caseRevision)),
            ],
          ]
        : []),
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
@page{size:A4;margin:15mm 16mm 17mm}*{box-sizing:border-box}body{font-family:"Noto Sans",Arial,sans-serif;color:#40586b;font-size:9.5pt;line-height:1.42;margin:0}h1{font-size:24pt;line-height:1.08;color:#19364c;margin:4mm 0}h2{font-size:14pt;color:#19364c;border-left:4px solid #187985;padding-left:9px;margin:8mm 0 3mm;break-after:avoid}h3{font-size:11pt;color:#19364c;margin:4mm 0 2mm;break-after:avoid}h4{font-size:10pt;color:#19364c;margin:0 0 2mm;break-after:avoid}p{margin:2mm 0 3mm}small,.muted{font-size:8pt;color:#607989}.eyebrow{color:#187985;font-size:8pt;text-transform:uppercase;letter-spacing:.04em}.preview-banner{border:1px solid #cf8a24;background:#fff5df;color:#744e10;padding:8px 10px;font-weight:700;margin:0 0 5mm}.lead{font-size:10pt;color:#354f63}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px}.meta-card{border:1px solid #cbd9e0;border-radius:4px;background:#edf3f6;padding:8px;min-width:0}.meta-card strong{display:block;color:#187985;font-size:7.5pt;text-transform:uppercase;margin-bottom:2px}.status-summary{border:1px solid #9dcac5;background:#edf8f6;border-radius:4px;padding:10px;margin:4mm 0;color:#19364c}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:4mm 0}.kpi{border:1px solid #cbd9e0;background:#f5f8fa;text-align:center;padding:7px 3px;border-radius:4px}.kpi strong{display:block;font-size:17pt;color:#19364c}.kpi span{font-size:7.3pt}.note{border-left:3px solid #187985;padding:6px 9px;background:#f2f7f9}.badge{display:inline-block;border:1px solid;border-radius:12px;padding:3px 8px;font-size:8pt;font-weight:700;white-space:normal}.badge.positive{color:#17665f;border-color:#88c5b7;background:#eaf7f3}.badge.negative{color:#9a2c2c;border-color:#d99a9a;background:#fff0ee}.badge.neutral{color:#5b6570;border-color:#b8c3ca;background:#f4f6f7}.status-badges{display:flex;flex-direction:column;gap:5px;align-items:flex-start;max-width:145px}.ref{font-weight:700;color:#14747d;white-space:nowrap}.reference-item{margin:1mm 0;overflow-wrap:anywhere}.rule-card{border:1px solid #cbd9e0;border-radius:5px;margin:4mm 0 6mm;break-inside:auto}h2:has(+article.rule-card){break-before:page}.detail-table tr{break-inside:auto;page-break-inside:auto}.detail-table tr.keep-together{break-inside:avoid;page-break-inside:avoid}.rule-card+.rule-card{break-before:auto}.rule-heading{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;background:#f3f7f8;padding:9px;border-bottom:1px solid #cbd9e0;break-after:avoid}.rule-heading h3{margin:0}.rule-heading .eyebrow{margin:0 0 2px}.rule-content{padding:9px}.rule-content section{margin:0 0 5mm;break-inside:auto}.rule-content section+section{border-top:1px solid #e1e8eb;padding-top:4mm}.obligation{border-left:2px solid #187985;padding-left:8px;margin:2mm 0}.obligation p{margin-bottom:0}.fact-card,.evidence-card{border:1px solid #d7e1e5;border-radius:4px;padding:7px;margin:2mm 0;break-inside:avoid}.fact-card p{margin:1mm 0}.conclusion{background:#f4f8f9;padding:8px;border-radius:4px}.mapping{font-size:8pt;color:#456172}.criteria-table{font-size:8.5pt}.criteria-table td:nth-child(2){width:22%}.criteria-table td:nth-child(3){width:38%}table{width:100%;border-collapse:collapse;margin:3mm 0 5mm;table-layout:fixed;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th{background:#187985;color:#fff;font-size:8pt;text-align:left;padding:6px}td{border:1px solid #cbd9e0;padding:6px;vertical-align:top;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f6f9fa}ul{margin:1mm 0 2mm 5mm;padding-left:4mm}li{margin:1mm 0}.appendix{break-before:auto}.appendix h2{margin-top:0}.appendix h3{font-size:9.5pt;background:#edf3f6;padding:5px 7px}.compact{font-size:7.5pt;margin:2mm 0 4mm}.compact th,.compact td{padding:4px}.original-record{border-top:1px solid #cbd9e0;padding:2mm 1mm;margin:0;break-inside:auto;page-break-inside:auto}.original-record:first-of-type{border-top:0}.original-text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin-top:1mm}.muted{font-style:italic}code{font-family:Consolas,"Courier New",monospace;font-size:8pt;overflow-wrap:anywhere}
</style></head><body>${previewBanner}<div class="eyebrow">LCSP · Báo cáo đánh giá dựa trên nguồn và bằng chứng</div><h1>Báo cáo đánh giá nghĩa vụ pháp lý</h1><p class="lead">Kết quả dưới đây giữ nguyên các quyết định đã được chấp nhận. Mỗi kết quả được nối với nghĩa vụ, tiêu chí và tham chiếu dữ kiện hoặc bằng chứng tương ứng.</p><div class="meta"><div class="meta-card"><strong>Phạm vi đánh giá</strong>${model.summary.totalRules} nghĩa vụ đã ghi nhận</div><div class="meta-card"><strong>Thông tin truy vết</strong>Phiên bản và định danh đầy đủ trong phụ lục</div><div class="meta-card"><strong>Nguồn đánh giá</strong>Nguồn pháp lý, quy tắc và kho mã đã ghim</div><div class="meta-card"><strong>Trạng thái báo cáo</strong>${inline(publication)}</div></div><div class="status-summary">${model.summary.applicableNonCompliant > 0 ? "Đã ghi nhận nghĩa vụ áp dụng chưa đáp ứng." : "Chưa ghi nhận nghĩa vụ áp dụng chưa đáp ứng."}<br><span class="muted">Không áp dụng không đồng nghĩa với Đáp ứng. Báo cáo không suy diễn ngoài các quyết định đã lưu.</span></div><div class="kpis"><div class="kpi"><strong>${model.summary.totalRules}</strong><span>Tổng quy tắc</span></div><div class="kpi"><strong>${model.summary.applicableCompliant}</strong><span>Áp dụng · Đáp ứng</span></div><div class="kpi"><strong>${model.summary.applicableNonCompliant}</strong><span>Áp dụng · Chưa đáp ứng</span></div><div class="kpi"><strong>${model.summary.notApplicable}</strong><span>Không áp dụng</span></div></div><h2>01 — KẾT QUẢ ĐÁNH GIÁ</h2><p>${inline(model.summary.applicableNonCompliant ? "Các nghĩa vụ áp dụng nhưng chưa đáp ứng được nêu cùng căn cứ và kiến nghị đã ghi nhận." : "CHƯA GHI NHẬN NGHĨA VỤ KHÔNG ĐÁP ỨNG trong phạm vi kết quả được đánh giá.")}</p>${mainFindings}${nonApplicableNote}<h2>02 — DỮ KIỆN LIÊN QUAN ĐIỀU KIỆN ÁP DỤNG</h2>${table(["Nghĩa vụ", "Khả năng áp dụng", "Dữ kiện được ghi nhận", "Nguồn kiểm chứng"], factsRows)}<h2>03 — DANH MỤC NGHĨA VỤ ĐƯỢC ĐÁNH GIÁ</h2>${table(["Nghĩa vụ và căn cứ pháp lý", "Phạm vi áp dụng", "Kết quả", "Giải thích kết quả"], catalogRows)}<h2>04 — CHI TIẾT TỪNG NGHĨA VỤ</h2>${model.obligationDetails.map((rule) => ruleDetail(rule, translations)).join("")}<h2>05 — KẾ HOẠCH HÀNH ĐỘNG</h2>${actionsRows.length ? table(["Nghĩa vụ", "Việc cần thực hiện"], actionsRows) : `<p class="note">Chưa có kiến nghị được ghi nhận trong dữ liệu quyết định.</p>`}<h2>06 — PHẠM VI, GIỚI HẠN VÀ NGUỒN TRUY VẾT</h2><p>Kho mã nguồn được đánh giá cùng phiên bản nguồn pháp lý và bộ quy tắc đã ghim trong hồ sơ. Những nội dung không thể xác nhận từ dữ liệu này cần được hiểu theo giới hạn đã ghi nhận.</p>${list(scopeLimitations)}<p class="note">Định danh đầy đủ, mã đối chiếu và dữ liệu nguồn được lưu trong phụ lục kỹ thuật. Phần chính trình bày ý nghĩa và kết quả đã chấp nhận bằng ngôn ngữ dành cho người đọc.</p>${technicalAppendix}</body></html>`;
}
