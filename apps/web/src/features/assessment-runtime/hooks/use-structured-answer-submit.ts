"use client";
import { useRef, useState } from "react";
import type { AssessmentHumanRequestView } from "@lcsp/contracts/assessment-domain";
import { useAnswerAnyHumanRequestMutation } from "@/lib/api/assessment-domain-queries";
import type { StructuredAnswer } from "../types/structured-answer.types";

/**
 * Submits the customer's answer to the OPEN request. The idempotency key is stable per distinct
 * answer, so a double click or a retry replays the same write instead of recording two.
 */
export function useStructuredAnswerSubmit(
  assessmentId: string,
  request: AssessmentHumanRequestView | undefined,
  caseRevision: number | undefined,
) {
  const mutation = useAnswerAnyHumanRequestMutation(assessmentId);
  const [submittingRequestId, setSubmittingRequestId] = useState<string | null>(null);
  const [failedRequestId, setFailedRequestId] = useState<string | null>(null);
  const replay = useRef<Map<string, { key: string; digest: string }>>(new Map());

  const submit = async (
    answer: StructuredAnswer,
    explicitRequest?: AssessmentHumanRequestView,
  ) => {
    const target = explicitRequest ?? request;
    if (!target || caseRevision === undefined) return;
    setSubmittingRequestId(target.requestId);
    setFailedRequestId(null);

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
    } catch {
      setFailedRequestId(target.requestId);
    } finally {
      setSubmittingRequestId(null);
    }
  };

  return {
    submit,
    pending: mutation.isPending,
    failed: mutation.isError,
    submittingRequestId,
    failedRequestId,
  };
}
