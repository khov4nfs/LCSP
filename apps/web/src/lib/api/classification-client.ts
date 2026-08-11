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
} as const;

const CLASSIFICATION_STATUS_OUTCOME_KINDS = {
  loaded: "loaded",
  redirect: "redirect",
  error: "error",
} as const;

export type ClassificationStatusState =
  (typeof CLASSIFICATION_STATUS_STATES)[keyof typeof CLASSIFICATION_STATUS_STATES];

export type VerifiedProfileReviewViewModel = {
  verifiedProfileId: string;
  status: string;
  providerVersion: string;
  verifiedClaims: Record<string, unknown>[];
  verificationSource: string | null;
  conflictResolutions: Record<string, unknown>[];
  gatesPassedAt: Record<string, unknown>;
  evidenceChainIntegrity: boolean | null;
  createdAt: string;
  approvedAt: string | null;
  approvedById: string | null;
};

export type ClassificationStatusViewModel = {
  state: ClassificationStatusState;
  titleKey: MessageKey;
  badgeKey: MessageKey;
  descriptionKey: MessageKey;
  summaryKey?: MessageKey;
  summaryText?: string;
  references?: string[];
  verifiedProfileReview?: VerifiedProfileReviewViewModel | null;
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
  | { kind: typeof CLASSIFICATION_STATUS_OUTCOME_KINDS.redirect; location: string }
  | {
      kind: typeof CLASSIFICATION_STATUS_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export function getClassificationActionVisibility(
  viewModel: Pick<
    ClassificationStatusViewModel,
    "state" | "hasClassification" | "canRerunClassification"
  >,
): ClassificationActionVisibility {
  return {
    showFinalReport: viewModel.state === CLASSIFICATION_STATUS_STATES.passed,
    showGapAnalysis: viewModel.hasClassification,
    showRerunClassification:
      viewModel.state === CLASSIFICATION_STATUS_STATES.processing &&
      !viewModel.hasClassification &&
      viewModel.canRerunClassification,
  };
}

export async function rerunClassification(assessmentId: string): Promise<void> {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/classification/rerun`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );

  if (!response.ok) {
    throw new Error(response.problemCode ?? "classification-rerun-failed");
  }
}

export async function approveVerifiedProfile(
  assessmentId: string,
  verifiedProfileId: string,
): Promise<void> {
  const response = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/verified-profiles/${encodeURIComponent(verifiedProfileId)}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
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
    {
      cache: "no-store",
    },
  );

  return toClassificationStatusOutcome(payload, ok, status, problemCode);
}

export function sanitizeAssessmentDetailPayload(
  payload: unknown,
): AssessmentDetailPayload | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as {
    assessment_id?: unknown;
    name?: unknown;
    wizard_status?: unknown;
    readiness_state?: unknown;
    guardrail_status?: unknown;
    classification_result?: unknown;
    verified_profile_review?: unknown;
    can_rerun_classification?: unknown;
  };

  const readiness = candidate.readiness_state;
  if (
    readiness !== undefined &&
    (typeof readiness !== "object" || readiness === null)
  ) {
    return null;
  }

  const locked = readiness === undefined
    ? undefined
    : (readiness as { classification_locked?: unknown }).classification_locked;

  if (locked !== undefined && typeof locked !== "boolean") {
    return null;
  }

  const guardrailStatus = candidate.guardrail_status;
  if (
    guardrailStatus !== undefined &&
    guardrailStatus !== null &&
    typeof guardrailStatus !== "string"
  ) {
    return null;
  }

  const classificationResult = sanitizeClassificationResult(
    candidate.classification_result,
  );
  if (
    candidate.classification_result !== undefined &&
    candidate.classification_result !== null &&
    classificationResult === null
  ) {
    return null;
  }

  const verifiedProfileReview = sanitizeVerifiedProfileReview(
    candidate.verified_profile_review,
  );
  if (
    candidate.verified_profile_review !== undefined &&
    candidate.verified_profile_review !== null &&
    verifiedProfileReview === null
  ) {
    return null;
  }

  if (
    candidate.can_rerun_classification !== undefined &&
    typeof candidate.can_rerun_classification !== "boolean"
  ) {
    return null;
  }

  const sanitized: AssessmentDetailPayload = {};

  if (typeof candidate.assessment_id === "string") {
    sanitized.assessment_id = candidate.assessment_id;
  }

  if (typeof candidate.name === "string") {
    sanitized.name = candidate.name;
  }

  if (typeof candidate.wizard_status === "string") {
    sanitized.wizard_status = candidate.wizard_status;
  }

  if (readiness !== undefined) {
    sanitized.readiness_state = locked === undefined
      ? {}
      : { classification_locked: locked };
  }

  if (guardrailStatus !== undefined) {
    sanitized.guardrail_status = guardrailStatus as string | null;
  }

  if (candidate.classification_result !== undefined) {
    sanitized.classification_result = classificationResult;
  }

  if (candidate.verified_profile_review !== undefined) {
    sanitized.verified_profile_review = verifiedProfileReview;
  }

  if (candidate.can_rerun_classification !== undefined) {
    sanitized.can_rerun_classification = candidate.can_rerun_classification;
  }

  return sanitized;
}

export function toClassificationStatusOutcome(
  payload: unknown,
  ok: boolean,
  status?: number,
  problemCode = getProblemCode(payload),
): ClassificationStatusOutcome {
  if (ok && isAssessmentDetailPayload(payload)) {
    const sanitized = sanitizeAssessmentDetailPayload(payload);
    if (sanitized) {
      const viewModel = toClassificationStatusViewModel(sanitized);
      return { kind: CLASSIFICATION_STATUS_OUTCOME_KINDS.loaded, data: viewModel };
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

function toClassificationStatusViewModel(payload: AssessmentDetailPayload): ClassificationStatusViewModel {
  const locked = payload.readiness_state?.classification_locked === true;
  const guardrailStatus = payload.guardrail_status ?? null;
  const classificationResult = payload.classification_result ?? null;
  const references = classificationResult?.citation_basis ?? [];
  const summaryText = classificationResult?.rationale ?? undefined;
  const verifiedProfileReview = payload.verified_profile_review
    ? toVerifiedProfileReviewViewModel(payload.verified_profile_review)
    : null;

  if (locked) {
    return {
      state: "locked",
      titleKey: "pages.classification.states.lockedTitle",
      badgeKey: "pages.classification.states.lockedBadge",
      descriptionKey: "pages.classification.states.lockedDescription",
      verifiedProfileReview,
      hasClassification: false,
      canRerunClassification: false,
    };
  }

  if (guardrailStatus === "passed") {
    return {
      state: "passed",
      titleKey: "pages.classification.states.passedTitle",
      badgeKey: "pages.classification.states.passedBadge",
      descriptionKey: "pages.classification.states.passedDescription",
      summaryKey: "pages.classification.states.passedSummary",
      summaryText,
      references,
      verifiedProfileReview,
      hasClassification: true,
      canRerunClassification: false,
    };
  }

  if (guardrailStatus === "degraded") {
    return {
      state: "degraded",
      titleKey: "pages.classification.states.degradedTitle",
      badgeKey: "pages.classification.states.degradedBadge",
      descriptionKey: "pages.classification.states.degradedDescription",
      summaryKey: "pages.classification.states.degradedSummary",
      summaryText,
      references,
      verifiedProfileReview,
      hasClassification: true,
      canRerunClassification: false,
    };
  }

  if (guardrailStatus === "blocked") {
    return {
      state: "blocked",
      titleKey: "pages.classification.states.blockedTitle",
      badgeKey: "pages.classification.states.blockedBadge",
      descriptionKey: "pages.classification.states.blockedDescription",
      summaryKey: "pages.classification.states.blockedSummary",
      summaryText,
      references,
      verifiedProfileReview,
      hasClassification: true,
      canRerunClassification: false,
    };
  }

  return {
    state: CLASSIFICATION_STATUS_STATES.processing,
    titleKey: "pages.classification.states.processingTitle",
    badgeKey: "pages.classification.states.processingBadge",
    descriptionKey: "pages.classification.states.processingDescription",
    verifiedProfileReview,
    hasClassification: false,
    canRerunClassification: payload.can_rerun_classification === true,
  };
}

type ClassificationResultPayload = {
  risk_level?: string | null;
  applicability_assessment?: string | null;
  citation_basis: string[];
  rationale?: string | null;
};

type VerifiedProfileReviewPayload = {
  verified_profile_id: string;
  status: string;
  provider_version: string;
  verified_claims: Record<string, unknown>[];
  verification_source: string | null;
  conflict_resolutions: Record<string, unknown>[];
  gates_passed_at: Record<string, unknown>;
  evidence_chain_integrity: boolean | null;
  created_at: string;
  approved_at: string | null;
  approved_by_id: string | null;
};

type AssessmentDetailPayload = {
  assessment_id?: string;
  name?: string;
  wizard_status?: string;
  readiness_state?: {
    classification_locked?: boolean;
  };
  guardrail_status?: string | null;
  classification_result?: ClassificationResultPayload | null;
  verified_profile_review?: VerifiedProfileReviewPayload | null;
  can_rerun_classification?: boolean;
};

function isAssessmentDetailPayload(payload: unknown): payload is AssessmentDetailPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as AssessmentDetailPayload;
  return typeof candidate.readiness_state?.classification_locked === "boolean" || "guardrail_status" in candidate;
}

function sanitizeClassificationResult(
  value: unknown,
): ClassificationResultPayload | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const citationBasis = candidate.citation_basis;
  if (
    citationBasis !== undefined &&
    (!Array.isArray(citationBasis) ||
      citationBasis.some((entry) => typeof entry !== "string"))
  ) {
    return null;
  }

  for (const key of [
    "risk_level",
    "applicability_assessment",
    "rationale",
  ] as const) {
    const entry = candidate[key];
    if (entry !== undefined && entry !== null && typeof entry !== "string") {
      return null;
    }
  }

  return {
    risk_level: normalizeOptionalString(candidate.risk_level),
    applicability_assessment: normalizeOptionalString(
      candidate.applicability_assessment,
    ),
    citation_basis: Array.isArray(citationBasis)
      ? citationBasis.map((entry) => entry.trim()).filter(Boolean)
      : [],
    rationale: normalizeOptionalString(candidate.rationale),
  };
}

function sanitizeVerifiedProfileReview(
  value: unknown,
): VerifiedProfileReviewPayload | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;

  const verifiedProfileId = requiredString(candidate.verified_profile_id);
  const status = requiredString(candidate.status);
  const providerVersion = requiredString(candidate.provider_version);
  const createdAt = requiredString(candidate.created_at);
  if (!verifiedProfileId || !status || !providerVersion || !createdAt) return null;

  if (!recordArrayValue(candidate.verified_claims)) return null;
  if (!recordArrayValue(candidate.conflict_resolutions)) return null;
  if (!recordValue(candidate.gates_passed_at)) return null;
  if (
    candidate.evidence_chain_integrity !== null &&
    candidate.evidence_chain_integrity !== undefined &&
    typeof candidate.evidence_chain_integrity !== "boolean"
  ) {
    return null;
  }

  const verificationSource = nullableString(candidate.verification_source);
  const approvedAt = nullableString(candidate.approved_at);
  const approvedById = nullableString(candidate.approved_by_id);
  if (verificationSource === undefined || approvedAt === undefined || approvedById === undefined) {
    return null;
  }

  return {
    verified_profile_id: verifiedProfileId,
    status,
    provider_version: providerVersion,
    verified_claims: candidate.verified_claims as Record<string, unknown>[],
    verification_source: verificationSource,
    conflict_resolutions: candidate.conflict_resolutions as Record<string, unknown>[],
    gates_passed_at: candidate.gates_passed_at as Record<string, unknown>,
    evidence_chain_integrity:
      typeof candidate.evidence_chain_integrity === "boolean"
        ? candidate.evidence_chain_integrity
        : null,
    created_at: createdAt,
    approved_at: approvedAt,
    approved_by_id: approvedById,
  };
}

function toVerifiedProfileReviewViewModel(
  value: VerifiedProfileReviewPayload,
): VerifiedProfileReviewViewModel {
  return {
    verifiedProfileId: value.verified_profile_id,
    status: value.status,
    providerVersion: value.provider_version,
    verifiedClaims: value.verified_claims,
    verificationSource: value.verification_source,
    conflictResolutions: value.conflict_resolutions,
    gatesPassedAt: value.gates_passed_at,
    evidenceChainIntegrity: value.evidence_chain_integrity,
    createdAt: value.created_at,
    approvedAt: value.approved_at,
    approvedById: value.approved_by_id,
  };
}

function recordArrayValue(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(recordValue);
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

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
