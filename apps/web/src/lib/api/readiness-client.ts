import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import { PUBLIC_ENTRY_ROUTES } from "../../auth-entry.ts";
import { apiRequest } from "./api-request.ts";
import { API_OUTCOME_KINDS } from "./outcome-kinds.ts";

export type ReadinessStatusViewModel = {
  classificationLocked: boolean;
  missingEvidence: Array<{
    type: string;
    label: string;
    description: string;
  }>;
  unresolvedUnknowns: Array<{
    questionId: string;
    label: string;
    answerState: string;
  }>;
  readinessMode: string | null;
  completedSteps: string[];
  nextAction: string;
  updatedAt: string;
};

type ReadinessStatusOutcome =
  | { kind: typeof API_OUTCOME_KINDS.loaded; data: ReadinessStatusViewModel }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: string;
      detailKey: string;
    };

export type ReadinessExportOutcome =
  | {
      kind: typeof API_OUTCOME_KINDS.created;
      data: {
        exportId: string;
        fileName: string;
        downloadUrl: string;
      };
    }
  | { kind: typeof API_OUTCOME_KINDS.redirect; location: string }
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: string;
      detailKey: string;
    };

type ReadinessPayload = {
  classification_locked?: unknown;
  missing_evidence?: unknown;
  unresolved_unknown_items?: unknown;
  readiness_mode?: unknown;
  completed_steps?: unknown;
  next_action?: unknown;
  updated_at?: unknown;
};

type ReadinessExportPayload = {
  export_id?: unknown;
  file_name?: unknown;
  download_url?: unknown;
  media_type?: unknown;
  readiness_only?: unknown;
};

export async function getReadinessStatus(
  assessmentId: string,
): Promise<ReadinessStatusOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/readiness`,
    {
      cache: "no-store",
    },
  );

  if (ok && isReadinessPayload(payload)) {
    return {
      kind: API_OUTCOME_KINDS.loaded,
      data: {
        classificationLocked: payload.classification_locked,
        missingEvidence: payload.missing_evidence,
        unresolvedUnknowns: payload.unresolved_unknown_items,
        readinessMode: payload.readiness_mode,
        completedSteps: payload.completed_steps,
        nextAction: payload.next_action,
        updatedAt: payload.updated_at,
      },
    };
  }

  if (
    status === 401 ||
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid
  ) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: PUBLIC_ENTRY_ROUTES.signIn,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.readiness.errorTitle",
    detailKey: "pages.readiness.errorDetail",
  };
}

export function isReadinessPayload(payload: unknown): payload is {
  classification_locked: boolean;
  missing_evidence: Array<{
    type: string;
    label: string;
    description: string;
  }>;
  unresolved_unknown_items: Array<{
    questionId: string;
    label: string;
    answerState: string;
  }>;
  readiness_mode: string | null;
  completed_steps: string[];
  next_action: string;
  updated_at: string;
} {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as ReadinessPayload;
  return (
    typeof candidate.classification_locked === "boolean" &&
    Array.isArray(candidate.missing_evidence) &&
    candidate.missing_evidence.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { type?: unknown }).type === "string" &&
        typeof (item as { label?: unknown }).label === "string" &&
        typeof (item as { description?: unknown }).description === "string",
    ) &&
    Array.isArray(candidate.unresolved_unknown_items) &&
    candidate.unresolved_unknown_items.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { questionId?: unknown }).questionId === "string" &&
        typeof (item as { label?: unknown }).label === "string" &&
        typeof (item as { answerState?: unknown }).answerState === "string",
    ) &&
    (typeof candidate.readiness_mode === "string" ||
      candidate.readiness_mode === null) &&
    Array.isArray(candidate.completed_steps) &&
    candidate.completed_steps.every((item) => typeof item === "string") &&
    typeof candidate.next_action === "string" &&
    typeof candidate.updated_at === "string"
  );
}

export async function generateReadinessExport(
  assessmentId: string,
): Promise<ReadinessExportOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/wizard/readiness-export`,
    { method: "POST" },
  );

  if (ok && isReadinessExportPayload(payload)) {
    return {
      kind: API_OUTCOME_KINDS.created,
      data: {
        exportId: payload.export_id,
        fileName: payload.file_name,
        downloadUrl: `/api${payload.download_url}`,
      },
    };
  }

  if (
    status === 401 ||
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid
  ) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: PUBLIC_ENTRY_ROUTES.signIn,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.readiness.exportErrorTitle",
    detailKey: "pages.readiness.exportErrorDetail",
  };
}

export function isReadinessExportPayload(payload: unknown): payload is {
  export_id: string;
  file_name: string;
  download_url: string;
  media_type: "application/pdf";
  readiness_only: true;
} {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as ReadinessExportPayload;
  return (
    typeof candidate.export_id === "string" &&
    typeof candidate.file_name === "string" &&
    typeof candidate.download_url === "string" &&
    candidate.media_type === "application/pdf" &&
    candidate.readiness_only === true
  );
}
