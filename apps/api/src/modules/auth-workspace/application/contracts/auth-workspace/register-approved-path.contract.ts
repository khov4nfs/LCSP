import type { SafeUserProjection } from "./common.contract.ts";

export type RegisterPayload = {
  invite_id?: unknown;
  password?: unknown;
};

export type RegisterSuccess = {
  ok: true;
  correlationId: string;
  session_token: string;
  user: SafeUserProjection;
};
