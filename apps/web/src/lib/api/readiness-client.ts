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
  repositoryConnection: {
    connectionId: string;
    provider: string;
    repositoryId: string;
    repositoryFullName: string;
    defaultBranch: string;
    status: string;
  } | null;
};

type ReadinessStatusOutcome =
  | { kind: typeof API_OUTCOME_KINDS.loaded; data: ReadinessStatusViewModel }
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
  repository_connection?: ReadinessConnectionPayload | null;
};

type ReadinessConnectionPayload = {
  connection_id: string;
  provider: string;
  repository_id: string;
  repository_full_name: string;
  default_branch: string;
  status: string;
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
        repositoryConnection: payload.repository_connection
          ? {
              connectionId: payload.repository_connection.connection_id,
              provider: payload.repository_connection.provider,
              repositoryId: payload.repository_connection.repository_id,
              repositoryFullName:
                payload.repository_connection.repository_full_name,
              defaultBranch: payload.repository_connection.default_branch,
              status: payload.repository_connection.status,
            }
          : null,
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
  repository_connection?: {
    connection_id: string;
    provider: string;
    repository_id: string;
    repository_full_name: string;
    default_branch: string;
    status: string;
  } | null;
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
    typeof candidate.updated_at === "string" &&
    (candidate.repository_connection === undefined ||
      candidate.repository_connection === null ||
      (typeof candidate.repository_connection === "object" &&
        typeof candidate.repository_connection.connection_id === "string" &&
        typeof candidate.repository_connection.repository_full_name ===
          "string"))
  );
}
