import type { Locale } from "@lcsp/contracts/shared/locale";

export const CLASSIFICATION_RUNTIME_MESSAGE_KEYS = {
  passedDescription: "passedDescription",
  degradedDescription: "degradedDescription",
  blockedDescription: "blockedDescription",
  metricTotal: "metricTotal",
  metricCompliant: "metricCompliant",
  metricNonCompliant: "metricNonCompliant",
  metricUnknown: "metricUnknown",
  confidence: "confidence",
  technicalEvidence: "technicalEvidence",
  limitations: "limitations",
  technicalDetails: "technicalDetails",
  engineeringRule: "engineeringRule",
  legalRule: "legalRule",
  noTechnicalEvidence: "noTechnicalEvidence",
} as const;

export type ClassificationRuntimeMessageKey =
  (typeof CLASSIFICATION_RUNTIME_MESSAGE_KEYS)[keyof typeof CLASSIFICATION_RUNTIME_MESSAGE_KEYS];

const CLASSIFICATION_RUNTIME_MESSAGES = {
  vi: {
    passedDescription:
      "Đánh giá EngineeringRule đã hoàn tất trên bằng chứng kỹ thuật hiện có của repository.",
    degradedDescription:
      "Đánh giá đã hoàn tất, nhưng ít nhất một EngineeringRule chưa đủ bằng chứng kỹ thuật để kết luận.",
    blockedDescription:
      "Runtime chưa tạo được kết quả EngineeringRule đủ tin cậy để tiếp tục.",
    metricTotal: "Tổng quy tắc",
    metricCompliant: "Đáp ứng",
    metricNonCompliant: "Chưa đáp ứng",
    metricUnknown: "Chưa kết luận",
    confidence: "Độ tin cậy",
    technicalEvidence: "Bằng chứng kỹ thuật",
    limitations: "Lý do chưa thể kết luận",
    technicalDetails: "Chi tiết kỹ thuật",
    engineeringRule: "EngineeringRule",
    legalRule: "LegalRule",
    noTechnicalEvidence: "Chưa có tham chiếu bằng chứng kỹ thuật hợp lệ.",
  },
  en: {
    passedDescription:
      "EngineeringRule evaluation completed against the repository evidence currently available.",
    degradedDescription:
      "Evaluation completed, but at least one EngineeringRule still lacks enough technical evidence for a determination.",
    blockedDescription:
      "The runtime could not produce a trustworthy EngineeringRule result.",
    metricTotal: "Total rules",
    metricCompliant: "Met",
    metricNonCompliant: "Not met",
    metricUnknown: "Undetermined",
    confidence: "Confidence",
    technicalEvidence: "Technical evidence",
    limitations: "Why this is undetermined",
    technicalDetails: "Technical details",
    engineeringRule: "EngineeringRule",
    legalRule: "LegalRule",
    noTechnicalEvidence: "No valid technical evidence reference is available.",
  },
} as const;

const ENGINEERING_LIMITATION_LABELS = {
  vi: {
    NO_ENGINEERING_RULE_SOURCE_RULES: "Không có EngineeringRule nguồn đã được phê duyệt.",
    ENGINEERING_RULE_COMPILATION_FAILED: "Không thể materialize EngineeringRule từ nguồn pháp lý đã pin.",
    ENGINEERING_INVESTIGATION_FAILED: "Phiên điều tra EngineeringRule không hoàn tất thành công.",
    INVESTIGATION_RETURNED_NO_VALID_CLAIMS:
      "LLM không trả về claim kỹ thuật hợp lệ có provenance để evaluator sử dụng.",
    MODEL_LIMITATION_CODE_INVALID:
      "Model trả về limitation ngoài tập machine-code được cho phép.",
    ENGINEERING_EVIDENCE_INSUFFICIENT:
      "Bằng chứng kỹ thuật hiện có chưa đủ để kết luận yêu cầu này.",
    CONFLICTING_ENGINEERING_EVIDENCE:
      "Bằng chứng kỹ thuật đang mâu thuẫn giữa trạng thái đáp ứng và chưa đáp ứng.",
    DYNAMIC_PATH_UNRESOLVED:
      "Có nhánh runtime hoặc dynamic dispatch chưa thể chứng minh bằng phân tích tĩnh.",
    EXTERNAL_BOUNDARY_UNRESOLVED:
      "Kết luận còn phụ thuộc hệ thống hoặc boundary nằm ngoài repository.",
    GRAPH_COVERAGE_LIMITED:
      "Độ bao phủ của Program Evidence Graph còn giới hạn cho yêu cầu này.",
    SEARCH_COVERAGE_INCOMPLETE:
      "Phạm vi truy tìm hiện tại chưa đủ hoàn chỉnh để dùng absence làm bằng chứng.",
  },
  en: {
    NO_ENGINEERING_RULE_SOURCE_RULES: "No approved source EngineeringRule is available.",
    ENGINEERING_RULE_COMPILATION_FAILED:
      "The EngineeringRule could not be materialized from pinned legal provenance.",
    ENGINEERING_INVESTIGATION_FAILED:
      "The EngineeringRule investigation did not complete successfully.",
    INVESTIGATION_RETURNED_NO_VALID_CLAIMS:
      "The model returned no provenance-backed technical claim that the evaluator could use.",
    MODEL_LIMITATION_CODE_INVALID:
      "The model returned a limitation outside the allowed machine-code set.",
    ENGINEERING_EVIDENCE_INSUFFICIENT:
      "The available technical evidence is insufficient for this requirement.",
    CONFLICTING_ENGINEERING_EVIDENCE:
      "Technical evidence conflicts between met and not-met states.",
    DYNAMIC_PATH_UNRESOLVED:
      "A runtime or dynamically dispatched path cannot be proven statically.",
    EXTERNAL_BOUNDARY_UNRESOLVED:
      "The determination depends on a system boundary outside the repository.",
    GRAPH_COVERAGE_LIMITED:
      "Program Evidence Graph coverage is limited for this requirement.",
    SEARCH_COVERAGE_INCOMPLETE:
      "The current search coverage is not complete enough to treat absence as evidence.",
  },
} as const;

export function resolveClassificationRuntimeMessage(
  locale: Locale,
  key: ClassificationRuntimeMessageKey,
): string {
  const dictionary = CLASSIFICATION_RUNTIME_MESSAGES[locale] ?? CLASSIFICATION_RUNTIME_MESSAGES.en;
  return dictionary[key];
}

export function formatClassificationRuntimeSummary(
  locale: Locale,
  summary: {
    compliant: number;
    nonCompliant: number;
    unknown: number;
    total: number;
  },
): string {
  if (locale === "vi") {
    return `${summary.compliant} đáp ứng · ${summary.nonCompliant} chưa đáp ứng · ${summary.unknown} chưa kết luận trên tổng ${summary.total} EngineeringRule.`;
  }
  return `${summary.compliant} met · ${summary.nonCompliant} not met · ${summary.unknown} undetermined out of ${summary.total} EngineeringRules.`;
}

export function formatEngineeringConcept(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((token) => {
      const upper = token.toUpperCase();
      if (["AI", "API", "PII", "LLM"].includes(upper)) return upper;
      return `${token.slice(0, 1).toUpperCase()}${token.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

export function formatEngineeringLimitation(locale: Locale, code: string): string {
  const dictionary = ENGINEERING_LIMITATION_LABELS[locale] ?? ENGINEERING_LIMITATION_LABELS.en;
  const known = dictionary[code as keyof typeof dictionary];
  if (known) return known;
  return formatEngineeringConcept(code);
}

export function formatLegalReference(locale: Locale, value: string): string {
  const segments = value.split("::").filter(Boolean);
  return segments
    .map((segment) => formatLegalReferenceSegment(locale, segment))
    .join(" · ");
}

function formatLegalReferenceSegment(locale: Locale, value: string): string {
  const lawMatch = /^LAW-(\d+)-(\d{4})-(QH\d+)$/i.exec(value);
  if (lawMatch) {
    return locale === "vi"
      ? `Luật ${lawMatch[1]}/${lawMatch[2]}/${lawMatch[3].toUpperCase()}`
      : `Law ${lawMatch[1]}/${lawMatch[2]}/${lawMatch[3].toUpperCase()}`;
  }

  const article = /^art-(.+)$/i.exec(value);
  if (article) return locale === "vi" ? `Điều ${article[1]}` : `Article ${article[1]}`;

  const clause = /^cl-(.+)$/i.exec(value);
  if (clause) return locale === "vi" ? `Khoản ${clause[1]}` : `Clause ${clause[1]}`;

  const point = /^pt-(.+)$/i.exec(value);
  if (point) return locale === "vi" ? `Điểm ${point[1]}` : `Point ${point[1]}`;

  return value;
}
