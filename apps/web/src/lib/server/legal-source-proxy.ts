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

/**
 * Business purpose: Validate a Legal Source route identity before it becomes part of an
 *   upstream resource path.
 *
 * Business rules:
 * - Accept a UUID through the shared Zod validator without coercing arbitrary resource names.
 *
 * Execution flow:
 * 1. Return the validated identity or undefined when UUID validation fails.
 *
 * Failure cases:
 * - Malformed identifiers return undefined so the route can reject them before forwarding.
 *
 * Side effects:
 * - None: pure route-identity validation.
 */
export function parseLegalSourceRouteId(id: string): string | undefined {
  const parsed = z.uuid().safeParse(id);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Business purpose: Return the canonical invalid-resource request problem for Legal Source
 *   BFF routes.
 *
 * Business rules:
 * - Use the shared requestInvalid code with HTTP 422 rather than an endpoint-specific error
 *   body.
 *
 * Execution flow:
 * 1. Build the shared problem JSON response.
 *
 * Failure cases:
 * - The response represents rejected route input; it performs no upstream work.
 *
 * Side effects:
 * - Creates an HTTP problem response only.
 */
export function invalidLegalSourceRouteId(): NextResponse {
  return problemJson(LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid, {
    status: 422,
  });
}

/**
 * Business purpose: Forward authenticated Legal Source JSON operations with one shared
 *   validation and envelope boundary.
 *
 * Business rules:
 * - Require the session before upstream work; the backend owns authorization and lifecycle
 *   decisions.
 * - Validate optional query/body schemas, forward normalized data and the selected or inbound
 *   method, and validate success using the caller’s response schema.
 *
 * Execution flow:
 * 1. Check the session and validate configured query/body inputs.
 * 2. Build the scoped upstream URL and authenticated request, including JSON only when a body
 *   schema is configured.
 * 3. Forward the upstream result through shared success-payload validation.
 *
 * Failure cases:
 * - Invalid query/body data returns requestInvalid with HTTP 422; session, transport and
 *   response validation failures follow the shared upstream problem contract.
 *
 * Side effects:
 * - Makes one upstream request, which may mutate backend state according to its method; no
 *   local domain persistence.
 */
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

/**
 * Business purpose: Forward a guarded Legal Source deletion while preserving an empty
 *   successful response.
 *
 * Business rules:
 * - Require session authority; deletion eligibility remains a backend rule.
 * - A 204 response stays bodyless; other statuses use the canonical result envelope.
 *
 * Execution flow:
 * 1. Require the session and send the upstream DELETE.
 * 2. Return an empty 204 or forward the upstream result and status.
 *
 * Failure cases:
 * - Session failures stop forwarding; backend/transport problems retain the shared response
 *   policy.
 *
 * Side effects:
 * - One upstream deletion request; no direct local source or storage mutation.
 */
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

/**
 * Business purpose: Deliver authorized original legal-document bytes with private download or
 *   inline-preview metadata.
 *
 * Business rules:
 * - Require a session and preserve the backend’s binary success body without a JSON success
 *   wrapper.
 * - Disable shared caching, apply nosniff, and preserve content type/ETag; inline preview
 *   overrides disposition only when explicitly requested.
 *
 * Execution flow:
 * 1. Request the original binary body with session authority.
 * 2. Forward a canonical problem on failure or construct the private binary response and
 *   allowed headers.
 *
 * Failure cases:
 * - Session/API/transport failures return their existing problem result; binary-body read
 *   failures propagate from the shared upstream helper.
 *
 * Side effects:
 * - Reads original bytes over the upstream connection; no source mutation.
 */
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

/**
 * Business purpose: Translate a validated legal-document multipart upload into the API’s
 *   binary ingestion request.
 *
 * Business rules:
 * - Require a session, a real nonempty File and the configured maximum document size.
 * - Only approved metadata fields enter uploadLegalSourceDocumentMetadataSchema; forward
 *   parsed metadata as query parameters and original file bytes as the POST body.
 *
 * Execution flow:
 * 1. Validate file presence, byte size and metadata from the multipart form.
 * 2. Serialize normalized metadata, including structured provision statuses.
 * 3. Upload the original bytes and validate the returned legal-document view.
 *
 * Failure cases:
 * - Missing/empty files or invalid metadata return HTTP 422; oversized files return
 *   documentTooLarge with HTTP 413; shared session/upstream failures are preserved.
 *
 * Side effects:
 * - Sends original file bytes and validated metadata to the backend ingestion endpoint; no
 *   local document records are created.
 */
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
