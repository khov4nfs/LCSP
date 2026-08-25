import { SIGN_UP_ERROR_CODES } from "@lcsp/contracts/auth";

export type SignUpPayload = {
  email?: unknown;
  display_name?: unknown;
  organization_name?: unknown;
  password?: unknown;
};

export type SignUpResponse = {
  user_id: string;
  session_token: string;
  expires_at: string;
  organization_id: string;
  allowed_actions: string[];
  correlationId: string;
};

export type SignUpErrorCode =
  (typeof SIGN_UP_ERROR_CODES)[keyof typeof SIGN_UP_ERROR_CODES];
