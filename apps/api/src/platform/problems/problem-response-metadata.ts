import type { ProblemResult } from "@lcsp/contracts/auth";

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
    typeof value !== "object" ||
    value === null ||
    typeof (value as { code?: unknown }).code !== "string" ||
    typeof (value as { correlationId?: unknown }).correlationId !== "string" ||
    typeof (value as { requiredAction?: unknown }).requiredAction !== "string"
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
    correlationId: body.problem.correlationId,
    requiredAction: body.problem.requiredAction,
  };
}

/**
 * Checks whether a runtime value is a standardized failed API result.
 *
 * @param body - Value to inspect.
 * @returns True when the value contains a failed result with a string problem code.
 */
function isProblemResult(body: unknown): body is ProblemResult<string> {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { ok?: unknown }).ok === false &&
    typeof (body as { problem?: { code?: unknown } }).problem?.code === "string"
  );
}
