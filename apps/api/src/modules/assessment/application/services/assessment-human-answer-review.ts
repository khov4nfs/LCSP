import { HUMAN_RESOLUTION_REQUEST_STATUSES } from "@lcsp/contracts/assessment";
import { humanAnswerAuditSchema } from "@lcsp/contracts/assessment-domain";
import { z } from "zod";

const humanAnswerReviewAuthorizationSchema = z.object({
  checkpointId: z.string().min(1),
  requests: z
    .array(
      z.object({
        requestId: z.string().min(1),
        requestRevision: z.number().int().positive(),
      }),
    )
    .min(1),
});

export type HumanAnswerReviewAuthorization = z.infer<
  typeof humanAnswerReviewAuthorizationSchema
>;

export type ReviewableHumanRequest = {
  assessmentId: string;
  threadId: string;
  requestId: string;
  requestRevision: number;
  checkpointId: string | null;
  status: string;
  resolvedFactId: string | null;
  answers: unknown;
};

/**
 * Business purpose: Authorize one Root review of unknown human responses at their exact durable wait checkpoint.
 *
 * Business rules:
 * - Every currently open dependency must have a valid latest UNKNOWN audit response bound to this assessment, thread and checkpoint.
 * - Unknown responses remain unresolved and never grant accepted fact or compliance authority.
 * - Legacy unbound answers, partial responses, changed revisions and responses from an earlier wait cannot authorize review.
 *
 * Execution flow:
 * 1. Reject an empty checkpoint or incomplete set of open request identities.
 * 2. Validate each latest audit response and its current request revision and checkpoint.
 * 3. Return the exact server-owned request revisions that may be reviewed once.
 *
 * Failure cases:
 * - Missing, malformed, cross-scope, contradictory or stale history returns null without widening authority.
 *
 * Side effects:
 * - Pure validation and projection; changes no request, lifecycle, evidence or case revision.
 */
export function buildHumanAnswerReviewAuthorization(
  requests: readonly ReviewableHumanRequest[],
  binding: {
    assessmentId: string;
    threadId: string;
    checkpointId: string | null;
  },
): HumanAnswerReviewAuthorization | null {
  if (
    !binding.checkpointId ||
    requests.length === 0 ||
    new Set(requests.map((request) => request.requestId)).size !==
      requests.length
  ) {
    return null;
  }
  for (const request of requests) {
    if (
      request.assessmentId !== binding.assessmentId ||
      request.threadId !== binding.threadId ||
      request.checkpointId !== binding.checkpointId ||
      request.status !== HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN ||
      request.resolvedFactId !== null ||
      !Array.isArray(request.answers)
    )
      return null;
    const latest = humanAnswerAuditSchema.safeParse(request.answers.at(-1));
    if (
      !latest.success ||
      !latest.data.doesNotKnow ||
      latest.data.answer !== null ||
      latest.data.requestRevision !== request.requestRevision ||
      request.requestRevision < 1 ||
      latest.data.checkpointId !== binding.checkpointId
    )
      return null;
  }
  return {
    checkpointId: binding.checkpointId,
    requests: requests.map(({ requestId, requestRevision }) => ({
      requestId,
      requestRevision,
    })),
  };
}

/**
 * Business purpose: Preserve open dependencies when an authorized human-answer review establishes a new native wait checkpoint.
 *
 * Business rules:
 * - Only the server-persisted review authorization can release an old checkpoint binding.
 * - The request must still be the exact unknown-response revision authorized at claim time.
 * - Ordinary checkpoint settlement and unrelated requests retain the existing strict binding checks.
 *
 * Execution flow:
 * 1. Validate the stored authorization shape and find the current request revision.
 * 2. Revalidate its unknown audit response against the authorized previous checkpoint.
 *
 * Failure cases:
 * - Missing authorization, changed request history or a mismatched checkpoint returns false.
 *
 * Side effects:
 * - Pure guard; the runtime transaction performs any actual checkpoint update.
 */
export function humanReviewAllowsCheckpointRebind(
  request: ReviewableHumanRequest,
  authorization: unknown,
): boolean {
  const parsed = humanAnswerReviewAuthorizationSchema.safeParse(authorization);
  if (
    !parsed.success ||
    !parsed.data.requests.some(
      (entry) =>
        entry.requestId === request.requestId &&
        entry.requestRevision === request.requestRevision,
    )
  )
    return false;
  return (
    buildHumanAnswerReviewAuthorization([request], {
      assessmentId: request.assessmentId,
      threadId: request.threadId,
      checkpointId: parsed.data.checkpointId,
    }) !== null
  );
}
