"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AssessmentHumanRequestView } from "@lcsp/contracts/assessment-domain";
import { useAnswerAnyHumanRequestMutation } from "@/lib/api/assessment-domain-queries";
import { ApiRequestError } from "@/lib/api/api-request";
import type { StructuredAnswer } from "../types/structured-answer.types";

/**
 * Business purpose:
 * Submits the customer's answer to the OPEN human request with stable idempotency and stale revision recovery.
 *
 * Business rules:
 * - A double-click or retry replays the same idempotency key for identical answers.
 * - On 409 conflict, clears local replay cache and invalidates query data while keeping the user's draft intact.
 *
 * Execution flow:
 * 1. Validate target request and active case revision.
 * 2. Formulate payload with expected revisions and compute deterministic key digest.
 * 3. Send mutation to upstream API.
 * 4. Catch errors: if 409 stale revision, flag stale conflict, delete cached replay key, and invalidate assessment queries.
 *
 * Failure cases:
 * - Network or server errors flag failure without discarding the answer.
 * - Revision conflicts trigger automatic background refetch and user conflict banner.
 *
 * Side effects:
 * - Mutates assessment human request state and invalidates assessment query cache on success or conflict.
 */
export function useStructuredAnswerSubmit(
  assessmentId: string,
  request: AssessmentHumanRequestView | undefined,
  caseRevision: number | undefined,
) {
  const queryClient = useQueryClient();
  const mutation = useAnswerAnyHumanRequestMutation(assessmentId);
  const [submittingRequestId, setSubmittingRequestId] = useState<string | null>(null);
  const [failedRequestId, setFailedRequestId] = useState<string | null>(null);
  const [staleConflictRequestId, setStaleConflictRequestId] = useState<string | null>(null);
  const replay = useRef<Map<string, { key: string; digest: string }>>(new Map());

  /**
   * Business purpose:
   * Execute an answer submission with replay idempotency and revision-conflict handling.
   *
   * Business rules:
   * - Must not submit if target request or caseRevision is missing.
   * - Retains and replays the same idempotency key for repeated submits of identical answers.
   * - Distinguishes 409 stale revision from other failures to trigger invalidation and alert.
   *
   * Execution flow:
   * 1. Resolve target request and active case revision.
   * 2. Build answer packet with expected revisions.
   * 3. Compute or reuse stable idempotency key.
   * 4. Call mutation endpoint asynchronously.
   * 5. On 409, clear replay key, set conflict state and invalidate query; otherwise set failed state.
   *
   * Failure cases:
   * - Missing target or revision returns immediately.
   * - Upstream errors are categorized into stale conflict (409) vs generic failure.
   *
   * Side effects:
   * - Triggers server answer mutation, clears local replay on conflict, and invalidates query cache.
   */
  const submit = async (
    answer: StructuredAnswer,
    explicitRequest?: AssessmentHumanRequestView,
  ) => {
    const target = explicitRequest ?? request;
    if (!target || caseRevision === undefined) return;
    setSubmittingRequestId(target.requestId);
    setFailedRequestId(null);
    setStaleConflictRequestId(null);

    const packet = {
      expectedCaseRevision: caseRevision,
      expectedRequestRevision: target.requestRevision,
      ...(answer.doesNotKnow
        ? { doesNotKnow: true as const }
        : { doesNotKnow: false as const, answer: answer.answer }),
    };
    const digest = JSON.stringify(packet);
    let keyInfo = replay.current.get(target.requestId);
    if (!keyInfo || keyInfo.digest !== digest) {
      keyInfo = { key: crypto.randomUUID(), digest };
      replay.current.set(target.requestId, keyInfo);
    }
    try {
      await mutation.mutateAsync({
        requestId: target.requestId,
        answer: { ...packet, idempotencyKey: keyInfo.key },
      });
    } catch (error) {
      const is409 =
        (error instanceof ApiRequestError && error.problem?.status === 409) ||
        (error as { status?: number })?.status === 409 ||
        (error instanceof ApiRequestError &&
          (error.problemCode === "ASSESSMENT_CASE_REVISION_MISMATCH" ||
            error.problemCode === "HUMAN_REQUEST_REVISION_MISMATCH"));
      if (is409) {
        setStaleConflictRequestId(target.requestId);
        replay.current.delete(target.requestId);
        void queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] });
      } else {
        setFailedRequestId(target.requestId);
      }
    } finally {
      setSubmittingRequestId(null);
    }
  };

  return {
    submit,
    pending: mutation.isPending,
    failed: mutation.isError,
    staleConflict: staleConflictRequestId !== null,
    staleConflictRequestId,
    submittingRequestId,
    failedRequestId,
  };
}
