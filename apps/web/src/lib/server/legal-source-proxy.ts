import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES,
  LEGAL_SOURCE_LIMITS,
  legalSourceDocumentViewSchema,
  uploadLegalSourceDocumentMetadataSchema,
} from "@lcsp/contracts/legal-source";

import { problemJson, resultJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamBinaryRequest,
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

type ProxyJsonOptions<TData> = {
  method?: RequestInit["method"];
  bodySchema?: z.ZodType;
  querySchema?: z.ZodType;
  responseSchema: z.ZodType<TData>;
};

export function parseLegalSourceRouteId(id: string): string | undefined {
  const parsed = z.uuid().safeParse(id);
  return parsed.success ? parsed.data : undefined;
}

export function invalidLegalSourceRouteId(): NextResponse {
  return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid, {
    status: 422,
  });
}

export async function proxyLegalSourceJson<TData>(
  request: NextRequest,
  path: string,
  options: ProxyJsonOptions<TData>,
): Promise<NextResponse> {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const query = options.querySchema
    ? options.querySchema.safeParse(
        Object.fromEntries(request.nextUrl.searchParams.entries()),
      )
    : null;
  if (query && !query.success) {
    return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid, {
      status: 422,
    });
  }

  let body: string | undefined;
  if (options.bodySchema) {
    const inbound = await request.json().catch(() => null);
    const parsed = options.bodySchema.safeParse(inbound);
    if (!parsed.success) {
      return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid, {
        status: 422,
      });
    }
    body = JSON.stringify(parsed.data);
  }

  const target = query?.success
    ? `${path}?${new URLSearchParams(
        Object.entries(query.data as Record<string, string | number>).map(
          ([key, value]) => [key, String(value)],
        ),
      )}`
    : path;
  const upstream = await upstreamRequest(target, {
    method: options.method ?? request.method,
    bearerToken: session.token,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body,
        }),
  });

  return validatedUpstreamJson(upstream, (data) => {
    const parsed = options.responseSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  });
}

export async function proxyLegalSourceDelete(
  request: NextRequest,
  path: string,
): Promise<NextResponse> {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const upstream = await upstreamRequest(path, {
    method: "DELETE",
    bearerToken: session.token,
  });
  return upstream.status === 204
    ? new NextResponse(null, { status: 204 })
    : resultJson(upstream.result, { status: upstream.status });
}

export async function proxyLegalSourceOriginal(
  request: NextRequest,
  path: string,
  inline = false,
): Promise<NextResponse> {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const upstream = await upstreamBinaryRequest(path, {
    bearerToken: session.token,
  });
  if (!upstream.ok) {
    return resultJson(upstream.result, { status: upstream.status });
  }

  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  if (upstream.contentType) headers.set("content-type", upstream.contentType);
  if (upstream.contentDisposition && !inline) {
    headers.set("content-disposition", upstream.contentDisposition);
  } else if (inline) {
    headers.set("content-disposition", "inline");
  }
  if (upstream.etag) headers.set("etag", upstream.etag);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function proxyLegalSourceUpload(
  request: NextRequest,
  path: string,
): Promise<NextResponse> {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(typeof File !== "undefined" && file instanceof File)) {
    return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid, {
      status: 422,
    });
  }
  if (file.size > LEGAL_SOURCE_LIMITS.maxDocumentBytes) {
    return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentTooLarge, {
      status: 413,
    });
  }
  if (file.size === 0) {
    return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.documentEmpty, {
      status: 422,
    });
  }

  const metadataInput: Record<string, unknown> = { fileName: file.name };
  for (const key of [
    "title",
    "structureProfile",
    "sourceEffectStatus",
    "effectiveDate",
    "provisionStatuses",
  ]) {
    const value = form?.get(key);
    if (typeof value === "string" && value !== "") metadataInput[key] = value;
  }
  const metadata =
    uploadLegalSourceDocumentMetadataSchema.safeParse(metadataInput);
  if (!metadata.success) {
    return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid, {
      status: 422,
    });
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata.data)) {
    if (typeof value === "string") query.set(key, value);
    else if (key === "provisionStatuses" && value) {
      query.set(key, JSON.stringify(value));
    }
  }
  const upstream = await upstreamRequest(`${path}?${query}`, {
    method: "POST",
    bearerToken: session.token,
    headers: { "content-type": file.type },
    body: file,
  });
  return validatedUpstreamJson(upstream, (data) => {
    const parsed = legalSourceDocumentViewSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  });
}
