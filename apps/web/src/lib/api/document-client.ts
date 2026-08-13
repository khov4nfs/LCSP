import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  DOCUMENT_ERROR_CODES,
  type DocumentRequestStatus,
  type DocumentType,
} from "@lcsp/contracts/document";
import type { MessageKey } from "@lcsp/i18n";

import { PUBLIC_ENTRY_ROUTES } from "../../auth-entry.ts";
import { apiRequest } from "./api-request.ts";
import { API_OUTCOME_KINDS } from "./outcome-kinds.ts";
import { getProblemCode } from "./problem-envelope.ts";

export type DocumentRequestOutcome =
  | { kind: typeof API_OUTCOME_KINDS.requested; data: DocumentRequestResult }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    }
  | {
      kind: typeof API_OUTCOME_KINDS.blocked;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type DocumentStatusOutcome =
  | { kind: typeof API_OUTCOME_KINDS.loaded; data: DocumentStatusResult }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
    };

export type DocumentRequestResult = {
  document_request_id: string;
  status: string;
  document_type: string;
  correlationId: string;
};

export type DocumentStatusResult = {
  document_request_id: string;
  document_type: DocumentType;
  status: DocumentRequestStatus;
  blocked_reason: string | null;
  guardrail_status: string | null;
  download_url: string | null;
  download_url_expires_at: string | null;
  requested_at: string;
  completed_at: string | null;
  correlationId: string;
};

export async function getDocuments(
  assessmentId: string,
): Promise<DocumentStatusResult[]> {
  const { payload, ok } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/documents`,
    {
      cache: "no-store",
    },
  );

  if (!ok) {
    return [];
  }

  return Array.isArray(payload) ? payload.filter(isDocumentStatusResult) : [];
}

export async function requestFinalReport(
  assessmentId: string,
): Promise<DocumentRequestOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/documents/final-report`,
    {
      method: "POST",
      cache: "no-store",
    },
  );

  return toDocumentRequestOutcome(payload, ok, status, problemCode);
}

export async function requestGapAnalysis(
  assessmentId: string,
): Promise<DocumentRequestOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/documents/gap-analysis`,
    {
      method: "POST",
      cache: "no-store",
    },
  );

  return toDocumentRequestOutcome(payload, ok, status, problemCode);
}

export async function getDocumentStatus(
  assessmentId: string,
  documentRequestId: string,
): Promise<DocumentStatusOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/documents/${encodeURIComponent(documentRequestId)}`,
    {
      cache: "no-store",
    },
  );

  return toDocumentStatusOutcome(payload, ok, status, problemCode);
}

export function toDocumentRequestOutcome(
  payload: unknown,
  ok: boolean,
  status: number,
  problemCode = getProblemCode(payload),
): DocumentRequestOutcome {
  if (ok && isDocumentRequestResult(payload)) {
    return { kind: API_OUTCOME_KINDS.requested, data: payload };
  }

  if (status === 401 || problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: PUBLIC_ENTRY_ROUTES.signIn,
    };
  }

  if (
    status === 409 &&
    problemCode === DOCUMENT_ERROR_CODES.classificationGuardrailNotPassed
  ) {
    return {
      kind: API_OUTCOME_KINDS.blocked,
      titleKey: "pages.classification.errorTitle",
      detailKey: "pages.classification.documentGuardrailBlocked",
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.classification.errorTitle",
    detailKey: "pages.classification.errorDetail",
  };
}

export function toDocumentStatusOutcome(
  payload: unknown,
  ok: boolean,
  status: number,
  problemCode = getProblemCode(payload),
): DocumentStatusOutcome {
  if (ok && isDocumentStatusResult(payload)) {
    return { kind: API_OUTCOME_KINDS.loaded, data: payload };
  }

  if (status === 401 || problemCode === AUTH_ERROR_CODES.sessionInvalid) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: PUBLIC_ENTRY_ROUTES.signIn,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.classification.errorTitle",
    detailKey: "pages.classification.errorDetail",
  };
}

function isDocumentRequestResult(
  payload: unknown,
): payload is DocumentRequestResult {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as DocumentRequestResult;
  return (
    typeof candidate.document_request_id === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.document_type === "string" &&
    typeof candidate.correlationId === "string"
  );
}

function isDocumentStatusResult(
  payload: unknown,
): payload is DocumentStatusResult {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as DocumentStatusResult;
  return (
    typeof candidate.document_request_id === "string" &&
    typeof candidate.document_type === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.requested_at === "string" &&
    typeof candidate.correlationId === "string"
  );
}

export function sanitizeDocumentRequestPayload(
  payload: unknown,
): DocumentRequestResult | null {
  return isDocumentRequestResult(payload) ? payload : null;
}

export function sanitizeDocumentStatusPayload(
  payload: unknown,
): DocumentStatusResult | null {
  return isDocumentStatusResult(payload) ? payload : null;
}
