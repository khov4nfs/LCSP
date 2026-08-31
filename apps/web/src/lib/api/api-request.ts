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
  requiredAction?: RequiredAction;
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

  traceAuthRequest({
    input,
    status: response.status,
    problemCode,
    requiredAction,
    correlationId: getProblemCorrelationId(result),
  });

  redirectToSignInOnExpiredSession(input, problemCode, requiredAction);

  return {
    result,
    payload,
    ok: response.ok && result?.ok === true,
    status: response.status,
    problemCode,
    requiredAction,
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
  traceAuthRedirect({
    input,
    problemCode,
    requiredAction,
    destination,
  });
  if (window.location.pathname !== API_REDIRECT_LOCATIONS.signIn) {
    window.location.assign(destination);
  }
}

function traceAuthRequest(input: {
  input: RequestInfo | URL;
  status: number;
  problemCode: string | undefined;
  requiredAction: RequiredAction | undefined;
  correlationId: string | undefined;
}) {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    return;
  }
  if (
    input.status < 400 &&
    input.problemCode !== AUTH_ERROR_CODES.sessionInvalid &&
    input.problemCode !== AUTH_ERROR_CODES.authRequired
  ) {
    return;
  }
  console.debug("[auth-trace] request", {
    route: requestPath(input.input),
    status: input.status,
    problemCode: input.problemCode,
    requiredAction: input.requiredAction,
    correlationId: input.correlationId,
  });
}

function traceAuthRedirect(input: {
  input: RequestInfo | URL;
  problemCode: string | undefined;
  requiredAction: RequiredAction | undefined;
  destination: string;
}) {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    return;
  }
  console.debug("[auth-trace] redirect", {
    route: requestPath(input.input),
    problemCode: input.problemCode,
    requiredAction: input.requiredAction,
    destination: input.destination,
  });
}

function getProblemCorrelationId(
  payload: AppResult | null,
): string | undefined {
  if (!payload || payload.ok || !payload.problem) return undefined;
  return payload.problem.correlationId;
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
