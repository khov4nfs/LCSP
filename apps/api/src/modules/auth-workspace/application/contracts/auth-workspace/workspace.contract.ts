import type { AuthUserRole } from "@lcsp/contracts/auth";
import type { AuthorizationDecision } from "../../../domain/models/auth-workspace.models.ts";

export type WorkspaceAuthorization = {
  ok: true;
  decision: AuthorizationDecision;
  role: AuthUserRole;
};

export type WorkspaceSuccess = {
  ok: true;
  user_id: string;
  display_name: string;
  role: AuthUserRole;
  session_expires_at: string;
  mfa_verified: boolean;
  correlationId: string;
};
