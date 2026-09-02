import {
  WIZARD_STATUS_CODES,
  type WizardStatusCode,
} from "@lcsp/contracts/assessment";
import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { PUBLIC_ENTRY_ROUTES } from "../../auth-entry.ts";
import {
  assessmentStatusLabelKeys,
  wizardStatusLabelKeys,
} from "../../features/workspace/config/status-labels.ts";
import type {
  AssessmentStatus,
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
  display_name: string;
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

export function getAssessmentStatusLabelKey(
  status: AssessmentStatus,
): MessageKey {
  return assessmentStatusLabelKeys[status];
}

export function getWizardStatusLabelKey(
  status: keyof typeof wizardStatusLabelKeys,
): MessageKey {
  return wizardStatusLabelKeys[status];
}

export function getAssessmentActiveHref(assessment: {
  id: string;
  status: string;
  wizard_status: string;
}): string {
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

  if (ok && isCreatedAssessmentPayload(payload)) {
    return {
      kind: API_OUTCOME_KINDS.created,
      assessmentId: payload.assessment_id,
    };
  }

  return {
    kind: API_OUTCOME_KINDS.error,
    titleKey: "pages.workspace.errors.createAssessmentTitle",
    detailKey: "pages.workspace.errors.createAssessmentDetail",
  };
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
    problemCode === AUTH_ERROR_CODES.sessionInvalid
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
  if (ok && isAssessmentsPayload(payload)) {
    const rawAssessments = (payload as { assessments: unknown[] }).assessments;
    const normalizedAssessments: AssessmentSummary[] = rawAssessments.map(
      (item) => {
        const candidate = item as Record<string, unknown>;
        return {
          id: (candidate.id ?? candidate.assessment_id) as string,
          name: candidate.name as string,
          status: candidate.status as AssessmentStatus,
          wizard_status: candidate.wizard_status as WizardStatusCode,
          created_at: candidate.created_at as string,
        };
      },
    );

    return {
      kind: API_OUTCOME_KINDS.loaded,
      assessments: normalizedAssessments,
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
      display_name: payload.display_name,
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
    typeof candidate.display_name === "string" &&
    isAuthUserRole(candidate.role)
  );
}

function isAuthUserRole(role: unknown): role is AuthUserRole {
  return (
    typeof role === "string" &&
    Object.values(AUTH_USER_ROLES).some((knownRole) => knownRole === role)
  );
}

function isAssessmentsPayload(
  payload: unknown,
): payload is { assessments: AssessmentSummary[] } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const assessments = (payload as { assessments?: unknown }).assessments;
  return (
    Array.isArray(assessments) &&
    assessments.every((assessment) => isAssessmentSummary(assessment))
  );
}

function isAssessmentSummary(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  const id =
    typeof candidate.id === "string" ? candidate.id : candidate.assessment_id;
  return (
    typeof id === "string" &&
    typeof candidate.name === "string" &&
    isAssessmentStatus(candidate.status) &&
    isWizardStatus(candidate.wizard_status) &&
    typeof candidate.created_at === "string"
  );
}

function isCreatedAssessmentPayload(
  payload: unknown,
): payload is { assessment_id: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { assessment_id?: unknown }).assessment_id === "string"
  );
}

function isWizardStatus(status: unknown): boolean {
  return (
    typeof status === "string" &&
    Object.values(WIZARD_STATUS_CODES).some(
      (knownStatus) => knownStatus === status,
    )
  );
}

function isAssessmentStatus(status: unknown): status is AssessmentStatus {
  return (
    typeof status === "string" &&
    Object.hasOwn(assessmentStatusLabelKeys, status)
  );
}
