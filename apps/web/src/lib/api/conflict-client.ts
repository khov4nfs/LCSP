import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment/codes";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";
import { SCAN_ERROR_CODES } from "@lcsp/contracts/scan/codes";
import { apiRequest } from "./api-request.ts";
import { API_OUTCOME_KINDS, API_VALIDATION_REASONS } from "./outcome-kinds.ts";
import { getMfaRedirectLocation, getProblemCode } from "./problem-envelope.ts";

export type ConflictStatus =
  | (typeof CONFLICT_RECORD_STATUSES)[keyof typeof CONFLICT_RECORD_STATUSES]
  | (string & {});

export type ConflictSummary = {
  conflict_id: string;
  conflict_type: string;
  conflict_score: number;
  score_explanation: string;
  explanation_basis: ConflictExplanationBasis;
  status: ConflictStatus;
  evidence_refs: string[];
  created_at: string;
};

export type ConflictExplanationBasis = {
  affected_field: string;
  confidence: string;
  materiality_reason: string;
  score_priority_explanation: string;
  source_values: ConflictSourceValues;
  source_refs: Record<string, string>;
  evidence_context: ConflictEvidenceContext[];
};

export type ConflictSourceValues = {
  manager_answer: string | null;
  technical_evidence: string | null;
};

export type ConflictEvidenceContext = {
  evidence_ref: string;
  redacted_context: string;
  coverage_limitations: string;
};

export type ConflictListResult = {
  conflicts: ConflictSummary[];
  total: number;
  page: number;
  page_size: number;
  correlationId?: string;
};

export type ResolveConflictPayload = {
  resolution:
    | typeof CONFLICT_RECORD_STATUSES.resolved
    | typeof CONFLICT_RECORD_STATUSES.dismissed;
  resolution_note?: string;
};

export type ResolveConflictResult = {
  conflict_id: string;
  status:
    | typeof CONFLICT_RECORD_STATUSES.resolved
    | typeof CONFLICT_RECORD_STATUSES.dismissed;
  resolved_at: string;
  all_conflicts_resolved: boolean;
  correlationId?: string;
};

export type ConflictListOutcome =
  | { kind: typeof API_OUTCOME_KINDS.loaded; data: ConflictListResult }
  | { kind: typeof API_OUTCOME_KINDS.empty }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | { kind: typeof API_OUTCOME_KINDS.accessRevoked }
  | { kind: typeof API_OUTCOME_KINDS.error };

export type ResolveConflictOutcome =
  | { kind: typeof API_OUTCOME_KINDS.resolved; data: ResolveConflictResult }
  | {
      kind: typeof API_OUTCOME_KINDS.validationError;
      reason: typeof API_VALIDATION_REASONS.dismissReasonRequired;
    }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | { kind: typeof API_OUTCOME_KINDS.accessRevoked }
  | { kind: typeof API_OUTCOME_KINDS.alreadyResolved }
  | { kind: typeof API_OUTCOME_KINDS.notFound }
  | { kind: typeof API_OUTCOME_KINDS.error };

export async function getPendingConflicts(
  assessmentId: string,
): Promise<ConflictListOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/conflicts?status=PENDING`,
    {
      cache: "no-store",
    },
  );

  return toConflictListOutcome(payload, ok, status, problemCode);
}

export async function resolveConflict(
  assessmentId: string,
  conflictId: string,
  request: ResolveConflictPayload,
): Promise<ResolveConflictOutcome> {
  if (
    request.resolution === CONFLICT_RECORD_STATUSES.dismissed &&
    (!request.resolution_note || request.resolution_note.trim().length === 0)
  ) {
    return {
      kind: API_OUTCOME_KINDS.validationError,
      reason: API_VALIDATION_REASONS.dismissReasonRequired,
    };
  }

  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "PATCH",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  return toResolveConflictOutcome(payload, ok, status, problemCode);
}

export function toConflictListOutcome(
  payload: unknown,
  ok: boolean,
  status: number,
  problemCode = getProblemCode(payload),
): ConflictListOutcome {
  if (ok) {
    const data = sanitizeConflictListPayload(payload);
    if (!data) {
      return { kind: API_OUTCOME_KINDS.error };
    }
    if (data.conflicts.length === 0) {
      return { kind: API_OUTCOME_KINDS.empty };
    }
    return { kind: API_OUTCOME_KINDS.loaded, data };
  }

  if (problemCode === AUTH_ERROR_CODES.mfaRequired) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: getMfaRedirectLocation(payload),
    };
  }
  if (status === 401 || problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return { kind: API_OUTCOME_KINDS.redirect, location: "/sign-in" };
  }
  if (status === 403 || problemCode === AUTH_ERROR_CODES.pbacDenied) {
    return { kind: API_OUTCOME_KINDS.accessRevoked };
  }
  if (status === 404 && problemCode === ASSESSMENT_ERROR_CODES.notFound) {
    return { kind: API_OUTCOME_KINDS.empty };
  }

  return { kind: API_OUTCOME_KINDS.error };
}

export function toResolveConflictOutcome(
  payload: unknown,
  ok: boolean,
  status: number,
  problemCode = getProblemCode(payload),
): ResolveConflictOutcome {
  if (ok) {
    const data = sanitizeResolveConflictPayload(payload);
    return data
      ? { kind: API_OUTCOME_KINDS.resolved, data }
      : { kind: API_OUTCOME_KINDS.error };
  }

  if (
    status === 400 &&
    problemCode === SCAN_ERROR_CODES.dismissReasonRequired
  ) {
    return {
      kind: API_OUTCOME_KINDS.validationError,
      reason: API_VALIDATION_REASONS.dismissReasonRequired,
    };
  }
  if (problemCode === AUTH_ERROR_CODES.mfaRequired) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: getMfaRedirectLocation(payload),
    };
  }
  if (status === 401 || problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return { kind: API_OUTCOME_KINDS.redirect, location: "/sign-in" };
  }
  if (status === 403 || problemCode === AUTH_ERROR_CODES.pbacDenied) {
    return { kind: API_OUTCOME_KINDS.accessRevoked };
  }
  if (
    status === 409 &&
    problemCode === SCAN_ERROR_CODES.conflictAlreadyResolved
  ) {
    return { kind: API_OUTCOME_KINDS.alreadyResolved };
  }
  if (status === 404 && problemCode === SCAN_ERROR_CODES.conflictNotFound) {
    return { kind: API_OUTCOME_KINDS.notFound };
  }

  return { kind: API_OUTCOME_KINDS.error };
}

export function sanitizeConflictListPayload(
  payload: unknown,
): ConflictListResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as {
    conflicts?: unknown;
    total?: unknown;
    page?: unknown;
    page_size?: unknown;
    correlationId?: unknown;
  };

  if (!Array.isArray(candidate.conflicts)) {
    return null;
  }

  const projected = candidate.conflicts.map(projectConflictSummary);
  if (!projected.every((item) => item !== null)) {
    return null;
  }
  const conflicts = projected as ConflictSummary[];

  if (
    typeof candidate.total !== "number" ||
    typeof candidate.page !== "number" ||
    typeof candidate.page_size !== "number"
  ) {
    return null;
  }

  return {
    conflicts,
    total: candidate.total,
    page: candidate.page,
    page_size: candidate.page_size,
    correlationId:
      typeof candidate.correlationId === "string"
        ? candidate.correlationId
        : undefined,
  };
}

export function sanitizeResolveConflictPayload(
  payload: unknown,
): ResolveConflictResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as {
    conflict_id?: unknown;
    status?: unknown;
    resolved_at?: unknown;
    all_conflicts_resolved?: unknown;
    correlationId?: unknown;
  };

  if (
    typeof candidate.conflict_id !== "string" ||
    (candidate.status !== CONFLICT_RECORD_STATUSES.resolved &&
      candidate.status !== CONFLICT_RECORD_STATUSES.dismissed) ||
    typeof candidate.resolved_at !== "string" ||
    typeof candidate.all_conflicts_resolved !== "boolean"
  ) {
    return null;
  }

  return {
    conflict_id: candidate.conflict_id,
    status: candidate.status,
    resolved_at: candidate.resolved_at,
    all_conflicts_resolved: candidate.all_conflicts_resolved,
    correlationId:
      typeof candidate.correlationId === "string"
        ? candidate.correlationId
        : undefined,
  };
}

export function buildResolveConflictApiBody(
  body: unknown,
): ResolveConflictPayload {
  const request =
    typeof body === "object" && body !== null
      ? (body as { resolution?: unknown; resolution_note?: unknown })
      : {};

  return {
    resolution:
      request.resolution === CONFLICT_RECORD_STATUSES.dismissed
        ? CONFLICT_RECORD_STATUSES.dismissed
        : CONFLICT_RECORD_STATUSES.resolved,
    resolution_note:
      typeof request.resolution_note === "string"
        ? request.resolution_note
        : undefined,
  };
}

function projectConflictSummary(payload: unknown): ConflictSummary | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as {
    conflict_id?: unknown;
    conflict_type?: unknown;
    conflict_score?: unknown;
    score_explanation?: unknown;
    explanation_basis?: unknown;
    status?: unknown;
    evidence_refs?: unknown;
    created_at?: unknown;
  };
  const explanationBasis = projectConflictExplanationBasis(
    candidate.explanation_basis,
  );

  if (
    typeof candidate.conflict_id !== "string" ||
    typeof candidate.conflict_type !== "string" ||
    typeof candidate.conflict_score !== "number" ||
    typeof candidate.score_explanation !== "string" ||
    explanationBasis === null ||
    typeof candidate.status !== "string" ||
    !Array.isArray(candidate.evidence_refs) ||
    !candidate.evidence_refs.every((item) => typeof item === "string") ||
    typeof candidate.created_at !== "string"
  ) {
    return null;
  }

  return {
    conflict_id: candidate.conflict_id,
    conflict_type: candidate.conflict_type,
    conflict_score: candidate.conflict_score,
    score_explanation: candidate.score_explanation,
    explanation_basis: explanationBasis,
    status: candidate.status,
    evidence_refs: candidate.evidence_refs,
    created_at: candidate.created_at,
  };
}

function projectConflictExplanationBasis(
  payload: unknown,
): ConflictExplanationBasis | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as {
    affected_field?: unknown;
    confidence?: unknown;
    materiality_reason?: unknown;
    score_priority_explanation?: unknown;
    source_values?: unknown;
    source_refs?: unknown;
    evidence_context?: unknown;
  };
  const sourceValues = projectConflictSourceValues(candidate.source_values);
  const sourceRefs = projectStringRecord(candidate.source_refs);
  const evidenceContext = projectEvidenceContext(candidate.evidence_context);

  if (
    typeof candidate.affected_field !== "string" ||
    typeof candidate.confidence !== "string" ||
    typeof candidate.materiality_reason !== "string" ||
    typeof candidate.score_priority_explanation !== "string" ||
    sourceValues === null ||
    sourceRefs === null ||
    evidenceContext === null
  ) {
    return null;
  }

  return {
    affected_field: candidate.affected_field,
    confidence: candidate.confidence,
    materiality_reason: candidate.materiality_reason,
    score_priority_explanation: candidate.score_priority_explanation,
    source_values: sourceValues,
    source_refs: sourceRefs,
    evidence_context: evidenceContext,
  };
}

function projectConflictSourceValues(
  payload: unknown,
): ConflictSourceValues | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const candidate = payload as {
    manager_answer?: unknown;
    technical_evidence?: unknown;
  };
  if (
    !isNullableString(candidate.manager_answer) ||
    !isNullableString(candidate.technical_evidence)
  ) {
    return null;
  }

  return {
    manager_answer: candidate.manager_answer ?? null,
    technical_evidence: candidate.technical_evidence ?? null,
  };
}

function projectEvidenceContext(
  payload: unknown,
): ConflictEvidenceContext[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }
  const contexts = payload.map((item) => {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const candidate = item as {
      evidence_ref?: unknown;
      redacted_context?: unknown;
      coverage_limitations?: unknown;
    };
    if (
      typeof candidate.evidence_ref !== "string" ||
      typeof candidate.redacted_context !== "string" ||
      typeof candidate.coverage_limitations !== "string"
    ) {
      return null;
    }
    return {
      evidence_ref: candidate.evidence_ref,
      redacted_context: candidate.redacted_context,
      coverage_limitations: candidate.coverage_limitations,
    };
  });

  return contexts.every((item) => item !== null)
    ? (contexts as ConflictEvidenceContext[])
    : null;
}

function projectStringRecord(payload: unknown): Record<string, string> | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const entries = Object.entries(payload);
  if (!entries.every((entry) => typeof entry[1] === "string")) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}
