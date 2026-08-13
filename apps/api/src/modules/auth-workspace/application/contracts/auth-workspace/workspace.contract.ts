import type { AuthMembershipStatus } from "@lcsp/contracts/auth";
import type { AuthorizationDecision } from "../../../domain/models/auth-workspace.models.ts";
import type { AuthProblemResult } from "./common.contract.ts";

export type WorkspaceRequest = {
  correlationId?: string;
  organization_id?: string;
  session_token?: string;
};

export type WorkspaceAuthorization =
  | AuthProblemResult
  | {
      ok: true;
      decision: AuthorizationDecision;
      membership_status: AuthMembershipStatus;
      subject_role: string;
      granted_actions: string[];
    };

export type WorkspaceSuccess = {
  ok: true;
  organization_id: string;
  organization_name: string;
  user_id: string;
  display_name: string;
  membership_status: AuthMembershipStatus;
  subject_role: string;
  granted_actions: string[];
  session_expires_at: string;
  mfa_verified: boolean;
  correlationId: string;
};
