import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  LEGACY_MIGRATION_ERROR_CODES,
  legacyArchiveDetailSchema,
} from "@lcsp/contracts/legacy-migration";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";

import { problemJson, successJson } from "./problem-json";
import { requireSessionToken } from "./session-token";
import {
  upstreamBinaryRequest,
  upstreamJson,
  upstreamRequest,
} from "./upstream-request";

const assessmentIdSchema = z.string().min(1).max(128);
// Archive record ids are deterministic GUIDs, not RFC 4122 versioned UUIDs.
const recordIdSchema = z.guid();

const archivePath = (assessmentId: string) =>
  `/legacy-archive/assessments/${encodeURIComponent(assessmentId)}`;

const invalid = () =>
  problemJson(LEGACY_MIGRATION_ERROR_CODES.REQUEST_INVALID, { status: 422 });

/** Archived V1 assessment: summary plus the availability of each report. Read-only. */
export async function proxyLegacyArchiveDetail(
  request: NextRequest,
  assessmentId: string,
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (!assessmentIdSchema.safeParse(assessmentId).success) return invalid();
  const upstream = await upstreamRequest(archivePath(assessmentId), {
    bearerToken: session.token,
  });
  if (!upstream.ok) return upstreamJson(upstream);
  const parsed = legacyArchiveDetailSchema.safeParse(upstream.data);
  return parsed.success
    ? successJson(parsed.data, { status: upstream.status })
    : problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, { status: 502 });
}

/** Streams one preserved report. The API re-verifies the bytes; this layer never buffers a location. */
export async function proxyLegacyArchiveDownload(
  request: NextRequest,
  assessmentId: string,
  recordId: string,
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  if (
    !assessmentIdSchema.safeParse(assessmentId).success ||
    !recordIdSchema.safeParse(recordId).success
  )
    return invalid();
  const upstream = await upstreamBinaryRequest(
    `${archivePath(assessmentId)}/reports/${encodeURIComponent(recordId)}/download`,
    { bearerToken: session.token },
  );
  if (!upstream.ok) return upstreamJson(upstream);
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.contentType ?? "application/octet-stream",
      "content-disposition":
        upstream.contentDisposition ??
        `attachment; filename="legacy-report-${recordId}.bin"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
