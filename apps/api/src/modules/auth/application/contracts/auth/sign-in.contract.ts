import type { SafeUserProjection } from "./common.contract.ts";

export type CredentialPayload = {
  email?: unknown;
  password?: unknown;
};

export type SignInSuccess = {
  ok: true;
  correlationId: string;
  session_token: string;
  user: SafeUserProjection;
  mfa_required?: boolean;
  mfa_enrolled?: boolean;
};
