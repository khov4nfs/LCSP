import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { PUBLIC_ENTRY_ROUTES } from "../../auth-entry.ts";
import { apiRequest } from "./api-request.ts";
import { getProblemCode } from "./problem-envelope.ts";

export const CLASSIFICATION_STATUS_STATES = {
  locked: "locked",
  processing: "processing",
  passed: "passed",
  degraded: "degraded",
  blocked: "blocked",
  // Retained only as stable legacy values for old links/tests; canonical runtime
  // no longer enters these states.
  waitingLegalReadiness: "waiting_legal_readiness",
  legalMatchBlocked: "legal_match_blocked",
} as const;

const CLASSIFICATION_STATUS_OUTCOME_KINDS = {
  loaded: "loaded",
  redirect: "redirect",
  error: "error",
} as const;

export type ClassificationStatusState =
  (typeof CLASSIFICATION_STATUS_STATES)[keyof typeof CLASSIFICATION_STATUS_STATES];

export type TechnicalEvidenceViewModel = {
  kind: string;
  label: string;
  filePath: string | null;
  symbolRef: string | null;
  startLine: number | null;
  endLine: number | null;
};

export type LegalProvisionViewModel = {
  documentId: string;
  locator: string;
  articleNumber: string | null;
  clauseNumber: string | null;
  pointCode: string | null;
  content: string;
};

export type EngineeringRuleEvaluationViewModel = {
  engineeringRuleId: string;
  concept: string;
  status: "COMPLIANT" | "NON_COMPLIANT" | "UNKNOWN";
  reason: string;
  technicalEvidenceCount: number;
  technicalEvidence: TechnicalEvidenceViewModel[];
  legalProvisions: LegalProvisionViewModel[];
  confidence: number;
  limitations: string[];
};

export type ClassificationStatusViewModel = {
  state: ClassificationStatusState;
  titleKey: MessageKey;
  badgeKey: MessageKey;
  descriptionKey: MessageKey;
  summaryKey?: MessageKey;
  summaryText?: string;
  evaluations: EngineeringRuleEvaluationViewModel[];
  engineeringSummary: {
    compliant: number;
    nonCompliant: number;
    unknown: number;
    total: number;
  } | null;
  limitations: string[];
  hasClassification: boolean;
  canRerunClassification: boolean;
};

export type ClassificationActionVisibility = {
  showFinalReport: boolean;
  showGapAnalysis: boolean;
  showRerunClassification: boolean;
};

type ClassificationStatusOutcome =
  | {
      kind: typeof CLASSIFICATION_STATUS_OUTCOME_KINDS.loaded;
      data: ClassificationStatusViewModel;
    }
  | {
      kind: typeof CLASSIFICATION_STATUS_OUTCOME_KINDS.redirect;
      location: string;
    }
  | {
      kind: typeof CLASSIFICATION_STATUS_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export function getClassificationActionVisibility(
  viewModel: Pick<ClassificationStatusViewModel, "state" | "hasClassification">,
): ClassificationActionVisibility {
  const publishable =
    viewModel.state === CLASSIFICATION_STATUS_STATES.passed ||
    viewModel.state === CLASSIFICATION_STATUS_STATES.degraded;
  return {
    showFinalReport: publishable && viewModel.hasClassification,
    showGapAnalysis: publishable && viewModel.hasClassification,
    showRerunClassification: false,
  };
}

/** Legacy endpoint wrapper retained outside the canonical runtime. */
export async function rerunClassification(assessmentId: string): Promise<void> {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/classification/rerun`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  if (!response.ok) {
    throw new Error(response.problemCode ?? "classification-rerun-failed");
  }
}

/** Legacy endpoint wrapper retained so old imports fail softly during migration. */
export async function approveVerifiedProfile(
  assessmentId: string,
  verifiedProfileId: string,
): Promise<void> {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/verified-profiles/${encodeURIComponent(verifiedProfileId)}/approve`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  if (!response.ok) {
    throw new Error(response.problemCode ?? "verified-profile-approval-failed");
  }
}

export async function getClassificationStatus(
  assessmentId: string,
): Promise<ClassificationStatusOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}`,
    { cache: "no-store" },
  );
  return toClassificationStatusOutcome(payload, ok, status, problemCode);
}

export function sanitizeAssessmentDetailPayload(
  payload: unknown,
): AssessmentDetailPayload | null {
  if (!recordValue(payload)) return null;

  const readiness = payload.readiness_state;
  if (readiness !== undefined && !recordValue(readiness)) return null;
  const classificationLocked = recordValue(readiness)
    ? readiness.classification_locked
    : undefined;
  if (
    classificationLocked !== undefined &&
    typeof classificationLocked !== "boolean"
  ) {
    return null;
  }

  const guardrailStatus = payload.guardrail_status;
  if (
    guardrailStatus !== undefined &&
    guardrailStatus !== null &&
    typeof guardrailStatus !== "string"
  ) {
    return null;
  }

  const result = sanitizeClassificationResult(payload.classification_result);
  if (
    payload.classification_result !== undefined &&
    payload.classification_result !== null &&
    !result
  ) {
    return null;
  }

  return {
    readiness_state: recordValue(readiness)
      ? {
          classification_locked: classificationLocked as boolean | undefined,
          lock_reason: nullableString(readiness.lock_reason) ?? null,
          missing_evidence: stringArray(readiness.missing_evidence) ?? [],
        }
      : undefined,
    guardrail_status:
      typeof guardrailStatus === "string" || guardrailStatus === null
        ? guardrailStatus
        : undefined,
    classification_result: result,
  };
}

export function toClassificationStatusOutcome(
  payload: unknown,
  ok: boolean,
  status?: number,
  problemCode = getProblemCode(payload),
): ClassificationStatusOutcome {
  if (ok) {
    const sanitized = sanitizeAssessmentDetailPayload(payload);
    if (sanitized) {
      return {
        kind: CLASSIFICATION_STATUS_OUTCOME_KINDS.loaded,
        data: toClassificationStatusViewModel(sanitized),
      };
    }
  }

  if (
    status === 401 ||
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid
  ) {
    return {
      kind: CLASSIFICATION_STATUS_OUTCOME_KINDS.redirect,
      location: PUBLIC_ENTRY_ROUTES.signIn,
    };
  }

  return {
    kind: CLASSIFICATION_STATUS_OUTCOME_KINDS.error,
    titleKey: "pages.classification.errorTitle",
    detailKey: "pages.classification.errorDetail",
  };
}

function toClassificationStatusViewModel(
  payload: AssessmentDetailPayload,
): ClassificationStatusViewModel {
  const locked = payload.readiness_state?.classification_locked === true;
  const guardrailStatus = normalizeGuardrailStatus(payload.guardrail_status);
  const result = payload.classification_result;
  const evaluations = result?.evaluations.map(toEvaluationViewModel) ?? [];
  const engineeringSummary = result
    ? {
        compliant: result.engineering_summary.compliant,
        nonCompliant: result.engineering_summary.non_compliant,
        unknown: result.engineering_summary.unknown,
        total: result.engineering_summary.total,
      }
    : null;

  const common = {
    evaluations,
    engineeringSummary,
    limitations: result?.limitations ?? [],
    hasClassification: result !== null,
    canRerunClassification: false,
  };

  if (locked) {
    return {
      ...common,
      state: CLASSIFICATION_STATUS_STATES.locked,
      titleKey: "pages.classification.states.lockedTitle",
      badgeKey: "pages.classification.states.lockedBadge",
      descriptionKey: "pages.classification.states.lockedDescription",
      hasClassification: false,
    };
  }
  if (guardrailStatus === "passed") {
    return {
      ...common,
      state: CLASSIFICATION_STATUS_STATES.passed,
      titleKey: "pages.classification.states.passedTitle",
      badgeKey: "pages.classification.states.passedBadge",
      descriptionKey: "pages.classification.states.passedDescription",
      summaryKey: "pages.classification.states.passedSummary",
    };
  }
  if (guardrailStatus === "degraded") {
    return {
      ...common,
      state: CLASSIFICATION_STATUS_STATES.degraded,
      titleKey: "pages.classification.states.degradedTitle",
      badgeKey: "pages.classification.states.degradedBadge",
      descriptionKey: "pages.classification.states.degradedDescription",
      summaryKey: "pages.classification.states.degradedSummary",
    };
  }
  if (guardrailStatus === "blocked") {
    return {
      ...common,
      state: CLASSIFICATION_STATUS_STATES.blocked,
      titleKey: "pages.classification.states.blockedTitle",
      badgeKey: "pages.classification.states.blockedBadge",
      descriptionKey: "pages.classification.states.blockedDescription",
      summaryKey: "pages.classification.states.blockedSummary",
    };
  }

  return {
    ...common,
    state: CLASSIFICATION_STATUS_STATES.processing,
    titleKey: "pages.classification.states.processingTitle",
    badgeKey: "pages.classification.states.processingBadge",
    descriptionKey: "pages.classification.states.processingDescription",
    hasClassification: false,
  };
}

function normalizeGuardrailStatus(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "passed" ||
    normalized === "degraded" ||
    normalized === "blocked"
    ? normalized
    : null;
}

type TechnicalEvidencePayload = {
  kind: string;
  label: string;
  file_path: string | null;
  symbol_ref: string | null;
  start_line: number | null;
  end_line: number | null;
};

type LegalProvisionPayload = {
  document_id: string;
  locator: string;
  article_number: string | null;
  clause_number: string | null;
  point_code: string | null;
  content: string;
};

type EngineeringRuleEvaluationPayload = {
  engineering_rule_id: string;
  legal_rule_id: string;
  concept: string;
  status: "COMPLIANT" | "NON_COMPLIANT" | "UNKNOWN";
  reason: string;
  evidence_refs: string[];
  technical_evidence: TechnicalEvidencePayload[];
  source_chunk_ids: string[];
  source_locators: string[];
  legal_provisions: LegalProvisionPayload[];
  confidence: number;
  limitations: string[];
};

type ClassificationResultPayload = {
  mode: string | null;
  status: string | null;
  engineering_summary: {
    compliant: number;
    non_compliant: number;
    unknown: number;
    total: number;
  };
  evaluations: EngineeringRuleEvaluationPayload[];
  limitations: string[];
  technical_evidence_report_id: string | null;
  snapshot_id: string | null;
};

type AssessmentDetailPayload = {
  readiness_state?: {
    classification_locked?: boolean;
    lock_reason?: string | null;
    missing_evidence?: string[];
  };
  guardrail_status?: string | null;
  classification_result?: ClassificationResultPayload | null;
};

function sanitizeClassificationResult(
  value: unknown,
): ClassificationResultPayload | null {
  if (value === undefined || value === null) return null;
  if (!recordValue(value)) return null;

  const summary = recordValue(value.engineering_summary)
    ? value.engineering_summary
    : null;
  const evaluations = Array.isArray(value.evaluations)
    ? value.evaluations.map(sanitizeEvaluation)
    : [];
  if (!summary || evaluations.some((item) => item === null)) return null;

  return {
    mode: nullableString(value.mode) ?? null,
    status: nullableString(value.status) ?? null,
    engineering_summary: {
      compliant: nonNegativeNumber(summary.compliant),
      non_compliant: nonNegativeNumber(summary.non_compliant),
      unknown: nonNegativeNumber(summary.unknown),
      total: nonNegativeNumber(summary.total),
    },
    evaluations: evaluations as EngineeringRuleEvaluationPayload[],
    limitations: stringArray(value.limitations) ?? [],
    technical_evidence_report_id:
      nullableString(value.technical_evidence_report_id) ?? null,
    snapshot_id: nullableString(value.snapshot_id) ?? null,
  };
}

function sanitizeEvaluation(value: unknown): EngineeringRuleEvaluationPayload | null {
  if (!recordValue(value)) return null;
  const engineeringRuleId = requiredString(value.engineering_rule_id);
  const legalRuleId = requiredString(value.legal_rule_id);
  const concept = requiredString(value.concept);
  const reason = requiredString(value.reason);
  const status = requiredString(value.status)?.toUpperCase();
  const technicalEvidence = Array.isArray(value.technical_evidence)
    ? value.technical_evidence.map(sanitizeTechnicalEvidence)
    : [];
  const legalProvisions = Array.isArray(value.legal_provisions)
    ? value.legal_provisions.map(sanitizeLegalProvision)
    : [];
  if (
    !engineeringRuleId ||
    !legalRuleId ||
    !concept ||
    !reason ||
    technicalEvidence.some((item) => item === null) ||
    legalProvisions.some((item) => item === null) ||
    (status !== "COMPLIANT" &&
      status !== "NON_COMPLIANT" &&
      status !== "UNKNOWN")
  ) {
    return null;
  }
  return {
    engineering_rule_id: engineeringRuleId,
    legal_rule_id: legalRuleId,
    concept,
    status,
    reason,
    evidence_refs: stringArray(value.evidence_refs) ?? [],
    technical_evidence: technicalEvidence as TechnicalEvidencePayload[],
    source_chunk_ids: stringArray(value.source_chunk_ids) ?? [],
    source_locators: stringArray(value.source_locators) ?? [],
    legal_provisions: legalProvisions as LegalProvisionPayload[],
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : 0,
    limitations: stringArray(value.limitations) ?? [],
  };
}

function sanitizeTechnicalEvidence(value: unknown): TechnicalEvidencePayload | null {
  if (!recordValue(value)) return null;
  const kind = requiredString(value.kind);
  const label = requiredString(value.label);
  if (!kind || !label) return null;
  return {
    kind,
    label,
    file_path: nullableString(value.file_path) ?? null,
    symbol_ref: nullableString(value.symbol_ref) ?? null,
    start_line: nullableInteger(value.start_line),
    end_line: nullableInteger(value.end_line),
  };
}

function sanitizeLegalProvision(value: unknown): LegalProvisionPayload | null {
  if (!recordValue(value)) return null;
  const documentId = requiredString(value.document_id);
  const locator = requiredString(value.locator);
  const content = requiredString(value.content);
  if (!documentId || !locator || !content) return null;
  return {
    document_id: documentId,
    locator,
    article_number: nullableString(value.article_number) ?? null,
    clause_number: nullableString(value.clause_number) ?? null,
    point_code: nullableString(value.point_code) ?? null,
    content,
  };
}

function toEvaluationViewModel(
  value: EngineeringRuleEvaluationPayload,
): EngineeringRuleEvaluationViewModel {
  return {
    engineeringRuleId: value.engineering_rule_id,
    concept: value.concept,
    status: value.status,
    reason: value.reason,
    technicalEvidenceCount: value.evidence_refs.length,
    technicalEvidence: value.technical_evidence.map((item) => ({
      kind: item.kind,
      label: item.label,
      filePath: item.file_path,
      symbolRef: item.symbol_ref,
      startLine: item.start_line,
      endLine: item.end_line,
    })),
    legalProvisions: value.legal_provisions.map((item) => ({
      documentId: item.document_id,
      locator: item.locator,
      articleNumber: item.article_number,
      clauseNumber: item.clause_number,
      pointCode: item.point_code,
      content: item.content,
    })),
    confidence: value.confidence,
    limitations: value.limitations,
  };
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return value as null | undefined;
  return typeof value === "string" ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
