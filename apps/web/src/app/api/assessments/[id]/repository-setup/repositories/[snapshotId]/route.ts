import type { NextRequest } from "next/server";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  removeAssessmentRepositoryResultSchema,
} from "@lcsp/contracts/assessment-domain";
import { problemJson } from "@/lib/server/problem-json";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/** Identifier shape of a snapshot id; anything else never reaches the upstream path. */
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/u;

/**
 * Business purpose: Remove a repository candidate for the signed-in customer while repository setup is still open.
 * Business rules:
 * - The snapshot id must look like an identifier before it is placed in the upstream path.
 * - Session, assessment id and the upstream answer are validated by the shared assessment proxy.
 * - Whether removal is still allowed (setup open, set not pinned) is decided by the API, not here.
 * Execution flow:
 * 1. Reject a malformed snapshot id.
 * 2. Forward the delete upstream and validate the answer shape.
 * Failure cases:
 * - A malformed id, missing session, upstream conflict or malformed answer is returned as a problem response.
 * Side effects:
 * - One authenticated upstream request that deletes the candidate and may revoke its connection.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; snapshotId: string }> },
) {
  const { id, snapshotId } = await params;
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  }
  return proxyAssessmentJson(
    request,
    id,
    `/repository-setup/repositories/${encodeURIComponent(snapshotId)}`,
    {
      method: "DELETE",
      responseSchema: removeAssessmentRepositoryResultSchema,
    },
  );
}
