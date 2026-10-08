import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { PUBLIC_ENTRY_ROUTES } from "../../auth-entry.ts";
import { assessmentListSchema, assessmentDetailSchema } from "@lcsp/contracts/assessment-domain";
import type {
  AssessmentSummary,
  AssessmentsOutcome,
  WorkspaceContext,
  WorkspaceErrorOutcome,
  WorkspaceOutcome,
} from "../../features/workspace/types/workspace.types.ts";
import { apiRequest } from "./api-request.ts";
import { API_OUTCOME_KINDS } from "./outcome-kinds.ts";
import { getMfaRedirectLocation, getProblemCode } from "./problem-envelope.ts";

export const WORKSPACE_ROUTES = Object.freeze({
  mfaVerify: "/mfa/verify",
});

const workspaceApiPaths = Object.freeze({
  workspace: "/api/workspace",
  assessments: "/api/assessments",
});

type WorkspaceApiPayload = {
  user_id: string;
  display_name?: string | null;
  email?: string;
  role: AuthUserRole;
};

export type WorkspaceSelectionOption = {
  id: string;
  name: string;
  member_count?: number;
  last_sign_in_days_ago?: number;
};

export type WorkspaceSelectionPayload = {
  email?: string;
  workspaces: WorkspaceSelectionOption[];
  selected_workspace_id?: string;
};

export function canCreateAssessment(role: AuthUserRole) {
  return role === AUTH_USER_ROLES.customer;
}

export function getAssessmentActiveHref(assessment: { id: string }): string {
  const encodedId = encodeURIComponent(assessment.id);
  return `/assessments/${encodedId}`;
}

export async function getWorkspace(): Promise<WorkspaceOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    workspaceApiPaths.workspace,
  );

  return toWorkspaceOutcome(payload, ok, status, problemCode);
}

export async function getAssessments(): Promise<AssessmentsOutcome> {
  const { payload, ok } = await apiRequest(workspaceApiPaths.assessments);

  return toAssessmentsOutcome(payload, ok);
}

export async function createAssessment(
  name: string,
  description?: string,
): Promise<
  | { kind: typeof API_OUTCOME_KINDS.created; assessmentId: string }
  | WorkspaceErrorOutcome
> {
  const { payload, ok } = await apiRequest(workspaceApiPaths.assessments, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description }),
  });

  const created = assessmentDetailSchema.safeParse(payload);
  if (ok && created.success) {
    return {
      kind: API_OUTCOME_KINDS.created,
      assessmentId: created.data.assessment_id,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.workspace.errors.createAssessmentTitle",
    detailKey: "pages.workspace.errors.createAssessmentDetail",
  };
}

export async function renameAssessment(
  assessmentId: string,
  name: string,
): Promise<void> {
  const { ok } = await apiRequest(
    `${workspaceApiPaths.assessments}/${encodeURIComponent(assessmentId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!ok) {
    throw new Error("assessment-rename-failed");
  }
}

export async function deleteAssessment(assessmentId: string): Promise<void> {
  const { ok } = await apiRequest(
    `${workspaceApiPaths.assessments}/${encodeURIComponent(assessmentId)}`,
    { method: "DELETE" },
  );
  if (!ok) {
    throw new Error("assessment-delete-failed");
  }
}

export async function getWorkspaceSelection(): Promise<WorkspaceSelectionPayload> {
  const { payload, ok } = await apiRequest("/api/mock/workspace-selection");

  if (!ok) {
    throw new Error("workspace-selection-load-failed");
  }

  const candidate = payload as WorkspaceSelectionPayload;
  return {
    email: typeof candidate.email === "string" ? candidate.email : undefined,
    workspaces: Array.isArray(candidate.workspaces) ? candidate.workspaces : [],
    selected_workspace_id:
      typeof candidate.selected_workspace_id === "string"
        ? candidate.selected_workspace_id
        : undefined,
  };
}

export async function persistWorkspaceSelection(
  workspaceId: string,
): Promise<WorkspaceSelectionOption> {
  const { payload, ok } = await apiRequest("/api/mock/workspace-selection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
  const candidate = payload as {
    selected_workspace?: WorkspaceSelectionOption;
  } | null;

  if (!ok || !candidate?.selected_workspace) {
    throw new Error("workspace-selection-save-failed");
  }

  return candidate.selected_workspace;
}

export function toWorkspaceOutcome(
  payload: unknown,
  ok: boolean,
  status?: number,
  problemCode = getProblemCode(payload),
): WorkspaceOutcome {
  if (ok && isWorkspaceContextPayload(payload)) {
    return {
      kind: API_OUTCOME_KINDS.loaded,
      workspace: normalizeWorkspacePayload(payload),
    };
  }

  if (ok && isWorkspaceApiPayload(payload)) {
    return {
      kind: API_OUTCOME_KINDS.loaded,
      workspace: normalizeWorkspaceApiPayload(payload),
    };
  }

  if (
    status === 401 ||
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid ||
    problemCode === AUTH_ERROR_CODES.accountSuspended
  ) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: PUBLIC_ENTRY_ROUTES.signIn,
    };
  }

  if (problemCode === AUTH_ERROR_CODES.mfaRequired) {
    return {
      kind: API_OUTCOME_KINDS.redirect,
      location: getMfaRedirectLocation(payload),
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.workspace.errors.workspaceUnavailableTitle",
    detailKey: "pages.workspace.errors.workspaceUnavailableDetail",
  };
}

export function toAssessmentsOutcome(
  payload: unknown,
  ok: boolean,
): AssessmentsOutcome {
  const parsed = assessmentListSchema.safeParse(payload);
  if (ok && parsed.success) {
    return {
      kind: API_OUTCOME_KINDS.loaded,
      assessments: parsed.data.assessments.map((item) => ({
        id: item.assessment_id,
        name: item.name,
        lifecycle: item.lifecycle,
        runtime: item.runtime,
        created_at: item.created_at,
      })),
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.workspace.errors.assessmentsUnavailableTitle",
    detailKey: "pages.workspace.errors.assessmentsUnavailableDetail",
  };
}

function normalizeWorkspacePayload(
  payload: WorkspaceContext,
): WorkspaceContext {
  return {
    user: {
      id: payload.user.id,
      display_name: payload.user.display_name,
      role: payload.user.role,
    },
  };
}

function normalizeWorkspaceApiPayload(
  payload: WorkspaceApiPayload,
): WorkspaceContext {
  return {
    user: {
      id: payload.user_id,
      display_name: payload.display_name ?? payload.email ?? "",
      role: payload.role,
    },
  };
}

function isWorkspaceContextPayload(
  payload: unknown,
): payload is WorkspaceContext {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as WorkspaceContext;
  return (
    typeof candidate.user?.id === "string" &&
    typeof candidate.user.display_name === "string" &&
    isAuthUserRole(candidate.user.role)
  );
}

function isWorkspaceApiPayload(
  payload: unknown,
): payload is WorkspaceApiPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.user_id === "string" &&
    (typeof candidate.display_name === "string" ||
      candidate.display_name === null ||
      typeof candidate.email === "string") &&
    isAuthUserRole(candidate.role)
  );
}

function isAuthUserRole(role: unknown): role is AuthUserRole {
  return (
    typeof role === "string" &&
    Object.values(AUTH_USER_ROLES).some((knownRole) => knownRole === role)
  );
}
