import { INVITE_DEVELOPER_ERROR_CODES } from "@lcsp/contracts/auth";

export type InviteDeveloperRequest = {
  email?: string;
  assessment_id?: string;
  allowed_actions?: string[];
  expires_in_hours?: number;
};

export type InviteDeveloperResponse = {
  invitation_id: string;
  email: string;
  expires_at: string;
  allowed_actions: string[];
  correlationId: string;
};

export type InviteDeveloperErrorCode =
  (typeof INVITE_DEVELOPER_ERROR_CODES)[keyof typeof INVITE_DEVELOPER_ERROR_CODES];
