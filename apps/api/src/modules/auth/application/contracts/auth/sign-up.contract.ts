import { SIGN_UP_ERROR_CODES } from "@lcsp/contracts/auth";

export type SignUpPayload = {
  email?: unknown;
  display_name?: unknown;
  password?: unknown;
};

export type SignUpResponse = {
  user_id: string;
  session_token: string;
  expires_at: string;
  correlationId: string;
};

export type SignUpErrorCode =
  (typeof SIGN_UP_ERROR_CODES)[keyof typeof SIGN_UP_ERROR_CODES];
