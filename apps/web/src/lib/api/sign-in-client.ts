import type { MessageKey } from "@lcsp/i18n";

import {
  type SignInOutcome,
  type SignInRequest,
  toSignInOutcome,
} from "./auth-client.ts";
import { apiRequest } from "./api-request.ts";
import { API_OUTCOME_KINDS } from "./outcome-kinds.ts";

const SERVER_ERROR_STATUS = 500;

type SafeSignInOutcome =
  | Exclude<SignInOutcome, { kind: typeof API_OUTCOME_KINDS.error }>
  | {
      kind: typeof API_OUTCOME_KINDS.error;
      titleKey: MessageKey;
      detailKey: MessageKey;
      lockedUntil?: string;
      retryAfterSeconds?: number;
    };

export function toSafeSignInOutcome(
  payload: unknown,
  ok: boolean,
  status: number,
  problemCode?: string,
): SafeSignInOutcome {
  // Server failures are operational errors, not evidence of invalid credentials.
  if (!ok && status >= SERVER_ERROR_STATUS) {
    return {
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.signIn.errors.requestFailedTitle",
      detailKey: "pages.signIn.errors.requestFailedDetail",
    };
  }

  return toSignInOutcome(payload, ok, problemCode);
}

export async function signIn(
  credentials: SignInRequest,
): Promise<SafeSignInOutcome> {
  const { payload, ok, status, problemCode } = await apiRequest(
    "/api/auth/sign-in",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    },
  );

  return toSafeSignInOutcome(payload, ok, status, problemCode);
}
