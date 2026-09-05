import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  type AssessmentContextAuthorityStatus,
  type AssessmentInterviewAnswerInput,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewBlockedInput,
  type AssessmentInterviewFlag,
  type AssessmentInterviewQuestion,
  type AssessmentInterviewQuestionChoice,
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
  const audit = sanitizeAudit(record.audit);
  return {
    outcome: record.outcome,
    activeQuestion: question ?? undefined,
    blockedActions: Array.isArray(record.blockedActions)
      ? record.blockedActions.filter(isBlockedAction)
      : undefined,
    flags: Array.isArray(record.flags)
      ? record.flags.filter(isFlag)
      : undefined,
    contextAuthority: isContextAuthority(record.contextAuthority)
      ? record.contextAuthority
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
    audit: audit ?? undefined,
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
  const question: AssessmentInterviewQuestion = {
    id: record.id,
    intent: record.intent,
    control: record.control,
    prompt: record.prompt,
  };
  if (typeof record.needId === "string") {
    question.needId = record.needId;
  }
  if (Array.isArray(record.choices)) {
    question.choices = record.choices.map(sanitizeQuestionChoice).filter(isDefined);
  }
  if (typeof record.priorAnswerSummary === "string") {
    question.priorAnswerSummary = record.priorAnswerSummary;
  }
  if (Array.isArray(record.whyEvidenceRefs)) {
    question.whyEvidenceRefs = record.whyEvidenceRefs.filter((item): item is string => typeof item === "string");
  }
  return question;
}

function sanitizeQuestionChoice(
  value: unknown,
): AssessmentInterviewQuestionChoice | null {
  const record = objectRecord(value);
  if (!record || typeof record.id !== "string" || typeof record.label !== "string") {
    return null;
  }
  const choice: AssessmentInterviewQuestionChoice = {
    id: record.id,
    label: record.label,
  };
  if (typeof record.description === "string") {
    choice.description = record.description;
  }
  if (typeof record.requiresFreeText === "boolean") {
    choice.requiresFreeText = record.requiresFreeText;
  }
  return choice;
}

function sanitizeAudit(value: unknown): AssessmentInterviewAuditRef | null {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.authenticatedActorId !== "string" ||
    typeof record.timestamp !== "string" ||
    typeof record.assessmentId !== "string" ||
    typeof record.sourceVersion !== "string" ||
    typeof record.pgeVersion !== "string" ||
    typeof record.sessionId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.contextRevision !== "number"
  ) {
    return null;
  }
  const audit: AssessmentInterviewAuditRef = {
    authenticatedActorId: record.authenticatedActorId,
    timestamp: record.timestamp,
    assessmentId: record.assessmentId,
    sourceVersion: record.sourceVersion,
    pgeVersion: record.pgeVersion,
    sessionId: record.sessionId,
    turnId: record.turnId,
    contextRevision: record.contextRevision,
  };
  if (typeof record.priorRevision === "number") {
    audit.priorRevision = record.priorRevision;
  }
  if (typeof record.newRevision === "number") {
    audit.newRevision = record.newRevision;
  }
  if (typeof record.relatedQuestionId === "string") {
    audit.relatedQuestionId = record.relatedQuestionId;
  }
  if (Array.isArray(record.governedEvidenceRefs)) {
    audit.governedEvidenceRefs = record.governedEvidenceRefs.filter((item): item is string => typeof item === "string");
  }
  return audit;
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

function isBlockedAction(
  value: unknown,
): value is NonNullable<AssessmentInterviewRuntimeState["blockedActions"]>[number] {
  return Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
    value as NonNullable<AssessmentInterviewRuntimeState["blockedActions"]>[number],
  );
}

function isFlag(value: unknown): value is AssessmentInterviewFlag {
  return Object.values(ASSESSMENT_INTERVIEW_FLAGS).includes(
    value as AssessmentInterviewFlag,
  );
}

function isContextAuthority(value: unknown): value is AssessmentContextAuthorityStatus {
  return Object.values(ASSESSMENT_CONTEXT_AUTHORITY_STATUSES).includes(
    value as AssessmentContextAuthorityStatus,
  );
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

