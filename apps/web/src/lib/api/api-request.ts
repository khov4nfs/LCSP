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
import type { z } from "zod";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { getAppLocaleSnapshot } from "../locale.ts";

export type ApiRequestResult = {
  payload: unknown;
  result: AppResult | null;
  ok: boolean;
  status: number;
  problemCode?: string;
  requiredAction?: RequiredAction;
};

type ApiProblem =
  Exclude<AppResult, { ok: true }> extends { problem: infer P } ? P : never;

export class ApiRequestError extends Error {
  constructor(
    readonly problemCode: string,
    readonly problem?: ApiProblem,
  ) {
    super(problemCode);
    this.name = "ApiRequestError";
  }
}

/**
 * Business purpose: Give browser API callers one result projection and shared expired-session
 *   routing behavior.
 *
 * Business rules:
 * - Default to same-origin credentials, preserve caller options and add the active browser
 *   locale only when no locale header was supplied.
 * - A 204 is successful without JSON; other success requires both HTTP success and a
 *   recognizable success envelope.
 *
 * Execution flow:
 * 1. Prepare headers and execute the request.
 * 2. Parse the response envelope defensively and extract problem metadata.
 * 3. Run the existing development trace/session redirect policy and return the normalized
 *   request result.
 *
 * Failure cases:
 * - Network failures propagate; malformed/non-JSON responses become an unsuccessful null
 *   result except for 204.
 *
 * Side effects:
 * - Performs fetch and may redirect the browser for an expired/unestablished session;
 *   development-only tracing records request metadata.
 */
export async function apiRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiRequestResult> {
  const requestHeaders = new Headers(init?.headers);
  if (!requestHeaders.has("x-lcsp-locale") && typeof window !== "undefined") {
    const activeLocale = getAppLocaleSnapshot();
    if (activeLocale) {
      requestHeaders.set("x-lcsp-locale", activeLocale);
    }
  }

  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers: requestHeaders,
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
    ok: response.status === 204 || (response.ok && result?.ok === true),
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

/**
 * Business purpose: Return a schema-validated domain payload or a typed API problem to
 *   application callers.
 *
 * Business rules:
 * - Reuse apiRequest for credentials, envelopes and session handling; accept payloads only
 *   through the supplied schema.
 *
 * Execution flow:
 * 1. Execute the shared API request and reject unsuccessful results.
 * 2. Validate the success payload and return its parsed value.
 *
 * Failure cases:
 * - Unsuccessful requests throw ApiRequestError with the upstream code/problem or
 *   upstreamUnavailable; invalid success payloads throw upstreamResponseInvalid; transport
 *   errors propagate.
 *
 * Side effects:
 * - Performs the shared request and its existing redirect/trace effects; no separate
 *   persistence.
 */
export async function apiValidated<T>(
  input: RequestInfo | URL,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await apiRequest(input, init);
  if (!response.ok) {
    const problem =
      response.result && !response.result.ok
        ? response.result.problem
        : undefined;
    throw new ApiRequestError(
      response.problemCode ?? SHARED_ERROR_CODES.upstreamUnavailable,
      problem,
    );
  }
  const parsed = schema.safeParse(response.payload);
  if (!parsed.success)
    throw new ApiRequestError(SHARED_ERROR_CODES.upstreamResponseInvalid);
  return parsed.data;
}

/**
 * Business purpose: Complete a command request whose caller does not consume a success
 *   payload.
 *
 * Business rules:
 * - Use the shared API success definition, including 204; do not invent endpoint-specific
 *   problem shapes.
 *
 * Execution flow:
 * 1. Execute apiRequest and return on success.
 * 2. Throw a typed API error with retained problem metadata on failure.
 *
 * Failure cases:
 * - Failed results throw ApiRequestError using the reported code or upstreamUnavailable;
 *   network failures propagate.
 *
 * Side effects:
 * - Performs the caller’s API request and shared session/trace effects; no success data is
 *   retained.
 */
export async function apiNoContent(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<void> {
  const response = await apiRequest(input, init);
  if (response.ok) return;
  const problem =
    response.result && !response.result.ok
      ? response.result.problem
      : undefined;
  throw new ApiRequestError(
    response.problemCode ?? SHARED_ERROR_CODES.upstreamUnavailable,
    problem,
  );
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
    problemCode === AUTH_ERROR_CODES.sessionInvalid ||
    problemCode === AUTH_ERROR_CODES.accountSuspended
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
