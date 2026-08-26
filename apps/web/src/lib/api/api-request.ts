import {
  AUTH_ERROR_CODES,
  REQUIRED_ACTIONS,
  type AppResult,
  type RequiredAction,
} from "@lcsp/contracts/auth";

import {
  getProblemCode,
  getProblemRequiredAction,
} from "./problem-envelope.ts";
import { API_REDIRECT_LOCATIONS } from "./outcome-kinds.ts";

export type ApiRequestResult = {
  payload: unknown;
  result: AppResult | null;
  ok: boolean;
  status: number;
  problemCode?: string;
};

export async function apiRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiRequestResult> {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
  });
  const result = toApiResult(await response.json().catch(() => null));
  const payload = result?.ok === true ? result.data : result;
  const problemCode = getProblemCode(result);
  const requiredAction = getProblemRequiredAction(result);

  redirectToSignInOnExpiredSession(input, problemCode, requiredAction);

  return {
    result,
    payload,
    ok: response.ok && result?.ok === true,
    status: response.status,
    problemCode,
  };
}

export async function apiJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T | null> {
  const { payload, ok } = await apiRequest(input, init);
  return ok ? (payload as T) : null;
}

function toApiResult(payload: unknown): AppResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const result = payload as Partial<AppResult>;
  return result.ok === true || result.ok === false
    ? (payload as AppResult)
    : null;
}

export function isExpiredSessionProblem(
  problemCode: string | undefined,
  requiredAction?: RequiredAction,
) {
  return (
    requiredAction === REQUIRED_ACTIONS.signIn ||
    problemCode === AUTH_ERROR_CODES.authRequired ||
    problemCode === AUTH_ERROR_CODES.sessionInvalid
  );
}

export function isSessionEstablishmentProblem(
  path: string,
  problemCode: string | undefined,
  requiredAction?: RequiredAction,
) {
  return (
    path === "/api/auth/profile" &&
    problemCode === AUTH_ERROR_CODES.rbacDenied &&
    requiredAction === REQUIRED_ACTIONS.contactOwner
  );
}

type BrowserLocationPath = {
  pathname: string;
  search: string;
};

export function signInRedirectForCurrentLocation(
  location: BrowserLocationPath,
): string {
  const nextPath = `${location.pathname}${location.search}`;
  if (location.pathname === API_REDIRECT_LOCATIONS.signIn) {
    return API_REDIRECT_LOCATIONS.signIn;
  }
  return `${API_REDIRECT_LOCATIONS.signIn}?next=${encodeURIComponent(nextPath)}`;
}

function redirectToSignInOnExpiredSession(
  input: RequestInfo | URL,
  problemCode: string | undefined,
  requiredAction: RequiredAction | undefined,
) {
  const path = requestPath(input);
  if (
    !(
      isExpiredSessionProblem(problemCode, requiredAction) ||
      isSessionEstablishmentProblem(path, problemCode, requiredAction)
    ) ||
    typeof window === "undefined"
  ) {
    return;
  }

  const destination = signInRedirectForCurrentLocation(window.location);
  if (window.location.pathname !== API_REDIRECT_LOCATIONS.signIn) {
    window.location.assign(destination);
  }
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return input.url;
}
