import { HttpStatus } from "@nestjs/common";
import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  type AssessmentInterviewBlockedInput,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { asRecord } from "@lcsp/contracts/shared";

import { problemException } from "../../../../platform/http/filters/error.factory.js";

export type InterviewBlockedActionReceipt = {
  clientRequestId: string;
  payloadFingerprint: string;
  contextRevision: number;
  actorId: string;
  recordedAt: string;
};

type InterviewMutationThread = {
  exists: boolean;
  contextRevision: number;
  sourceVersion: string | null;
  pgeVersion: string | null;
  activeQuestionId: string | null;
  state: AssessmentInterviewRuntimeState;
};

/** A new answer/action must never relabel a question with a newer evidence version. */
export function assertInterviewMutationProvenance(
  thread: Pick<InterviewMutationThread, "sourceVersion" | "pgeVersion">,
  provenance: { sourceVersion: string; pgeVersion: string },
  correlationId: string,
): void {
  if (
    !thread.sourceVersion ||
    !thread.pgeVersion ||
    thread.sourceVersion !== provenance.sourceVersion ||
    thread.pgeVersion !== provenance.pgeVersion
  ) {
    throw problemException(
      ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES.provenanceStale,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
}

/** Validate the advertised action against locked, current server state, never only UI state. */
export function assertInterviewBlockedActionAvailable(
  thread: InterviewMutationThread,
  input: AssessmentInterviewBlockedInput,
  correlationId: string,
): void {
  if (input.expectedSessionRevision !== thread.contextRevision) {
    throw problemException(
      ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES.revisionStale,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    !thread.exists ||
    thread.state.outcome !==
      ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved ||
    thread.activeQuestionId !== null ||
    thread.state.activeQuestion ||
    thread.state.orchestrationRequested === true ||
    !thread.state.blockedActions?.includes(input.action)
  ) {
    throw problemException(
      ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES.blockedActionNotAvailable,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
}

export function parseInterviewBlockedAction(
  value: unknown,
  correlationId: string,
): AssessmentInterviewBlockedInput {
  const input = asRecord(value);
  if (
    !input ||
    !Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
      input.action as never,
    ) ||
    !Number.isSafeInteger(input.expectedSessionRevision) ||
    (input.expectedSessionRevision as number) < 0 ||
    typeof input.clientRequestId !== "string" ||
    !input.clientRequestId.trim() ||
    input.clientRequestId.length > 200 ||
    (input.draft !== undefined && typeof input.draft !== "string")
  ) {
    throw problemException(
      ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES.blockedActionInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
  return {
    action: input.action as AssessmentInterviewBlockedInput["action"],
    draft: input.draft,
    expectedSessionRevision: input.expectedSessionRevision as number,
    clientRequestId: input.clientRequestId.trim(),
  };
}

export function isInterviewBlockedActionReceipt(
  value: unknown,
): value is InterviewBlockedActionReceipt {
  const record = asRecord(value);
  return Boolean(
    record &&
    typeof record.clientRequestId === "string" &&
    record.clientRequestId.length > 0 &&
    typeof record.payloadFingerprint === "string" &&
    Number.isSafeInteger(record.contextRevision) &&
    (record.contextRevision as number) >= 0 &&
    typeof record.actorId === "string" &&
    typeof record.recordedAt === "string",
  );
}
