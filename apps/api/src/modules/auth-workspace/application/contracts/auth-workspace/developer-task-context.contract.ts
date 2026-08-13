import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

export const DEVELOPER_TASK_CONTEXT_ERROR_CODES = {
  sessionInvalid: AUTH_ERROR_CODES.sessionInvalid,
  mfaRequired: AUTH_ERROR_CODES.mfaRequired,
  pbacDenied: AUTH_ERROR_CODES.pbacDenied,
  taskScopeNotFound: "TASK_SCOPE_NOT_FOUND",
} as const;

export type DeveloperTaskContextResponse = {
  organization: { id: string; name: string };
  scope:
    | {
        type: "assessment";
        assessment: { id: string; name: string };
      }
    | { type: "organization"; assessment: null };
  granted_actions: string[];
  session_expires_at: string;
  correlationId: string;
};
