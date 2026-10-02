import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  AI_DISCOVERY_SNIPPET_POLICIES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  FINAL_ASSESSMENT_RESULT_STATUSES,
  isPostFindingRuntimePhase,
  isRemediationDecision,
  REMEDIATION_APPROVAL_STATUSES,
  VERIFICATION_RESULT_STATUSES,
  type AssessmentPostFindingActivity,
  type AssessmentPostFindingDecisionInput,
  type AssessmentPostFindingRuntimeState,
  type AssessmentContextAuthorityStatus,
  type AssessmentInterviewAnswerInput,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewBlockedInput,
  type AssessmentPipelineContinueAction,
  type AssessmentPipelineContinueResult,
  type AssessmentInterviewFlag,
  type AssessmentInterviewQuestion,
  type AssessmentInterviewQuestionChoice,
  type AssessmentInterviewRuntimeState,
  type AssessmentInterviewSourceSnippet,
  type AiDiscoverySnippetRef,
  type CustomerAnswer,
  type NonEmptyArray,
  type SubmitInterviewAnswerCommand,
  INTERVIEW_TECHNICAL_CONTRACT_VERSION,
  ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES,
  ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES,
} from "@lcsp/contracts/evidence";


import { apiJson, apiRequest } from "./api-request";
import { API_OUTCOME_KINDS } from "./outcome-kinds";

export async function getAssessmentInterviewState(assessmentId: string) {
  return apiJson<AssessmentInterviewRuntimeState>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/interview`,
  );
}

export async function getAssessmentInterviewSourceSnippet(
  assessmentId: string,
  questionId: string,
) {
  return apiJson<AssessmentInterviewSourceSnippet>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/interview/questions/${encodeURIComponent(questionId)}/source-snippet`,
  );
}

export async function submitAssessmentInterviewAnswer(
  assessmentId: string,
  input: SubmitInterviewAnswerCommand,
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

export function buildSubmitInterviewAnswerCommand(
  assessmentId: string,
  state: AssessmentInterviewRuntimeState,
  input: AssessmentInterviewAnswerInput,
  clientRequestId = createClientRequestId(),
): SubmitInterviewAnswerCommand {
  const activeQuestion = state.activeQuestion;
  if (
    !activeQuestion ||
    !state.threadId ||
    typeof state.contextRevision !== "number" ||
    activeQuestion.id !== input.questionId
  ) {
    throw new Error("INTERVIEW_SUBMIT_STATE_INVALID");
  }
  return {
    contractVersion: INTERVIEW_TECHNICAL_CONTRACT_VERSION,
    assessmentId,
    sessionId: state.threadId,
    questionRef: activeQuestion.id,
    expectedSessionRevision: state.contextRevision,
    clientRequestId,
    answer: toCustomerAnswer(activeQuestion, input),
  };
}

function createClientRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `interview-submit-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function toCustomerAnswer(
  question: AssessmentInterviewQuestion,
  input: AssessmentInterviewAnswerInput,
): CustomerAnswer {
  const comment = input.otherText?.trim() || input.comment?.trim() || undefined;
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    return {
      kind: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
      text: input.freeText?.trim() ?? "",
    };
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect) {
    return {
      kind: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
      value: input.selectedChoiceIds?.[0] ?? "",
      comment,
    };
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect) {
    const values = input.selectedChoiceIds?.filter(Boolean) ?? [];
    if (values.length === 0) {
      throw new Error("INTERVIEW_MULTI_SELECT_ANSWER_REQUIRED");
    }
    return {
      kind: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
      values: values as NonEmptyArray<string>,
      comment,
    };
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean) {
    return {
      kind: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
      value: input.selectedChoiceIds?.[0] === "yes",
      comment,
    };
  }
  if (input.adjusted) {
    return {
      kind: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
      action: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust,
      adjustmentText: input.freeText?.trim() ?? "",
    };
  }
  return {
    kind: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
    action: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm,
    comment,
  };
}

/** Cooperatively interrupt whatever Interview turn is currently running. */
export async function pauseAssessmentInterviewTurn(assessmentId: string) {
  return apiJson<{ paused: boolean }>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/interview/pause`,
    { method: "POST" },
  );
}

/** Continue an Interview turn previously stopped with pauseAssessmentInterviewTurn. */
export async function resumeAssessmentInterviewTurn(assessmentId: string) {
  return apiJson<AssessmentInterviewRuntimeState>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/interview/resume`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
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

export type AssessmentPipelineContinueOutcome =
  | {
      kind: typeof API_OUTCOME_KINDS.requested;
      action: AssessmentPipelineContinueAction;
    }
  | { kind: typeof API_OUTCOME_KINDS.alreadyRunning }
  | { kind: typeof API_OUTCOME_KINDS.waitingForCustomer }
  | { kind: typeof API_OUTCOME_KINDS.completed }
  | { kind: typeof API_OUTCOME_KINDS.rateLimited }
  | { kind: typeof API_OUTCOME_KINDS.error };

const PIPELINE_CONTINUE_PROBLEM_OUTCOMES: Record<
  string,
  Exclude<
    AssessmentPipelineContinueOutcome,
    { kind: typeof API_OUTCOME_KINDS.requested }
  >
> = {
  [ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.alreadyRunning]: {
    kind: API_OUTCOME_KINDS.alreadyRunning,
  },
  [ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.waitingForCustomer]: {
    kind: API_OUTCOME_KINDS.waitingForCustomer,
  },
  [ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.completed]: {
    kind: API_OUTCOME_KINDS.completed,
  },
  [ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES.limitReached]: {
    kind: API_OUTCOME_KINDS.rateLimited,
  },
};

/** Continue a paused or stopped assessment pipeline from wherever it stopped. */
export async function continueAssessmentPipeline(
  assessmentId: string,
): Promise<AssessmentPipelineContinueOutcome> {
  const { ok, payload, problemCode } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/pipeline/continue`,
    { method: "POST" },
  );
  if (ok) {
    return {
      kind: API_OUTCOME_KINDS.requested,
      action: (payload as AssessmentPipelineContinueResult).action,
    };
  }
  const mapped = problemCode
    ? PIPELINE_CONTINUE_PROBLEM_OUTCOMES[problemCode]
    : undefined;
  return mapped ?? { kind: API_OUTCOME_KINDS.error };
}

export async function submitAssessmentPostFindingDecision(
  assessmentId: string,
  input: AssessmentPostFindingDecisionInput,
) {
  return apiJson<AssessmentPostFindingRuntimeState>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/post-finding/decisions`,
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
    assistantMessage:
      typeof record.assistantMessage === "string" &&
      record.assistantMessage.trim()
        ? record.assistantMessage.trim()
        : undefined,
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
      typeof record.contextRevision === "number"
        ? record.contextRevision
        : undefined,
    orchestrationRequested:
      typeof record.orchestrationRequested === "boolean"
        ? record.orchestrationRequested
        : undefined,
    pendingDraft:
      typeof record.pendingDraft === "string" ? record.pendingDraft : undefined,
    answerHistory: Array.isArray(record.answerHistory)
      ? record.answerHistory.filter(isAnswerHistoryItem).map((item) => ({
          questionId: item.questionId,
          ...(item.questionPrompt !== undefined
            ? { questionPrompt: item.questionPrompt }
            : {}),
          answeredAt: item.answeredAt,
          summary: item.summary,
          ...(typeof item.comment === "string" && item.comment.trim()
            ? { comment: item.comment }
            : {}),
          ...(sanitizeQuestion(item.question)
            ? { question: sanitizeQuestion(item.question)! }
            : {}),
          ...(Array.isArray(item.selectedChoiceIds)
            ? {
                selectedChoiceIds: item.selectedChoiceIds.filter(
                  (id): id is string => typeof id === "string",
                ),
              }
            : {}),
        }))
      : undefined,
    audit: audit ?? undefined,
  };
}

export function sanitizeAssessmentInterviewSourceSnippet(
  value: unknown,
): AssessmentInterviewSourceSnippet | null {
  const record = objectRecord(value);
  const snippetRef = sanitizeSnippetRef(record?.snippetRef);
  if (
    !record ||
    !snippetRef ||
    !Array.isArray(record.lines) ||
    typeof record.redacted !== "boolean" ||
    typeof record.truncated !== "boolean"
  ) {
    return null;
  }
  const lines = record.lines.map((value) => {
    const line = objectRecord(value);
    return line && Number.isInteger(line.line) && typeof line.text === "string"
      ? { line: line.line as number, text: line.text }
      : null;
  });
  if (lines.some((line) => line === null)) {
    return null;
  }
  return {
    snippetRef,
    lines: lines.filter(isDefined),
    redacted: record.redacted,
    truncated: record.truncated,
  };
}

export function sanitizeAssessmentPostFindingState(
  value: unknown,
): AssessmentPostFindingRuntimeState | null {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.assessmentId !== "string" ||
    !isPostFindingRuntimePhase(record.phase) ||
    !isApprovalStatus(record.approvalStatus)
  ) {
    return null;
  }

  return {
    assessmentId: record.assessmentId,
    phase: record.phase,
    codeReviewActivities: sanitizePostFindingActivities(
      record.codeReviewActivities,
    ),
    decisionAvailability: Array.isArray(record.decisionAvailability)
      ? record.decisionAvailability.filter(isRemediationDecision)
      : [],
    selectedDecision: isRemediationDecision(record.selectedDecision)
      ? record.selectedDecision
      : undefined,
    selectedDecisionAt:
      typeof record.selectedDecisionAt === "string"
        ? record.selectedDecisionAt
        : undefined,
    detectedPullRequest: sanitizePostFindingPullRequest(
      record.detectedPullRequest,
    ),
    createdPullRequest: sanitizePostFindingPullRequest(
      record.createdPullRequest,
    ),
    approvalStatus: record.approvalStatus,
    approvedPatchVersion:
      typeof record.approvedPatchVersion === "string"
        ? record.approvedPatchVersion
        : undefined,
    verificationActivities: sanitizePostFindingActivities(
      record.verificationActivities,
    ),
    verificationStatus: isVerificationStatus(record.verificationStatus)
      ? record.verificationStatus
      : undefined,
    finalResult: isFinalResultStatus(record.finalResult)
      ? record.finalResult
      : undefined,
    canContinueRemediation:
      typeof record.canContinueRemediation === "boolean"
        ? record.canContinueRemediation
        : undefined,
    artifacts: sanitizePostFindingArtifactRefs(record.artifacts),
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
    question.choices = record.choices
      .map(sanitizeQuestionChoice)
      .filter(isDefined);
  }
  if (typeof record.priorAnswerSummary === "string") {
    question.priorAnswerSummary = record.priorAnswerSummary;
  }
  if (typeof record.proposedInterpretation === "string") {
    question.proposedInterpretation = record.proposedInterpretation;
  }
  if (Array.isArray(record.whyEvidenceRefs)) {
    question.whyEvidenceRefs = record.whyEvidenceRefs.filter(
      (item): item is string => typeof item === "string",
    );
  }
  const snippetRef = sanitizeSnippetRef(record.snippetRef);
  if (snippetRef) {
    question.snippetRef = snippetRef;
  }
  return question;
}

function sanitizeSnippetRef(value: unknown): AiDiscoverySnippetRef | null {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.snapshot_id !== "string" ||
    typeof record.commit_sha !== "string" ||
    typeof record.file_path !== "string" ||
    (record.symbol !== undefined && typeof record.symbol !== "string") ||
    !Number.isInteger(record.start_line) ||
    !Number.isInteger(record.end_line) ||
    (record.start_line as number) < 1 ||
    (record.end_line as number) < (record.start_line as number) ||
    typeof record.evidence_hash !== "string" ||
    record.snippet_policy !==
      AI_DISCOVERY_SNIPPET_POLICIES.pinnedSnapshotBoundedRedacted
  ) {
    return null;
  }
  return {
    snapshot_id: record.snapshot_id,
    commit_sha: record.commit_sha,
    file_path: record.file_path,
    ...(record.symbol ? { symbol: record.symbol } : {}),
    start_line: record.start_line as number,
    end_line: record.end_line as number,
    evidence_hash: record.evidence_hash,
    snippet_policy: record.snippet_policy,
  };
}

function sanitizeQuestionChoice(
  value: unknown,
): AssessmentInterviewQuestionChoice | null {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.label !== "string"
  ) {
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
    audit.governedEvidenceRefs = record.governedEvidenceRefs.filter(
      (item): item is string => typeof item === "string",
    );
  }
  return audit;
}

function sanitizePostFindingActivities(
  value: unknown,
): AssessmentPostFindingActivity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = objectRecord(entry);
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.label !== "string" ||
      !isPostFindingActivityStatus(record.status)
    ) {
      return [];
    }
    return [
      {
        id: record.id,
        label: record.label,
        detail: typeof record.detail === "string" ? record.detail : undefined,
        status: record.status,
      },
    ];
  });
}

function sanitizePostFindingPullRequest(value: unknown) {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.number !== "number" ||
    typeof record.branch !== "string" ||
    typeof record.patchVersion !== "string"
  ) {
    return undefined;
  }
  return {
    number: record.number,
    branch: record.branch,
    patchVersion: record.patchVersion,
    url: typeof record.url === "string" ? record.url : undefined,
  };
}

function sanitizePostFindingArtifactRefs(value: unknown) {
  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }
  return {
    remediationPatchResourceId:
      typeof record.remediationPatchResourceId === "string"
        ? record.remediationPatchResourceId
        : undefined,
    verificationReportResourceId:
      typeof record.verificationReportResourceId === "string"
        ? record.verificationReportResourceId
        : undefined,
    finalReportResourceId:
      typeof record.finalReportResourceId === "string"
        ? record.finalReportResourceId
        : undefined,
  };
}

function isAnswerHistoryItem(
  value: unknown,
): value is NonNullable<
  AssessmentInterviewRuntimeState["answerHistory"]
>[number] {
  const record = objectRecord(value);
  return (
    !!record &&
    typeof record.questionId === "string" &&
    typeof record.answeredAt === "string" &&
    (record.questionPrompt === undefined ||
      typeof record.questionPrompt === "string") &&
    (record.actorId === undefined || typeof record.actorId === "string") &&
    typeof record.summary === "string"
  );
}

function isOutcome(
  value: unknown,
): value is AssessmentInterviewRuntimeState["outcome"] {
  return Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(
    value as AssessmentInterviewRuntimeState["outcome"],
  );
}

function isPostFindingActivityStatus(
  value: unknown,
): value is AssessmentPostFindingActivity["status"] {
  return (
    typeof value === "string" &&
    Object.values(ASSESSMENT_RUNTIME_RUN_STATUSES).includes(
      value as AssessmentPostFindingActivity["status"],
    )
  );
}

function isApprovalStatus(
  value: unknown,
): value is AssessmentPostFindingRuntimeState["approvalStatus"] {
  return (
    typeof value === "string" &&
    Object.values(REMEDIATION_APPROVAL_STATUSES).includes(
      value as AssessmentPostFindingRuntimeState["approvalStatus"],
    )
  );
}

function isVerificationStatus(
  value: unknown,
): value is NonNullable<
  AssessmentPostFindingRuntimeState["verificationStatus"]
> {
  return (
    typeof value === "string" &&
    Object.values(VERIFICATION_RESULT_STATUSES).includes(
      value as NonNullable<
        AssessmentPostFindingRuntimeState["verificationStatus"]
      >,
    )
  );
}

function isFinalResultStatus(
  value: unknown,
): value is NonNullable<AssessmentPostFindingRuntimeState["finalResult"]> {
  return (
    typeof value === "string" &&
    Object.values(FINAL_ASSESSMENT_RESULT_STATUSES).includes(
      value as NonNullable<AssessmentPostFindingRuntimeState["finalResult"]>,
    )
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
): value is NonNullable<
  AssessmentInterviewRuntimeState["blockedActions"]
>[number] {
  return Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
    value as NonNullable<
      AssessmentInterviewRuntimeState["blockedActions"]
    >[number],
  );
}

function isFlag(value: unknown): value is AssessmentInterviewFlag {
  return Object.values(ASSESSMENT_INTERVIEW_FLAGS).includes(
    value as AssessmentInterviewFlag,
  );
}

function isContextAuthority(
  value: unknown,
): value is AssessmentContextAuthorityStatus {
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
