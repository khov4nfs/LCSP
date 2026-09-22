import { isRecord } from "../../../common/utils/index.js";
import { isProblemResult } from "./error.factory.js";

export type ProblemResponseMetadata = {
  code: string;
  correlationId: string;
  requiredAction: string;
};

type HttpResponseWithLocals = {
  locals?: Record<string, unknown>;
};

const PROBLEM_RESPONSE_METADATA_KEY = "problemResponse";

/**
 * Stores normalized problem metadata on the HTTP response so later middleware can enrich logs without re-parsing the body.
 *
 * @param response - HTTP response whose local state receives the problem metadata.
 * @param body - Candidate response body to inspect for a standardized problem result.
 */
export function setProblemResponseMetadata(
  response: HttpResponseWithLocals,
  body: unknown,
): void {
  const metadata = getProblemResponseMetadata(body);
  if (!metadata) {
    return;
  }

  response.locals ??= {};
  response.locals[PROBLEM_RESPONSE_METADATA_KEY] = metadata;
}

/**
 * Reads validated problem metadata previously attached to an HTTP response.
 *
 * @param response - HTTP response whose local metadata should be inspected.
 * @returns Problem metadata when present and structurally valid; otherwise null.
 */
export function readProblemResponseMetadata(
  response: HttpResponseWithLocals,
): ProblemResponseMetadata | null {
  const value = response.locals?.[PROBLEM_RESPONSE_METADATA_KEY];
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.correlationId !== "string" ||
    typeof value.requiredAction !== "string"
  ) {
    return null;
  }

  return value as ProblemResponseMetadata;
}

/**
 * Extracts the subset of a problem result needed by HTTP logging.
 *
 * @param body - Candidate API result to inspect.
 * @returns Problem code, required action, and correlation ID, or null for non-problem bodies.
 */
function getProblemResponseMetadata(
  body: unknown,
): ProblemResponseMetadata | null {
  if (!isProblemResult(body)) {
    return null;
  }

  return {
    code: body.problem.code,
    correlationId: String(body.problem.correlationId ?? ""),
    requiredAction: String(body.problem.requiredAction ?? ""),
  };
}
