import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  type AssessmentInterviewAnswerInput,
  type AssessmentInterviewBlockedInput,
  type AssessmentInterviewQuestion,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";

import { apiJson } from "./api-request";

export async function getAssessmentInterviewState(assessmentId: string) {
  return apiJson<AssessmentInterviewRuntimeState>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/interview`,
  );
}

export async function submitAssessmentInterviewAnswer(
  assessmentId: string,
  input: AssessmentInterviewAnswerInput,
) {
  return apiJson<AssessmentInterviewRuntimeState>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/interview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export async function recordAssessmentInterviewBlockedAction(
  assessmentId: string,
  input: AssessmentInterviewBlockedInput,
) {
  return apiJson<AssessmentInterviewRuntimeState>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/interview/blocked-actions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function sanitizeAssessmentInterviewState(
  value: unknown,
): AssessmentInterviewRuntimeState | null {
  const record = objectRecord(value);
  if (!record || !isOutcome(record.outcome)) {
    return null;
  }
  const question = sanitizeQuestion(record.activeQuestion);
  return {
    outcome: record.outcome,
    activeQuestion: question ?? undefined,
    blockedActions: Array.isArray(record.blockedActions)
      ? record.blockedActions.filter(isBlockedAction)
      : undefined,
    flags: Array.isArray(record.flags)
      ? record.flags.filter((item): item is never => typeof item === "string")
      : undefined,
    threadId: typeof record.threadId === "string" ? record.threadId : undefined,
    contextRevision:
      typeof record.contextRevision === "number" ? record.contextRevision : undefined,
    orchestrationRequested:
      typeof record.orchestrationRequested === "boolean"
        ? record.orchestrationRequested
        : undefined,
    pendingDraft:
      typeof record.pendingDraft === "string" ? record.pendingDraft : undefined,
    answerHistory: Array.isArray(record.answerHistory)
      ? record.answerHistory.filter(isAnswerHistoryItem)
      : undefined,
    audit: objectRecord(record.audit)
      ? (record.audit as AssessmentInterviewRuntimeState["audit"])
      : undefined,
  };
}

function sanitizeQuestion(value: unknown): AssessmentInterviewQuestion | null {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    !isQuestionIntent(record.intent) ||
    !isQuestionControl(record.control) ||
    typeof record.prompt !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    intent: record.intent,
    control: record.control,
    prompt: record.prompt,
    choices: Array.isArray(record.choices)
      ? record.choices.filter(isQuestionChoice)
      : undefined,
    priorAnswerSummary:
      typeof record.priorAnswerSummary === "string"
        ? record.priorAnswerSummary
        : undefined,
    whyEvidenceRefs: Array.isArray(record.whyEvidenceRefs)
      ? record.whyEvidenceRefs.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function isAnswerHistoryItem(
  value: unknown,
): value is NonNullable<AssessmentInterviewRuntimeState["answerHistory"]>[number] {
  const record = objectRecord(value);
  return (
    !!record &&
    typeof record.questionId === "string" &&
    typeof record.answeredAt === "string" &&
    typeof record.actorId === "string" &&
    typeof record.summary === "string"
  );
}

function isQuestionChoice(
  value: unknown,
): value is NonNullable<AssessmentInterviewQuestion["choices"]>[number] {
  const record = objectRecord(value);
  return !!record && typeof record.id === "string" && typeof record.label === "string";
}

function isOutcome(value: unknown): value is AssessmentInterviewRuntimeState["outcome"] {
  return Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(
    value as AssessmentInterviewRuntimeState["outcome"],
  );
}

function isQuestionIntent(
  value: unknown,
): value is AssessmentInterviewQuestion["intent"] {
  return Object.values(ASSESSMENT_INTERVIEW_QUESTION_INTENTS).includes(
    value as AssessmentInterviewQuestion["intent"],
  );
}

function isQuestionControl(
  value: unknown,
): value is AssessmentInterviewQuestion["control"] {
  return Object.values(ASSESSMENT_INTERVIEW_CONTROLS).includes(
    value as AssessmentInterviewQuestion["control"],
  );
}

function isBlockedAction(value: unknown): value is NonNullable<AssessmentInterviewRuntimeState["blockedActions"]>[number] {
  return Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
    value as NonNullable<AssessmentInterviewRuntimeState["blockedActions"]>[number],
  );
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
