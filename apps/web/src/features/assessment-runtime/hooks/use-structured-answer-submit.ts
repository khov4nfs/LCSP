"use client";
import { useRef } from "react";
import type { AssessmentHumanRequestView } from "@lcsp/contracts/assessment-domain";
import { useAnswerHumanRequestMutation } from "@/lib/api/assessment-domain-queries";
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
  const mutation = useAnswerHumanRequestMutation(
    assessmentId,
    request?.requestId ?? "",
  );
  const replay = useRef<{ key: string; digest: string } | null>(null);
  const submit = async (answer: StructuredAnswer) => {
    if (!request || caseRevision === undefined) return;
    const packet = {
      expectedCaseRevision: caseRevision,
      expectedRequestRevision: request.requestRevision,
      ...(answer.doesNotKnow
        ? { doesNotKnow: true as const }
        : { doesNotKnow: false as const, answer: answer.answer }),
    };
    const digest = JSON.stringify(packet);
    if (replay.current?.digest !== digest)
      replay.current = { key: crypto.randomUUID(), digest };
    await mutation
      .mutateAsync({ ...packet, idempotencyKey: replay.current.key })
      .catch(() => undefined);
  };
  return { submit, pending: mutation.isPending, failed: mutation.isError };
}
