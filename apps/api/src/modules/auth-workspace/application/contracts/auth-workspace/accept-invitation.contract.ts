import { ACCEPT_INVITATION_ERROR_CODES } from "@lcsp/contracts/auth";

export type AcceptInvitationRequest = {
  invitation_token?: string;
  display_name?: string;
  password?: string;
};

export type AcceptInvitationResponse = {
  user_id: string;
  session_token: string;
  expires_at: string;
  organization_id: string;
  allowed_actions: string[];
  scope:
    | { type: "assessment"; assessment_id: string }
    | { type: "organization"; assessment_id: null };
  correlationId: string;
};

export type AcceptInvitationErrorCode =
  (typeof ACCEPT_INVITATION_ERROR_CODES)[keyof typeof ACCEPT_INVITATION_ERROR_CODES];
