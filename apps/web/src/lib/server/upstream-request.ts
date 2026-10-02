import type { AppResult } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";

import { getProblemCode } from "@/lib/api/problem-envelope";
import { problemEnvelope } from "@/lib/api/problem-envelope";
import {
  problemJson,
  readResultData,
  resultJson,
  successJson,
} from "@/lib/server/problem-json";

const upstreamBaseUrl =
  process.env.LCSP_API_BASE_URL ?? "http://localhost:3001";

type WebAppResult = AppResult<unknown, string>;

export type UpstreamRequestInit = RequestInit & {
  bearerToken?: string;
};

export type UpstreamRequestResult = {
  result: WebAppResult | null;
  data: unknown;
  ok: boolean;
  status: number;
  problemCode?: string;
};

type UpstreamBinaryResult = {
  body: ArrayBuffer | null;
  result: WebAppResult | null;
  ok: boolean;
  status: number;
  contentType?: string;
  contentDisposition?: string;
};

export function upstreamUrl(path: string): URL {
  return new URL(path, upstreamBaseUrl);
}

export async function upstreamRequest(
  path: string | URL,
  init: UpstreamRequestInit = {},
): Promise<UpstreamRequestResult> {
  const { bearerToken, headers, ...fetchInit } = init;
  const requestHeaders = new Headers(headers);
  if (bearerToken) {
    requestHeaders.set("authorization", `Bearer ${bearerToken}`);
  }

  const response = await fetch(
    typeof path === "string" ? upstreamUrl(path) : path,
    {
      cache: "no-store",
      ...fetchInit,
      headers: requestHeaders,
    },
  ).catch(() => null);

  if (response === null) {
    const result = problemEnvelope(SHARED_ERROR_CODES.upstreamUnavailable, 503);
    return {
      result,
      data: readResultData(result),
      ok: false,
      status: 503,
      problemCode: SHARED_ERROR_CODES.upstreamUnavailable,
    };
  }

  const result = toAppResult(await response.json().catch(() => null));

  return {
    result,
    data: readResultData(result),
    ok: response.ok && result?.ok === true,
    status: response.status,
    problemCode: getProblemCode(result),
  };
}

async function upstreamBinaryRequest(
  path: string | URL,
  init: UpstreamRequestInit = {},
): Promise<UpstreamBinaryResult> {
  const { bearerToken, headers, ...fetchInit } = init;
  const requestHeaders = new Headers(headers);
  if (bearerToken) {
    requestHeaders.set("authorization", `Bearer ${bearerToken}`);
  }

  const response = await fetch(
    typeof path === "string" ? upstreamUrl(path) : path,
    { cache: "no-store", ...fetchInit, headers: requestHeaders },
  ).catch(() => null);

  if (response === null) {
    return {
      body: null,
      result: problemEnvelope(SHARED_ERROR_CODES.upstreamUnavailable, 503),
      ok: false,
      status: 503,
    };
  }

  if (!response.ok) {
    return {
      body: null,
      result: toAppResult(await response.json().catch(() => null)),
      ok: false,
      status: response.status,
    };
  }

  return {
    body: await response.arrayBuffer(),
    result: null,
    ok: true,
    status: response.status,
    contentType: response.headers.get("content-type") ?? undefined,
    contentDisposition:
      response.headers.get("content-disposition") ?? undefined,
  };
}

export function upstreamJson(
  upstream: Pick<UpstreamRequestResult, "result" | "status">,
) {
  return resultJson(upstream.result, { status: upstream.status });
}

export function validatedUpstreamJson<TData>(
  upstream: UpstreamRequestResult,
  sanitize: (data: unknown) => TData | null,
) {
  if (!upstream.ok) {
    return upstreamJson(upstream);
  }

  const sanitized = sanitize(upstream.data);
  return sanitized === null
    ? problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, { status: 502 })
    : successJson(sanitized, { status: upstream.status });
}

function toAppResult(payload: unknown): WebAppResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const result = payload as Partial<AppResult>;
  return result.ok === true || result.ok === false
    ? (payload as WebAppResult)
    : null;
}
