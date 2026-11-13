import {
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
} from "@lcsp/contracts/assessment-domain";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import { legalDocumentDisplayName } from "@lcsp/contracts/legal-source";
import type { AssessmentReportV2Presentation } from "@lcsp/contracts/assessment-report";

type RulePresentation =
  AssessmentReportV2Presentation["obligationDetails"][number];

export type ReportTranslationCatalog = Readonly<Record<string, string>>;

export type ReportTechnicalText = {
  reference: string;
  ruleReference: string;
  field: string;
  original: string;
};

export type ReportSourceReference = {
  reference: string;
  documentName: string;
  locator: string;
  sourceLocator: string;
  documentId: string;
  sourceHash: string;
};

export type ReportCriterionMapping = {
  reference: string;
  ruleReference: string;
  id: string;
};

export type ReportReferenceIndex = {
  ruleReference: (ruleId: string) => string;
  criterionReference: (ruleId: string, criterionId: string) => string;
  legalReference: (
    source: RulePresentation["legalReferences"][number],
  ) => string;
  factReference: (factId: string) => string;
  evidenceReference: (evidenceId: string) => string;
  textReference: (text: string) => string;
  sources: ReportSourceReference[];
  facts: Array<{ reference: string; id: string; authority: string }>;
  evidence: Array<{
    reference: string;
    id: string;
    locator: string | null;
    type: string;
    contentHash: string;
  }>;
  technicalTexts: ReportTechnicalText[];
  ruleMappings: Array<{ reference: string; id: string }>;
  criterionMappings: ReportCriterionMapping[];
};

const VIETNAMESE_LABELS = {
  applicable: "Áp dụng",
  notApplicable: "Không áp dụng",
  compliant: "Đáp ứng",
  nonCompliant: "Chưa đáp ứng",
  notEvaluated: "Không đánh giá do nghĩa vụ không áp dụng",
  insufficient: "Chưa đủ thông tin",
  met: "Đạt",
  notMet: "Chưa đạt",
  humanProvided: "Do người dùng cung cấp",
  repositoryDerived: "Quan sát từ mã nguồn",
  otherFact: "Dữ kiện đã được ghi nhận",
  repositoryEvidence: "Bằng chứng từ mã nguồn",
  citedEvidence: "Bằng chứng được trích dẫn",
  otherEvidence: "Bằng chứng đã được ghi nhận",
} as const;

const KNOWN_TRANSLATIONS = new Map<string, string>([
  ["UNCONDITIONAL", "Áp dụng chung, không có điều kiện riêng"],
  ["CONDITIONAL", "Áp dụng khi đáp ứng điều kiện liên quan"],
  ["DUTY", "Nghĩa vụ phải thực hiện"],
  ["PROHIBITION", "Hành vi bị cấm"],
  ["Legal requirement", "Nghĩa vụ pháp lý"],
  ["LegalRequirement", "Nghĩa vụ pháp lý"],
  ["Rule", "Quy tắc đánh giá"],
  ["Criterion", "Tiêu chí đánh giá"],
  ["Evidence", "Bằng chứng"],
  ["Fact", "Dữ kiện"],
  ["Customer answer", "Thông tin do người dùng cung cấp"],
  ["Agent-authored question", "Câu hỏi làm rõ trong quá trình đánh giá"],
  [
    "Proactive malware prevention, detection and blocking duty",
    "Nghĩa vụ chủ động phòng ngừa, phát hiện và ngăn chặn phần mềm độc hại",
  ],
  [
    "Owners of nationally critical information systems",
    "Chủ quản hệ thống thông tin quan trọng quốc gia",
  ],
  [
    "Personal data disclosure only in permitted cases",
    "Chỉ công khai dữ liệu cá nhân trong các trường hợp được phép",
  ],
  [
    "Disclosure of personal data only in permitted cases",
    "Chỉ công khai dữ liệu cá nhân trong các trường hợp được phép",
  ],
  ["Ensure the legal intent is met.", "Bảo đảm yêu cầu pháp lý được đáp ứng."],
  [
    "Applies when the described condition holds.",
    "Áp dụng khi đáp ứng điều kiện đã nêu.",
  ],
  ["The control exists.", "Biện pháp kiểm soát này hiện hữu."],
  ["Based on the cited source.", "Dựa trên nguồn đã được trích dẫn."],
]);

const hasVietnameseDiacritics = (text: string) =>
  /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửựỳýỷỹỵ]/u.test(
    text,
  );

function removeEnglishTranslationParentheticals(text: string): {
  text: string;
  removed: boolean;
} {
  let output = "";
  let removed = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "(") {
      output += text[index];
      continue;
    }
    let depth = 1;
    let end = index + 1;
    while (end < text.length && depth > 0) {
      if (text[end] === "(") depth += 1;
      if (text[end] === ")") depth -= 1;
      end += 1;
    }
    if (depth !== 0) {
      output += text[index];
      continue;
    }
    const content = text.slice(index + 1, end - 1).trim();
    const isEnglishTranslation =
      /^[A-Z][A-Za-z]+(?:[\s,;:-]+[A-Za-z]+){3,}/u.test(content) &&
      !hasVietnameseDiacritics(content);
    if (isEnglishTranslation) {
      output += " ";
      removed = true;
      index = end - 1;
    } else {
      output += text.slice(index, end);
      index = end - 1;
    }
  }
  return { text: output.trim(), removed };
}

const containsInternalNarrativeLabels = (text: string) =>
  /\b(?:LegalRequirement|Applicability mode|Repository proof boundary|External fulfillment|Operative proposition|Source binding|Source binding|UNCONDITIONAL|CONDITIONAL|NOT_APPLICABLE|NON_COMPLIANT|COMPLIANT|NOT_MET|HUMAN_PROVIDED|REPOSITORY_SOURCE)\b/u.test(
    text,
  );

export function localizeReportText(
  text: string,
  translations: ReportTranslationCatalog = {},
): string | undefined {
  const value = text.trim();
  if (!value) return undefined;
  const translated = translations[value];
  if (translated?.trim()) return translated.trim();
  const exact = KNOWN_TRANSLATIONS.get(value);
  if (exact) return exact;
  if (
    hasVietnameseDiacritics(value) &&
    !containsInternalNarrativeLabels(value)
  ) {
    const projected = removeEnglishTranslationParentheticals(value);
    return projected.removed
      ? `${projected.text} (nguyên văn song ngữ được lưu trong phụ lục)`
      : value;
  }
  return undefined;
}

export function localizedApplicability(value: string): string {
  if (value === RULE_DECISION_APPLICABILITIES.APPLICABLE)
    return VIETNAMESE_LABELS.applicable;
  if (value === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE)
    return VIETNAMESE_LABELS.notApplicable;
  return VIETNAMESE_LABELS.insufficient;
}

export function localizedApplicabilityMode(guidance: string): string {
  const mode = guidance.match(
    /Applicability mode:\s*(UNCONDITIONAL|CONDITIONAL)/u,
  )?.[1];
  if (mode === "UNCONDITIONAL") return "Áp dụng chung theo định nghĩa nghĩa vụ";
  if (mode === "CONDITIONAL")
    return "Áp dụng khi điều kiện pháp lý tương ứng được đáp ứng";
  return "Chưa xác định được chế độ áp dụng trong định nghĩa quy tắc";
}

export function localizedCompliance(
  applicability: string,
  compliance: string | null,
): string {
  if (applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE)
    return VIETNAMESE_LABELS.notEvaluated;
  if (compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT)
    return VIETNAMESE_LABELS.compliant;
  if (compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT)
    return VIETNAMESE_LABELS.nonCompliant;
  return VIETNAMESE_LABELS.insufficient;
}

export function localizedCriterionOutcome(value: string): string {
  if (value === RULE_DECISION_CRITERION_OUTCOMES.MET)
    return VIETNAMESE_LABELS.met;
  if (value === RULE_DECISION_CRITERION_OUTCOMES.NOT_MET)
    return VIETNAMESE_LABELS.notMet;
  return localizeReportText(value) ?? VIETNAMESE_LABELS.insufficient;
}

export function localizedFactAuthority(value: string): string {
  if (value === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED)
    return VIETNAMESE_LABELS.humanProvided;
  if (value === ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED)
    return VIETNAMESE_LABELS.repositoryDerived;
  return localizeReportText(value) ?? VIETNAMESE_LABELS.otherFact;
}

export function localizedEvidenceType(value: string): string {
  if (value === ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE)
    return VIETNAMESE_LABELS.repositoryEvidence;
  if (value === ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER)
    return "Thông tin/bằng chứng do người dùng cung cấp";
  if (value === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE)
    return "Phạm vi tìm kiếm đã ghi nhận";
  return localizeReportText(value) ?? VIETNAMESE_LABELS.otherEvidence;
}

export function legalLocator(locator: string): string {
  const parts: string[] = [];
  const article = locator.match(/(?:^|::)art-(\d+)/u);
  const clause = locator.match(/(?:^|::)cl-(\d+)/u);
  const point = locator.match(/(?:^|::)pt-([a-z0-9đ]+)/iu);
  if (article) parts.push(`Điều ${article[1]}`);
  if (clause) parts.push(`khoản ${clause[1]}`);
  if (point) parts.push(`điểm ${point[1]}`);
  return parts.join(", ") || "Vị trí được ghi trong phụ lục";
}

function sourceKey(
  source: RulePresentation["legalReferences"][number],
): string {
  return `${source.documentId}\u0000${source.locator}\u0000${source.contentSha256}`;
}

export function buildReportReferenceIndex(
  model: AssessmentReportV2Presentation,
  translations: ReportTranslationCatalog = {},
): ReportReferenceIndex {
  const ruleIds = [
    ...new Set(model.obligationDetails.map((item) => item.assessmentRuleId)),
  ];
  const factRecords = new Map<string, { id: string; authority: string }>();
  const evidenceRecords = new Map<
    string,
    { id: string; locator: string | null; type: string; contentHash: string }
  >();
  const sourceRecords = new Map<
    string,
    RulePresentation["legalReferences"][number]
  >();

  for (const rule of model.obligationDetails) {
    rule.legalReferences.forEach((source) => {
      const key = sourceKey(source);
      sourceRecords.set(key, source);
    });
    for (const fact of rule.observedFacts)
      factRecords.set(fact.factId, {
        id: fact.factId,
        authority: fact.authority,
      });
    for (const evidence of rule.evidence)
      evidenceRecords.set(evidence.evidenceId, {
        id: evidence.evidenceId,
        locator: evidence.safeLocator,
        type: evidence.type,
        contentHash: evidence.contentSha256,
      });
  }

  const sourceLabels = new Map(
    [...sourceRecords.keys()].map((key, index) => [
      key,
      `PL-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const factLabels = new Map(
    [...factRecords.keys()].map((id, index) => [
      id,
      `DK-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const evidenceLabels = new Map(
    [...evidenceRecords.keys()].map((id, index) => [
      id,
      `BC-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const ruleLabels = new Map(
    ruleIds.map((id, index) => [
      id,
      `QT-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const criterionKeys = model.obligationDetails.flatMap((rule) =>
    rule.criterionDecisions.map(
      (criterion) => `${rule.assessmentRuleId}\u0000${criterion.criterionId}`,
    ),
  );
  const criterionLabels = new Map(
    criterionKeys.map((key, index) => [
      key,
      `TC-${String(index + 1).padStart(2, "0")}`,
    ]),
  );
  const rawTextLabels = new Map<string, string>();
  const technicalTexts: ReportTechnicalText[] = [];

  const retainOriginal = (ruleId: string, field: string, text: string) => {
    const value = text.trim();
    // This field is a machine-readable rendering of legal source objects; the
    // appendix already retains their IDs, locators and source hashes in tables.
    if (value.startsWith("LegalRequirement:")) return;
    if (
      !value ||
      (localizeReportText(value) &&
        (!translations[value] || hasVietnameseDiacritics(value)))
    )
      return;
    let reference = rawTextLabels.get(value);
    if (!reference) {
      reference = `ND-${String(rawTextLabels.size + 1).padStart(2, "0")}`;
      rawTextLabels.set(value, reference);
      technicalTexts.push({
        reference,
        ruleReference: ruleLabels.get(ruleId) ?? "",
        field,
        original: value,
      });
    }
  };

  for (const rule of model.obligationDetails) {
    for (const requirement of rule.legalRequirements) {
      retainOriginal(
        rule.assessmentRuleId,
        "Nội dung nghĩa vụ",
        requirement.title,
      );
      retainOriginal(
        rule.assessmentRuleId,
        "Mô tả nghĩa vụ",
        requirement.proposition,
      );
    }
    for (const [field, values] of [
      ["Điều kiện", rule.conditions],
      ["Điều kiện bổ sung", rule.qualifiers],
      ["Ngoại lệ", rule.exceptions],
      ["Hướng dẫn áp dụng", [rule.applicabilityGuidance]],
      ["Dữ kiện", rule.observedFacts.map((fact) => fact.statement)],
      ["Khái niệm", [rule.concept]],
      ["Ý định pháp lý", [rule.legalIntent]],
      ["Lý do quyết định", [rule.rationale]],
      [
        "Tiêu chí",
        rule.criterionDecisions.map((criterion) => criterion.statement),
      ],
      [
        "Lý do tiêu chí",
        rule.criterionDecisions.map((criterion) => criterion.rationale),
      ],
      ["Khuyến nghị", rule.recommendations],
    ] as Array<[string, string[]]>) {
      for (const value of values)
        retainOriginal(rule.assessmentRuleId, field, value);
    }
  }
  for (const limitation of model.scopeTraceability.scopeLimitations)
    retainOriginal("", "Giới hạn phạm vi", limitation);

  return {
    ruleReference: (id) => ruleLabels.get(id) ?? "",
    criterionReference: (ruleId, criterionId) =>
      criterionLabels.get(`${ruleId}\u0000${criterionId}`) ?? "",
    legalReference: (source) => sourceLabels.get(sourceKey(source)) ?? "",
    factReference: (id) => factLabels.get(id) ?? "",
    evidenceReference: (id) => evidenceLabels.get(id) ?? "",
    textReference: (text) => rawTextLabels.get(text.trim()) ?? "",
    sources: [...sourceRecords.entries()].map(([key, source]) => ({
      reference: sourceLabels.get(key) ?? "",
      documentName: legalDocumentDisplayName(
        source.documentId,
        source.documentTitle,
      ),
      locator: legalLocator(source.locator),
      sourceLocator: source.locator,
      documentId: source.documentId,
      sourceHash: source.contentSha256,
    })),
    facts: [...factRecords.entries()].map(([id, record]) => ({
      reference: factLabels.get(id) ?? "",
      id,
      authority: localizedFactAuthority(record.authority),
    })),
    evidence: [...evidenceRecords.entries()].map(([id, record]) => ({
      reference: evidenceLabels.get(id) ?? "",
      id,
      locator: record.locator,
      type: localizedEvidenceType(record.type),
      contentHash: record.contentHash,
    })),
    technicalTexts,
    ruleMappings: [...ruleIds].map((id) => ({
      reference: ruleLabels.get(id) ?? "",
      id,
    })),
    criterionMappings: model.obligationDetails.flatMap((rule) =>
      rule.criterionDecisions.map((criterion) => ({
        reference:
          criterionLabels.get(
            `${rule.assessmentRuleId}\u0000${criterion.criterionId}`,
          ) ?? "",
        ruleReference: ruleLabels.get(rule.assessmentRuleId) ?? "",
        id: criterion.criterionId,
      })),
    ),
  };
}

export function reportDecisionExplanation(rule: RulePresentation): string {
  const applicability = localizedApplicability(rule.applicability);
  const result = localizedCompliance(rule.applicability, rule.compliance);
  if (rule.applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE)
    return `Trạng thái áp dụng: ${applicability}. ${result}.`;
  return `Trạng thái áp dụng: ${applicability}. Kết quả đánh giá: ${result}.`;
}

export function ruleTitleInVietnamese(
  rule: RulePresentation,
  translations: ReportTranslationCatalog = {},
): string {
  const title = rule.legalRequirements
    .map((item) => localizeReportText(item.title, translations))
    .find((item): item is string => Boolean(item));
  if (title)
    return title.replace(
      / \(nguyên văn song ngữ được lưu trong phụ lục\)$/u,
      "",
    );
  const proposition = rule.legalRequirements
    .map((item) => localizeReportText(item.proposition, translations))
    .find((item): item is string => Boolean(item));
  if (proposition)
    return (
      proposition
        .replace(/ \(nguyên văn song ngữ được lưu trong phụ lục\)$/u, "")
        .split(/(?<=[.!?])\s/u, 1)[0] ?? proposition
    );
  return "Chưa có tiêu đề nghĩa vụ tiếng Việt đã được xác minh.";
}

export function contentInVietnameseOrAppendix(
  text: string,
  reference: ReportReferenceIndex,
  fallback: string,
  translations: ReportTranslationCatalog = {},
): string {
  const localized = localizeReportText(text, translations);
  if (localized) return localized;
  const textReference = reference.textReference(text);
  return textReference
    ? `${fallback} (xem ${textReference} ở phụ lục).`
    : fallback;
}

export function factPresentation(
  fact: RulePresentation["observedFacts"][number],
  reference: ReportReferenceIndex,
  translations: ReportTranslationCatalog = {},
): string {
  const source = localizedFactAuthority(fact.authority);
  const acceptedStatement = fact.statement.split(
    "\nAgent-authored question (context only):",
    1,
  )[0];
  const localized = localizeReportText(acceptedStatement, translations);
  if (localized) {
    const sourceNote =
      fact.authority === ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED
        ? "Nguồn: người dùng cung cấp; đây không phải bằng chứng độc lập từ mã nguồn."
        : `Nguồn: ${source}.`;
    return `${localized} (${sourceNote})`;
  }
  const id = reference.factReference(fact.factId);
  const original = reference.textReference(fact.statement);
  return `${source}${original ? `; nội dung nguyên văn ${original}` : ""} (${id}).`;
}

export function criterionPresentation(
  criterion: RulePresentation["criterionDecisions"][number],
  translations: ReportTranslationCatalog = {},
): string {
  const statement = localizeReportText(criterion.statement, translations);
  if (statement) return statement;
  const proposition = criterion.statement
    .match(
      /(?:^|\n)Proposition:\s*([\s\S]*?)(?=\nApplicability mode:|\nRepository proof boundary|\nExternal fulfillment|\nOperative proposition|$)/u,
    )?.[1]
    ?.trim()
    .replace(
      /\s*\([^()]*\b(?:must|agencies|organizations|individuals)\b[^()]*\)/giu,
      "",
    );
  if (proposition && hasVietnameseDiacritics(proposition)) return proposition;
  return "Mô tả tiêu chí chưa có bản tiếng Việt đã được xác minh; nguyên văn được giữ trong phụ lục.";
}

export function decisionReferenceLabels(
  refs: RulePresentation["decisionReferences"],
  reference: ReportReferenceIndex,
): string[] {
  const labels = new Set<string>();
  for (const item of refs) {
    if (item.reference.type === RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT) {
      const label = reference.factReference(item.reference.factId);
      if (label) labels.add(label);
    } else {
      const label = reference.evidenceReference(item.reference.evidenceId);
      if (label) labels.add(label);
    }
  }
  return [...labels];
}

export function sourceLabelsForRule(
  rule: RulePresentation,
  reference: ReportReferenceIndex,
): string[] {
  return [
    ...new Set(
      rule.legalReferences
        .map((source) => reference.legalReference(source))
        .filter(Boolean),
    ),
  ];
}

export function factEvidenceLabels(
  fact: RulePresentation["observedFacts"][number],
  reference: ReportReferenceIndex,
): string[] {
  return [
    ...new Set(
      fact.evidenceIds
        .map((id) => reference.evidenceReference(id))
        .filter(Boolean),
    ),
  ];
}
