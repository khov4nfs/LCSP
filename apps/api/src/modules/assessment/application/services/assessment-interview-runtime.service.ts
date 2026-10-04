import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
  type AuditActorType,
  INTERVIEW_AUDIT_EVENT_TYPES,
  INTERVIEW_TECHNICAL_COVERAGE_STATES,
  type InterviewAuditActorRef,
  type InterviewSourceSnapshotRef,
  type InterviewTechnicalCoverageState,
} from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  type AiDiscoverySnippetRef,
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_MODES,
  ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES,
  ASSESSMENT_INTERVIEW_RESUME_MAX_ATTEMPTS,
  ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES,
  ASSESSMENT_INTERVIEW_RESUME_REASONS,
  ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  type AssessmentContextAuthorityStatus,
  type AssessmentInterviewAnswerHistoryItem,
  type AssessmentInterviewAnswerInput,
  type AssessmentInterviewBlockedInput,
  type AssessmentInterviewControl,
  type AssessmentInterviewOrchestratorAction,
  type AssessmentInterviewQuestion,
  type AssessmentInterviewQuestionIntent,
  type AssessmentInterviewResumeInput,
  type AssessmentInterviewRuntimeState,
  type AssessmentInterviewWorkflowEvent,
  type AssessmentPostFindingDecisionInput,
  type AssessmentPostFindingRuntimeState,
  BUSINESS_CONTEXT_NEED_STATES,
  type BusinessContextNeedState,
  type CanonicalAssessmentInterviewMode,
  CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES,
  type CustomerAnswer,
  EMPTY_INTERVIEW_WORKING_STRATEGY,
  INTERVIEW_FRONTIER_MATERIALITIES,
  INTERVIEW_FRONTIER_OWNERS,
  INTERVIEW_PROGRESS_PHASES,
  INTERVIEW_TECHNICAL_CONTRACT_VERSION,
  type InterviewWorkingStrategy,
  isRemediationDecision,
  type PartialCoveragePolicyDecision,
  POST_FINDING_RUNTIME_PHASES,
  REMEDIATION_DECISIONS,
  type SubmitInterviewAnswerCommand,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { asRecord as objectRecord } from "@lcsp/contracts/shared";
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { AssessmentRuntimeControlService } from "../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { InterviewAuditService } from "../../../audit/application/services/interview-audit.service.js";
import { InterviewGuidanceResolver } from "./interview-guidance.resolver.js";
import { missingInitialPlanningContextDimensions } from "./interview-minimum-planning-context.js";
import {
  normalizeStrategy,
  updateInterviewWorkingStrategy,
} from "./interview-working-strategy.js";

const INTERVIEW_TOOL_NAME = "assessment_interview";
const INTERVIEW_TRANSACTION_TIMEOUT_MS = 15_000;
const INTERVIEW_TRANSACTION_MAX_WAIT_MS = 5_000;
const INTERVIEW_TRANSACTION_RETRY_ATTEMPTS = 2;
const INTERVIEW_TRANSACTION_RETRY_DELAY_MS = 150;
const PROVENANCE_CACHE_TTL_MS = 15_000;
const PROVENANCE_CACHE_MAX_ENTRIES = 64;
const INTERVIEW_SOURCE_VERSION = "assessment-interview-runtime-v1";
const MISSING_SOURCE_VERSION = "NO_REPOSITORY_SNAPSHOT";
const MISSING_PGE_VERSION = "NO_TECHNICAL_EVIDENCE_REPORT";
const PUBLIC_REDACTED_ANSWER_SUMMARY =
  "Customer answer persisted in governed Interview state.";
const PUBLIC_REDACTED_DRAFT_SUMMARY =
  "Customer draft persisted for Interview resume.";
const INTERVIEW_AGENT_DECISION_REQUIRED = "INTERVIEW_AGENT_DECISION_REQUIRED";
const BUSINESS_CONTEXT_RESOLUTION_REQUIRED =
  ASSESSMENT_INTERVIEW_RESUME_REASONS.businessContextResolutionRequired;
// Worker-only private answer history (never merged into publicState, which stays
// the sanitized customer projection). Bounded so a long-running Interview thread
// cannot grow the model prompt unboundedly: only the most recent
// WORKER_PRIOR_ANSWER_HISTORY_MAX_ENTRIES prior revisions are returned (older ones
// are dropped and counted, never silently truncated without a signal), and each
// comment/free-text field is cut at WORKER_PRIOR_ANSWER_HISTORY_TEXT_LIMIT
// characters with an explicit truncation marker appended.
const WORKER_PRIOR_ANSWER_HISTORY_MAX_ENTRIES = 20;
const WORKER_PRIOR_ANSWER_HISTORY_TEXT_LIMIT = 500;
const WORKER_PRIOR_ANSWER_HISTORY_TRUNCATION_MARKER = "…[truncated]";
const POST_FINDING_DECISION_TOOL_NAME = "post_finding_remediation_decision";
const POST_FINDING_RUNTIME_CONTINUATION_REQUIRED =
  "POST_FINDING_RUNTIME_CONTINUATION_REQUIRED";
const TARGETED_TEXT_LEAK_PATTERNS = [
  /\bEngineeringRule\b/iu,
  /\bLegalRule\b/iu,
  /\bcompliance classification\b/iu,
  /\bEU AI Act\b/iu,
  /\brisk category\b/iu,
  /\b(?:ENG|ER|LR)-\d+\b/iu,
  /\bcheckpoint(?:Id)?\b/iu,
  /\bcontinuation(?: token)?\b/iu,
  /\bLangGraph\b/iu,
  /\bthread(?:Id)?\b/iu,
  /\b[a-z0-9_.-]+\/[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|java|go|rs)\b/iu,
  /\b(?:CUSTOMER_CONFIRMED|CUSTOMER_STATED|CONTEXT_READY|CONTEXT_RESOLVED|INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY|BUSINESS_CONTEXT_RESOLUTION|TARGETED_EXACT_RESUME_PIN|WAITING_FOR_CUSTOMER|BLOCKED_OR_UNRESOLVED|NEEDS_INPUT|DECISION_PATH_UNRESOLVED)\b/iu,
  /\bresolutionCriteria\b/iu,
] as const;
const INTERNAL_ORCHESTRATION_TOKEN_PATTERNS = [
  /\bCUSTOMER_CONFIRMED\b/gu,
  /\bCUSTOMER_STATED\b/gu,
  /\bCONTEXT_READY\b/gu,
  /\bCONTEXT_RESOLVED\b/gu,
  /\bINTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY\b/gu,
  /\bBUSINESS_CONTEXT_RESOLUTION\b/gu,
  /\bTARGETED_EXACT_RESUME_PIN\b/gu,
  /\bWAITING_FOR_CUSTOMER\b/gu,
  /\bBLOCKED_OR_UNRESOLVED\b/gu,
  /\bNEEDS_INPUT\b/gu,
  /\bDECISION_PATH_UNRESOLVED\b/gu,
  /\bresolutionCriteria\b/gu,
] as const;
export type PrivateInterviewAnswerRevision = {
  questionId: string;
  answer: AssessmentInterviewAnswerInput;
  actorId: string;
  answeredAt: string;
  contextRevision: number;
  priorRevision: number;
  authority: AssessmentContextAuthorityStatus;
  questionIntent?: NonNullable<
    AssessmentInterviewRuntimeState["activeQuestion"]
  >["intent"];
  questionControl?: NonNullable<
    AssessmentInterviewRuntimeState["activeQuestion"]
  >["control"];
  sourceVersion: string;
  pgeVersion: string;
  governedEvidenceRefs: string[];
  /**
   * True when customer text/comment or requires-free-text choices need model
   * interpretation before authority can be claimed.
   */
  answerRequiresInterpretation?: boolean;
  processedAt?: string;
};

// Worker-only: one prior turn's answer, verbatim, so the model sees the Customer's
// own wording in later turns instead of only the sanitized publicState.answerHistory
// summary ("Customer selected N option(s)."). Never added to publicState.
export type WorkerPriorAnswerHistoryItem = {
  questionId: string;
  contextRevision: number;
  questionIntent?: PrivateInterviewAnswerRevision["questionIntent"];
  questionControl?: PrivateInterviewAnswerRevision["questionControl"];
  selectedChoiceIds?: string[];
  confirmed?: boolean;
  adjusted?: boolean;
  freeText?: string;
  comment?: string;
};

type InterviewAnswerIdempotencyRecord = {
  clientRequestId: string;
  payloadFingerprint: string;
  questionId: string;
  contextRevision: number;
  recordedAt: string;
};

/**
 * BusinessContextNeed: one customer-owned business fact a single EngineeringRule
 * criterion needs. Registered by the repository-analyst runtime after
 * BUSINESS_CONTEXT_REQUIRED; persisted under the legacy `targetedNeed` store key.
 */
type TargetedInterviewNeed = {
  needId: string;
  state: BusinessContextNeedState;
  engineeringRuleId: string;
  criterionId: string;
  authoredConditionIndex?: number;
  /** Customer-safe, neutral question the Interview Agent bases its question on. */
  question: string;
  /** Neutral plain-language note of what was observed; context for the agent only. */
  observation: string;
  /** Criterion ids this need resolves; answers cite one via `resolvesCriterionId`. */
  resolutionCriterionIds: string[];
  governedEvidenceRefs?: string[];
  contextRevision: number;
  originatingRuleAnalysisReference: string;
  sourceVersion: string;
  pgeVersion: string;
  /**
   * Compatibility adapter (read-only): topic-matched criteria of needs persisted by
   * the pre-BusinessContextNeed runtime. Consumer: assertGuardedDecision. Remove once
   * no AssessmentInterviewThread.privateContextJson holds a targetedNeed without
   * `engineeringRuleId` (one release after deploy).
   */
  legacyResolutionCriteria?: string[];
};

type TargetedInterviewContinuation = {
  originatingRuleAnalysisReference: string;
  needId: string;
  engineeringRuleId: string;
  criterionId?: string;
  /** Criteria the worker may bind a resolved answer to; absent on pre-existing rows. */
  resolutionCriterionIds?: string[];
  contextRevision: number;
  workflowRunId: string;
  checkpointId?: string;
  artifactVersions?: Record<string, string>;
  sourceVersion: string;
  pgeVersion: string;
};

type PrivateInterviewStore = {
  revisions: PrivateInterviewAnswerRevision[];
  submittedAnswerRequests?: InterviewAnswerIdempotencyRecord[];
  workflowRunId?: string;
  workingStrategy?: InterviewWorkingStrategy;
  targetedNeed?: TargetedInterviewNeed;
  targetedContinuation?: TargetedInterviewContinuation;
  partialCoveragePolicyDecision?: PartialCoveragePolicyDecision;
  // Context revision whose Interview Agent decision run reported FAILED.
  failedDecisionRevision?: number;
  // Customer-triggered resume attempts for the failed context revision.
  resumeAttempts?: InterviewResumeAttempts;
};

type InterviewResumeAttempts = {
  contextRevision: number;
  count: number;
};

type TargetedNeedRegistrationInput = {
  actorId: string;
  needId: string;
  engineeringRuleId: string;
  criterionId: string;
  authoredConditionIndex?: number;
  question: string;
  observation: string;
  resolutionCriterionIds: string[];
  evidenceRefs: string[];
  contextRevision: number;
  workflowRunId: string;
  checkpointId?: string;
  artifactVersions?: Record<string, string>;
};

type WorkerPrivateContext = {
  status: "CURRENT" | "DUPLICATE" | "STALE" | "STALE_PROVENANCE";
  assessmentId: string;
  threadId: string;
  workflowRunId?: string;
  rootWorkflowRunId?: string;
  authenticatedActorId?: string;
  requestedRevision: number;
  currentRevision: number;
  processedRevision: number;
  sourceVersion: string;
  pgeVersion: string;
  technicalCoverageState?: InterviewTechnicalCoverageState;
  coverageLimitations?: string[];
  partialCoveragePolicyDecision?: PartialCoveragePolicyDecision;
  publicState: AssessmentInterviewRuntimeState;
  confirmedContext?: AssessmentInterviewRuntimeState["confirmedContext"];
  privateRevision?: PrivateInterviewAnswerRevision;
  // Worker-only recovery input; never merged into publicState/customer projection.
  priorAnswerHistory: WorkerPriorAnswerHistoryItem[];
  priorAnswerHistoryOmittedCount: number;
  targetedNeed?: TargetedInterviewNeed;
  guidanceVersion: string;
  workingStrategy: InterviewWorkingStrategy;
};

type InterviewThreadSnapshot = {
  exists: boolean;
  state: AssessmentInterviewRuntimeState;
  privateStore: PrivateInterviewStore;
  privateRevisions: PrivateInterviewAnswerRevision[];
  contextRevision: number;
  activeQuestionId: string | null;
  processedRevision: number;
  sourceVersion: string | null;
  pgeVersion: string | null;
  guidanceVersion: string | null;
};

type AssessmentProvenanceSnapshot = {
  sourceVersion: string;
  pgeVersion: string;
  snapshotId?: string;
  commitSha?: string;
  technicalCoverageState: InterviewTechnicalCoverageState;
  coverageLimitations: string[];
  partialCoveragePolicyDecision?: PartialCoveragePolicyDecision;
  governedEvidenceRefs: string[];
};

type AgentDecisionInput = {
  expectedContextRevision: number;
  mode?: CanonicalAssessmentInterviewMode;
  outcome: AssessmentInterviewRuntimeState["outcome"];
  activeQuestion?: AssessmentInterviewRuntimeState["activeQuestion"];
  rationale?: string;
  contextAuthority?: AssessmentContextAuthorityStatus;
  confirmedContext?: Record<string, unknown>;
  blockedActions?: AssessmentInterviewRuntimeState["blockedActions"];
  flags?: AssessmentInterviewRuntimeState["flags"];
};

type OrchestratorInterviewTransition = {
  mode: CanonicalAssessmentInterviewMode;
  action: AssessmentInterviewOrchestratorAction;
  workflowEvent: AssessmentInterviewWorkflowEvent;
  exactResumeAllowed: boolean;
  requiresDownstreamRescope: boolean;
};

@Injectable()
export class AssessmentInterviewRuntimeService {
  private readonly logger = new Logger(AssessmentInterviewRuntimeService.name);

  private readonly guidanceResolver = new InterviewGuidanceResolver();

  private readonly provenanceCache = new Map<
    string,
    { value: AssessmentProvenanceSnapshot; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
    private readonly outboxRepository: OutboxRepository,
    private readonly interviewAudit: InterviewAuditService,
    private readonly runtimeControl: AssessmentRuntimeControlService,
  ) {}

  async getState(
    assessmentId: string,
    actor: RbacRequestContext,
  ): Promise<AssessmentInterviewRuntimeState> {
    await this.assertAssessmentVisible(assessmentId, actor);
    const thread = await this.readThread(assessmentId);
    const state = publicState(thread.state);
    const answerHistory = await Promise.all(
      (state.answerHistory ?? []).map(async (item) => {
        if (item.question) return item;
        const event = await this.prisma.auditEvent.findFirst({
          where: {
            resourceId: assessmentId,
            sessionId: this.threadId(assessmentId),
            eventType: INTERVIEW_AUDIT_EVENT_TYPES.questionPersisted,
            createdAt: { lte: new Date(item.answeredAt) },
            payload: { path: ["questionId"], equals: item.questionId },
          },
          orderBy: { createdAt: "desc" },
          select: { payload: true },
        });
        const payload = objectRecord(event?.payload);
        const control =
          payload?.control as AssessmentInterviewQuestion["control"];
        const intent =
          payload?.questionIntent as AssessmentInterviewQuestion["intent"];
        const question =
          typeof payload?.prompt === "string" &&
          Object.values(ASSESSMENT_INTERVIEW_CONTROLS).includes(control) &&
          Object.values(ASSESSMENT_INTERVIEW_QUESTION_INTENTS).includes(intent)
            ? publicActiveQuestion({
                id: item.questionId,
                prompt: payload.prompt,
                control,
                intent,
                choices: Array.isArray(payload.choices)
                  ? payload.choices.flatMap((value) => {
                      const choice = objectRecord(value);
                      return typeof choice?.id === "string" &&
                        typeof choice.label === "string"
                        ? [{ id: choice.id, label: choice.label }]
                        : [];
                    })
                  : undefined,
              })
            : undefined;
        return {
          ...item,
          question,
          questionPrompt:
            typeof payload?.prompt === "string"
              ? sanitizePublicText(payload.prompt)
              : item.questionPrompt,
        };
      }),
    );
    return {
      ...state,
      answerHistory: answerHistory.map((item) => {
        const revision = thread.privateRevisions.find(
          (entry) =>
            entry.questionId === item.questionId &&
            entry.answeredAt === item.answeredAt &&
            entry.actorId === actor.userId,
        );
        const text = revision?.answer.freeText;
        return {
          ...item,
          selectedChoiceIds: revision?.answer.selectedChoiceIds,
          comment: sanitizePublicText(
            revision?.answer.comment?.trim() || revision?.answer.otherText,
          ),
          summary: text
            ? (sanitizePublicText(text) ?? item.summary)
            : item.summary,
        };
      }),
    };
  }

  /**
   * Resolves private provenance needed by the source-snippet endpoint after the
   * same assessment visibility check used by the public state projection.
   * Evidence references stay internal and are never returned in publicState().
   */
  async resolveActiveQuestionSnippetContext(
    assessmentId: string,
    questionId: string,
    actor: RbacRequestContext,
  ): Promise<{
    evidenceReportId?: string;
    snippetRef: AiDiscoverySnippetRef;
  }> {
    await this.assertAssessmentVisible(assessmentId, actor);
    const thread = await this.readThread(assessmentId);
    const question = thread.state.activeQuestion;
    if (!question || question.id !== questionId || !question.snippetRef) {
      throw new NotFoundException({
        code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE",
      });
    }
    const evidenceReportRef = [
      ...(question.whyEvidenceRefs ?? []),
      ...(question.frontier?.evidenceRefs ?? []),
    ].find((ref) => ref.startsWith("technicalEvidenceReport:"));
    const evidenceReportId = evidenceReportRef?.slice(
      "technicalEvidenceReport:".length,
    );
    // Agent-authored refs may be plain anchor ids; the snippet service then resolves the
    // accepted report by the snippet's pinned snapshot and re-verifies the governed ref.
    return { evidenceReportId, snippetRef: question.snippetRef };
  }

  async recordWorkerProgress(
    assessmentId: string,
    body: unknown,
    correlationId: string,
  ) {
    const input = objectRecord(body);
    const phases = [
      INTERVIEW_PROGRESS_PHASES.running,
      INTERVIEW_PROGRESS_PHASES.toolRunning,
      INTERVIEW_PROGRESS_PHASES.failed,
    ];
    if (
      !input ||
      !Number.isSafeInteger(input.contextRevision) ||
      Number(input.contextRevision) < 1 ||
      !phases.some((phase) => phase === input.phase) ||
      Object.keys(input).some(
        (key) => key !== "contextRevision" && key !== "phase",
      )
    ) {
      throw problemException(
        "INTERVIEW_CONFIRMED_CONTEXT_INVALID",
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const thread = await this.readThread(assessmentId);
    if (
      thread.contextRevision !== input.contextRevision ||
      thread.processedRevision >= Number(input.contextRevision)
    ) {
      return { recorded: false };
    }
    const runId =
      thread.privateStore.targetedContinuation?.workflowRunId ??
      thread.privateStore.workflowRunId;
    if (!runId) return { recorded: false };
    const event = {
      assessmentId,
      runId,
      correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary: `Interview progress: ${String(input.phase)}`,
      outputSummary: {
        interviewProgress: {
          contextRevision: input.contextRevision,
          phase: input.phase,
        },
      },
    };
    if (input.phase === INTERVIEW_PROGRESS_PHASES.failed) {
      // Remember the failed revision so the Customer can resume the same turn.
      await this.prisma.assessmentInterviewThread.updateMany({
        where: {
          assessmentId,
          contextRevision: thread.contextRevision,
          processedRevision: thread.processedRevision,
        },
        data: {
          privateContextJson: toJson({
            ...thread.privateStore,
            failedDecisionRevision: thread.contextRevision,
          }),
        },
      });
      await this.runtimeEvents.recordToolFailed(event);
    } else {
      await this.runtimeEvents.recordToolStarted(event);
    }
    return { recorded: true };
  }

  async submitAnswer(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    answer: SubmitInterviewAnswerCommand;
  }): Promise<AssessmentInterviewRuntimeState> {
    const command = parseSubmitAnswerCommand(input.answer, input.assessmentId);
    const answer = command.answer;
    await this.assertAssessmentVisible(input.assessmentId, input.actor);
    const now = new Date().toISOString();
    const provenance = await this.assessmentProvenance(input.assessmentId);
    const next = await this.runInterviewTransaction(async (tx) => {
      const thread = await this.readThread(input.assessmentId, tx);
      if (
        command.sessionId &&
        command.sessionId !== this.threadId(input.assessmentId)
      ) {
        throw problemException(
          "INTERVIEW_SESSION_MISMATCH",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const payloadFingerprint = command.clientRequestId
        ? stableJson({
            assessmentId: input.assessmentId,
            sessionId: command.sessionId,
            questionRef: answer.questionId,
            expectedSessionRevision: command.expectedSessionRevision,
            answer,
          })
        : undefined;
      const existingRequest = command.clientRequestId
        ? thread.privateStore.submittedAnswerRequests?.find(
            (request) => request.clientRequestId === command.clientRequestId,
          )
        : undefined;
      if (existingRequest) {
        if (existingRequest.payloadFingerprint !== payloadFingerprint) {
          throw problemException(
            "INTERVIEW_ANSWER_IDEMPOTENCY_CONFLICT",
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        return {
          state: thread.state,
          revision: existingRequest.contextRevision,
          questionId: existingRequest.questionId,
          workflowRunId:
            thread.privateStore.targetedContinuation?.workflowRunId ??
            thread.privateStore.workflowRunId ??
            this.threadId(input.assessmentId),
          partialCoveragePolicyDecision:
            thread.privateStore.partialCoveragePolicyDecision,
          idempotentReplay: true,
        };
      }
      if (
        command.expectedSessionRevision !== undefined &&
        command.expectedSessionRevision !== thread.contextRevision
      ) {
        throw problemException(
          "INTERVIEW_SESSION_REVISION_STALE",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      if (
        !thread.state.activeQuestion ||
        thread.state.activeQuestion.id !== answer.questionId ||
        thread.activeQuestionId !== answer.questionId
      ) {
        throw problemException(
          "INTERVIEW_QUESTION_STALE_OR_UNKNOWN",
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      assertAnswerMatchesQuestion(answer, thread.state.activeQuestion);
      const priorRevision = thread.contextRevision;
      const nextRevision = priorRevision + 1;
      const historyItem: AssessmentInterviewAnswerHistoryItem = {
        questionId: answer.questionId,
        questionPrompt: sanitizePublicText(thread.state.activeQuestion.prompt),
        actorId: input.actor.userId,
        answeredAt: now,
        summary: summarizeAnswer(answer),
      };
      const questionEvidenceRefs = [
        ...(thread.state.activeQuestion.whyEvidenceRefs ?? []),
        ...(thread.state.activeQuestion.frontier?.evidenceRefs ?? []),
      ];
      const lineageEvidenceRefs = Array.from(
        new Set([...provenance.governedEvidenceRefs, ...questionEvidenceRefs]),
      );
      const privateRevision: PrivateInterviewAnswerRevision = {
        questionId: answer.questionId,
        answer,
        actorId: input.actor.userId,
        answeredAt: now,
        contextRevision: nextRevision,
        priorRevision,
        authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
        questionIntent: thread.state.activeQuestion.intent,
        questionControl: thread.state.activeQuestion.control,
        sourceVersion: provenance.sourceVersion,
        pgeVersion: provenance.pgeVersion,
        governedEvidenceRefs: lineageEvidenceRefs,
        answerRequiresInterpretation: requiresAnswerInterpretation(
          answer,
          thread.state.activeQuestion,
        ),
      };
      const nextState: AssessmentInterviewRuntimeState = {
        ...thread.state,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
        contextRevision: nextRevision,
        activeQuestion: undefined,
        pendingDraft: undefined,
        answerHistory: [...(thread.state.answerHistory ?? []), historyItem],
        orchestrationRequested: true,
        audit: this.auditRef(
          input.assessmentId,
          input.actor.userId,
          input.correlationId,
          {
            contextRevision: nextRevision,
            priorRevision,
            newRevision: nextRevision,
            relatedQuestionId: answer.questionId,
            provenance: {
              ...provenance,
              governedEvidenceRefs: lineageEvidenceRefs,
            },
          },
        ),
      };
      const workingStrategy = updateInterviewWorkingStrategy({
        current:
          thread.privateStore.workingStrategy ??
          EMPTY_INTERVIEW_WORKING_STRATEGY,
        question: thread.state.activeQuestion,
        answer,
      });
      const updated = await tx.assessmentInterviewThread.updateMany({
        where: {
          assessmentId: input.assessmentId,
          activeQuestionId: answer.questionId,
          contextRevision: priorRevision,
        },
        data: {
          stateJson: toJson(nextState),
          privateContextJson: toJson({
            ...thread.privateStore,
            revisions: [...thread.privateRevisions, privateRevision],
            submittedAnswerRequests: command.clientRequestId
              ? [
                  ...(thread.privateStore.submittedAnswerRequests ?? []),
                  {
                    clientRequestId: command.clientRequestId,
                    payloadFingerprint: payloadFingerprint ?? "",
                    questionId: answer.questionId,
                    contextRevision: nextRevision,
                    recordedAt: now,
                  },
                ]
              : thread.privateStore.submittedAnswerRequests,
            workingStrategy,
          }),
          contextRevision: nextRevision,
          activeQuestionId: null,
          processedRevision: thread.processedRevision,
          sourceVersion: provenance.sourceVersion,
          pgeVersion: provenance.pgeVersion,
          guidanceVersion:
            thread.guidanceVersion ?? this.resolveGuidanceVersion(),
        },
      });
      if (updated.count !== 1) {
        throw problemException(
          "INTERVIEW_QUESTION_STALE_OR_UNKNOWN",
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      const workflowRunId =
        thread.privateStore.targetedContinuation?.workflowRunId ??
        thread.privateStore.workflowRunId;
      if (!workflowRunId) {
        throw problemException(
          "INTERVIEW_WORKFLOW_RUN_ID_REQUIRED",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      await this.outboxRepository.enqueue(
        this.interviewAgentResumeCommand({
          assessmentId: input.assessmentId,
          workflowRunId,
          actorId: input.actor.userId,
          correlationId: input.correlationId,
          contextRevision: nextRevision,
          questionId: answer.questionId,
          sourceVersion: provenance.sourceVersion,
          pgeVersion: provenance.pgeVersion,
          guidanceVersion:
            thread.guidanceVersion ?? this.resolveGuidanceVersion(),
          resumeReason: INTERVIEW_AGENT_DECISION_REQUIRED,
        }),
        tx,
      );

      const sourceSnapshot: InterviewSourceSnapshotRef = {
        snapshotId: provenance.snapshotId,
        commitSha: provenance.commitSha,
        sourceVersion: provenance.sourceVersion,
        pgeVersion: provenance.pgeVersion,
        technicalCoverageState: provenance.technicalCoverageState,
        coverageLimitations: provenance.coverageLimitations,
        partialCoveragePolicyDecision: provenance.partialCoveragePolicyDecision,
        guidanceVersion:
          thread.guidanceVersion ?? this.resolveGuidanceVersion(),
      };
      const responseMode = thread.state.activeQuestion.control;
      const responseAction = answer.confirmed
        ? ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm
        : answer.adjusted
          ? ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust
          : undefined;
      const answerValue =
        answer.freeText ??
        answer.otherText ??
        answer.selectedChoiceIds ??
        (answer.confirmed ? true : answer.adjusted ? false : null);

      const respondentRef: InterviewAuditActorRef = {
        id: input.actor.userId,
        role: input.actor.role,
        authenticated: true as const,
      };

      await this.interviewAudit.recordCustomerAnswer(
        {
          assessmentId: input.assessmentId,
          respondentRef,
          questionId: answer.questionId,
          questionIntent: thread.state.activeQuestion.intent,
          responseMode,
          responseAction,
          answerValue,
          interviewContextRevision: String(nextRevision),
          sessionId: this.threadId(input.assessmentId),
          threadId: this.threadId(input.assessmentId),
          turnId: nextRevision,
          sourceSnapshot,
          evidenceRefs: lineageEvidenceRefs,
          correlationId: input.correlationId,
        },
        tx,
      );

      await this.interviewAudit.recordContextRevisionCreated(
        {
          assessmentId: input.assessmentId,
          respondentRef,
          contextRevision: nextRevision,
          priorRevision,
          authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
          statementKey: answer.questionId,
          statementValue: answerValue,
          sessionId: this.threadId(input.assessmentId),
          threadId: this.threadId(input.assessmentId),
          turnId: nextRevision,
          sourceSnapshot,
          governedEvidenceRefs: lineageEvidenceRefs,
          correlationId: input.correlationId,
        },
        tx,
      );

      return {
        state: nextState,
        revision: nextRevision,
        questionId: answer.questionId,
        workflowRunId,
        partialCoveragePolicyDecision:
          provenance.partialCoveragePolicyDecision ??
          thread.privateStore.partialCoveragePolicyDecision,
        idempotentReplay: false,
      };
    });

    if (next.idempotentReplay) {
      return publicState(next.state);
    }

    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: next.workflowRunId,
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary:
        "Customer interview answer persisted; Interview Agent sufficiency decision required.",
      inputSummary: {
        questionId: next.questionId,
        answer: PUBLIC_REDACTED_ANSWER_SUMMARY,
      },
      outputSummary: {
        assessmentInterview: publicState(next.state),
        interviewProgress: {
          contextRevision: next.revision,
          phase: INTERVIEW_PROGRESS_PHASES.queued,
        },
        interviewWorkflowEvent:
          ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextUpdated,
        partialCoveragePolicyDecision:
          next.partialCoveragePolicyDecision ?? null,
      },
      waitingReason:
        ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextUpdated,
      startedAt: new Date(),
    });

    return publicState(next.state);
  }

  /**
   * Summarises the Interview thread for pipeline Continue after the caller has
   * checked visibility: whether the Customer owes an answer, and whether an
   * answered turn is still waiting for its Interview Agent decision.
   */
  async pipelineInterviewStatus(assessmentId: string): Promise<{
    awaitingCustomer: boolean;
    pendingTurn: boolean;
  }> {
    const thread = await this.readThread(assessmentId);
    // A blocked Interview waits for the Customer's blocked-action choice.
    const awaitingCustomer = Boolean(
      thread.activeQuestionId ||
      thread.state.activeQuestion ||
      thread.state.outcome ===
        ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
    );
    return {
      awaitingCustomer,
      pendingTurn:
        thread.exists &&
        !awaitingCustomer &&
        thread.processedRevision < thread.contextRevision,
    };
  }

  /**
   * Re-queues the Interview Agent decision for the current context revision
   * after the worker reported FAILED. The Customer answer is already persisted,
   * so the retry reuses the same revision instead of asking for a new answer.
   */
  async resumeFailedTurn(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    resume: AssessmentInterviewResumeInput;
    // Pipeline Continue has already proven no worker owns the turn, so a turn
    // that stalled without reporting FAILED (worker crash) is resumable too.
    allowStalled?: boolean;
    actorType?: AuditActorType;
  }): Promise<AssessmentInterviewRuntimeState> {
    const resume = parseResumeInput(input.resume, input.correlationId);
    await this.assertAssessmentVisible(input.assessmentId, input.actor);
    const provenance = await this.assessmentProvenance(input.assessmentId);
    const currentRevision = (await this.readThread(input.assessmentId))
      .contextRevision;
    // Failures reported before the thread persisted failedDecisionRevision are
    // still visible as the latest FAILED progress event, which the composer uses.
    const latestProgressPhase =
      await this.runtimeEvents.getLatestInterviewProgressPhase(
        input.assessmentId,
        INTERVIEW_TOOL_NAME,
        currentRevision,
      );
    const next = await this.runInterviewTransaction(async (tx) => {
      const thread = await this.readThread(input.assessmentId, tx);
      const turnFailed =
        input.allowStalled === true ||
        thread.privateStore.failedDecisionRevision === thread.contextRevision ||
        (thread.contextRevision === currentRevision &&
          latestProgressPhase === INTERVIEW_PROGRESS_PHASES.failed);
      if (
        resume.expectedSessionRevision !== undefined &&
        resume.expectedSessionRevision !== thread.contextRevision
      ) {
        throw problemException(
          ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES.revisionStale,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const answered = [...thread.privateRevisions]
        .reverse()
        .find(
          (revision) => revision.contextRevision === thread.contextRevision,
        );
      const targetedNeed = activeBusinessContextNeed(thread.privateStore);
      const target = answered
        ? {
            questionId: answered.questionId,
            resumeReason: INTERVIEW_AGENT_DECISION_REQUIRED,
          }
        : targetedNeed
          ? {
              questionId: targetedNeed.needId,
              resumeReason: BUSINESS_CONTEXT_RESOLUTION_REQUIRED,
            }
          : undefined;
      const workflowRunId =
        thread.privateStore.targetedContinuation?.workflowRunId ??
        thread.privateStore.workflowRunId;
      if (
        !target ||
        !workflowRunId ||
        thread.activeQuestionId ||
        thread.state.activeQuestion ||
        thread.processedRevision >= thread.contextRevision ||
        !turnFailed
      ) {
        throw problemException(
          ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES.notAvailable,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const priorAttempts =
        thread.privateStore.resumeAttempts?.contextRevision ===
        thread.contextRevision
          ? thread.privateStore.resumeAttempts.count
          : 0;
      if (priorAttempts >= ASSESSMENT_INTERVIEW_RESUME_MAX_ATTEMPTS) {
        throw problemException(
          ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES.limitReached,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: { maxAttempts: ASSESSMENT_INTERVIEW_RESUME_MAX_ATTEMPTS },
          },
        );
      }
      const attempt = priorAttempts + 1;
      const updated = await tx.assessmentInterviewThread.updateMany({
        where: {
          assessmentId: input.assessmentId,
          contextRevision: thread.contextRevision,
          processedRevision: thread.processedRevision,
          activeQuestionId: null,
        },
        data: {
          privateContextJson: toJson({
            ...thread.privateStore,
            failedDecisionRevision: undefined,
            resumeAttempts: {
              contextRevision: thread.contextRevision,
              count: attempt,
            },
          }),
        },
      });
      if (updated.count !== 1) {
        throw problemException(
          ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES.notAvailable,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      await this.outboxRepository.enqueue(
        this.interviewAgentResumeCommand({
          assessmentId: input.assessmentId,
          workflowRunId,
          actorId: input.actor.userId,
          actorType: input.actorType,
          correlationId: input.correlationId,
          contextRevision: thread.contextRevision,
          questionId: target.questionId,
          sourceVersion: provenance.sourceVersion,
          pgeVersion: provenance.pgeVersion,
          guidanceVersion:
            thread.guidanceVersion ?? this.resolveGuidanceVersion(),
          resumeReason: target.resumeReason,
          resumeAttempt: attempt,
        }),
        tx,
      );
      return {
        state: thread.state,
        revision: thread.contextRevision,
        questionId: target.questionId,
        workflowRunId,
        attempt,
        partialCoveragePolicyDecision:
          provenance.partialCoveragePolicyDecision ??
          thread.privateStore.partialCoveragePolicyDecision,
      };
    });

    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: next.workflowRunId,
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary:
        input.actorType === AUDIT_ACTOR_TYPES.service
          ? "Assessment reconciliation resumed a stalled Interview turn; Interview Agent sufficiency decision re-queued."
          : "Customer resumed a failed Interview turn; Interview Agent sufficiency decision re-queued.",
      inputSummary: {
        questionId: next.questionId,
        resumeAttempt: next.attempt,
      },
      outputSummary: {
        assessmentInterview: publicState(next.state),
        interviewProgress: {
          contextRevision: next.revision,
          phase: INTERVIEW_PROGRESS_PHASES.queued,
        },
        interviewWorkflowEvent:
          ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextUpdated,
        partialCoveragePolicyDecision:
          next.partialCoveragePolicyDecision ?? null,
      },
      waitingReason:
        ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextUpdated,
      startedAt: new Date(),
    });

    return publicState(next.state);
  }

  /**
   * Binds a stop request to the current native run. Acceptance is not proof of
   * interruption: only the runtime acknowledgement makes the turn resumable.
   */
  async pauseActiveTurn(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
  }): Promise<AssessmentRuntimeControlResult> {
    await this.assertAssessmentVisible(input.assessmentId, input.actor);
    return this.runtimeControl.request({
      assessmentId: input.assessmentId,
      actorId: input.actor.userId,
      correlationId: input.correlationId,
      action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.stop,
    });
  }

  async resumeInterruptedTurn(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    resume: AssessmentInterviewResumeInput;
  }): Promise<
    AssessmentRuntimeControlResult | AssessmentInterviewRuntimeState
  > {
    await this.assertAssessmentVisible(input.assessmentId, input.actor);
    const current = await this.runtimeControl.current(input.assessmentId);
    if (
      current &&
      current.state !== ASSESSMENT_RUNTIME_CONTROL_STATES.completed
    ) {
      return this.runtimeControl.request({
        assessmentId: input.assessmentId,
        actorId: input.actor.userId,
        correlationId: input.correlationId,
        action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
        targetRunId: current.targetRunId,
      });
    }
    return this.resumeFailedTurn({ ...input, allowStalled: true });
  }

  async recordBlockedAction(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    blocked: AssessmentInterviewBlockedInput;
  }): Promise<AssessmentInterviewRuntimeState> {
    const blocked = parseBlockedAction(input.blocked);
    await this.assertAssessmentVisible(input.assessmentId, input.actor);
    const now = new Date();
    const provenance = await this.assessmentProvenance(input.assessmentId);
    const result = await this.runInterviewTransaction(async (tx) => {
      const current = await this.readThread(input.assessmentId, tx);
      const shouldResume =
        blocked.action ===
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext;
      const workflowRunId =
        current.privateStore.targetedContinuation?.workflowRunId ??
        current.privateStore.workflowRunId ??
        this.threadId(input.assessmentId);
      const nextState: AssessmentInterviewRuntimeState = {
        ...current.state,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
        threadId: this.threadId(input.assessmentId),
        activeQuestion: undefined,
        blockedActions: Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS),
        pendingDraft:
          blocked.action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
            ? (blocked.draft ?? current.state.pendingDraft)
            : current.state.pendingDraft,
        orchestrationRequested: shouldResume,
        audit: this.auditRef(
          input.assessmentId,
          input.actor.userId,
          input.correlationId,
          {
            contextRevision: current.contextRevision,
            provenance,
          },
        ),
      };
      await this.persistThreadState(input.assessmentId, nextState, tx, {
        contextRevision: current.contextRevision,
        activeQuestionId: null,
        processedRevision: current.processedRevision,
        privateStore: current.privateStore,
        sourceVersion: provenance.sourceVersion,
        pgeVersion: provenance.pgeVersion,
        guidanceVersion:
          current.guidanceVersion ?? this.resolveGuidanceVersion(),
      });
      if (shouldResume) {
        if (workflowRunId === this.threadId(input.assessmentId)) {
          throw problemException(
            "INTERVIEW_WORKFLOW_RUN_ID_REQUIRED",
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        await this.outboxRepository.enqueue(
          this.interviewAgentResumeCommand({
            assessmentId: input.assessmentId,
            workflowRunId,
            actorId: input.actor.userId,
            correlationId: input.correlationId,
            contextRevision: current.contextRevision,
            questionId: current.activeQuestionId ?? "PROVIDE_MORE_CONTEXT",
            sourceVersion: provenance.sourceVersion,
            pgeVersion: provenance.pgeVersion,
            guidanceVersion:
              current.guidanceVersion ?? this.resolveGuidanceVersion(),
            resumeReason:
              ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
          }),
          tx,
        );
      }

      const respondentRef: InterviewAuditActorRef = {
        id: input.actor.userId,
        role: input.actor.role,
        authenticated: true as const,
      };
      await this.interviewAudit.recordInterviewOutcome(
        {
          assessmentId: input.assessmentId,
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
          respondentRef,
          summary: `Customer chose blocked action: ${blocked.action}`,
          contextRevision: current.contextRevision,
          sessionId: this.threadId(input.assessmentId),
          threadId: this.threadId(input.assessmentId),
          guidanceVersion:
            current.guidanceVersion ?? this.resolveGuidanceVersion(),
          correlationId: input.correlationId,
        },
        tx,
      );

      return {
        state: nextState,
        workflowRunId,
        partialCoveragePolicyDecision:
          current.privateStore.partialCoveragePolicyDecision,
      };
    });

    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: result.workflowRunId,
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary: "Customer selected an unresolved Interview action.",
      inputSummary: {
        action: blocked.action,
        draft: blocked.draft ? PUBLIC_REDACTED_DRAFT_SUMMARY : undefined,
      },
      outputSummary: {
        assessmentInterview: publicState({
          ...result.state,
          pendingDraft: undefined,
        }),
        interviewWorkflowEvent:
          ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewBlockedOrUnresolved,
        partialCoveragePolicyDecision:
          result.partialCoveragePolicyDecision ?? null,
      },
      waitingReason: blocked.action,
      startedAt: now,
    });

    return publicState(result.state);
  }

  async submitPostFindingDecision(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    decision: AssessmentPostFindingDecisionInput;
  }): Promise<AssessmentPostFindingRuntimeState> {
    const decision = parsePostFindingDecision(
      input.decision,
      input.correlationId,
    );
    await this.assertAssessmentVisible(input.assessmentId, input.actor);

    const current = await this.runtimeEvents.getLatestPostFindingState(
      input.assessmentId,
    );
    if (current === null) {
      throw problemException(
        "POST_FINDING_RUNTIME_STATE_REQUIRED",
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    if (current.selectedDecision) {
      throw problemException(
        "POST_FINDING_DECISION_ALREADY_SELECTED",
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    if (!current.decisionAvailability.includes(decision)) {
      throw problemException(
        "POST_FINDING_DECISION_NOT_AVAILABLE",
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const updated: AssessmentPostFindingRuntimeState = {
      ...current,
      phase: postFindingPhaseAfterDecision(current, decision),
      selectedDecision: decision,
      selectedDecisionAt: new Date().toISOString(),
    };

    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: this.threadId(input.assessmentId),
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.remediation,
      toolName: POST_FINDING_DECISION_TOOL_NAME,
      summary:
        "Customer remediation decision persisted for runtime continuation.",
      inputSummary: { decision },
      outputSummary: { postFinding: updated },
      waitingReason: POST_FINDING_RUNTIME_CONTINUATION_REQUIRED,
      startedAt: new Date(),
    });

    return updated;
  }

  async getPrivateContextForWorker(input: {
    assessmentId: string;
    contextRevision: number;
    sourceVersion?: string;
    pgeVersion?: string;
  }): Promise<WorkerPrivateContext> {
    let thread = await this.readThread(input.assessmentId);
    if (
      !thread.guidanceVersion &&
      (thread.sourceVersion !== null ||
        thread.activeQuestionId !== null ||
        thread.contextRevision > 0)
    ) {
      const guidanceVersion = this.resolveGuidanceVersion();
      const pinned = await this.prisma.assessmentInterviewThread.updateMany({
        where: { assessmentId: input.assessmentId, guidanceVersion: null },
        data: { guidanceVersion },
      });
      thread =
        pinned.count === 1
          ? { ...thread, guidanceVersion }
          : await this.readThread(input.assessmentId);
    }
    this.provenanceCache.delete(`${input.assessmentId}:latest`);
    const authoritative = await this.assessmentProvenance(input.assessmentId);
    const privateRevision = thread.privateRevisions.find(
      (revision) => revision.contextRevision === input.contextRevision,
    );
    const target = activeBusinessContextNeed(thread.privateStore);
    const provenanceChanged =
      (input.sourceVersion &&
        input.sourceVersion !== authoritative.sourceVersion) ||
      (input.pgeVersion && input.pgeVersion !== authoritative.pgeVersion) ||
      thread.sourceVersion !== authoritative.sourceVersion ||
      thread.pgeVersion !== authoritative.pgeVersion ||
      (!!privateRevision &&
        (privateRevision.sourceVersion !== authoritative.sourceVersion ||
          privateRevision.pgeVersion !== authoritative.pgeVersion)) ||
      (!!target &&
        (target.sourceVersion !== authoritative.sourceVersion ||
          target.pgeVersion !== authoritative.pgeVersion));
    const status = provenanceChanged
      ? "STALE_PROVENANCE"
      : thread.processedRevision >= input.contextRevision
        ? "DUPLICATE"
        : thread.contextRevision === input.contextRevision && privateRevision
          ? "CURRENT"
          : "STALE";
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: input.assessmentId },
      select: { ownerId: true },
    });
    const authenticatedActorId =
      privateRevision?.actorId || assessment?.ownerId;
    const workflowRunId = (() => {
      const currentWorkflowRunId =
        thread.privateStore.targetedContinuation?.workflowRunId ??
        thread.privateStore.workflowRunId;
      if (target && input.contextRevision < thread.contextRevision) {
        return thread.privateStore.workflowRunId ?? currentWorkflowRunId;
      }
      return currentWorkflowRunId;
    })();
    const {
      items: priorAnswerHistory,
      omittedCount: priorAnswerHistoryOmittedCount,
    } = buildWorkerPriorAnswerHistory(
      thread.privateRevisions,
      input.contextRevision,
    );
    return {
      status,
      assessmentId: input.assessmentId,
      threadId: this.threadId(input.assessmentId),
      workflowRunId,
      authenticatedActorId,
      requestedRevision: input.contextRevision,
      rootWorkflowRunId: thread.privateStore.workflowRunId,
      currentRevision: thread.contextRevision,
      processedRevision: thread.processedRevision,
      sourceVersion: authoritative.sourceVersion,
      pgeVersion: authoritative.pgeVersion,
      technicalCoverageState: authoritative.technicalCoverageState,
      coverageLimitations: authoritative.coverageLimitations,
      partialCoveragePolicyDecision:
        authoritative.partialCoveragePolicyDecision ??
        thread.privateStore.partialCoveragePolicyDecision,
      publicState: publicState(thread.state),
      // Worker-only recovery input; never add this to the customer projection.
      confirmedContext:
        status === "DUPLICATE" &&
        input.contextRevision === thread.contextRevision
          ? thread.state.confirmedContext
          : undefined,
      privateRevision,
      priorAnswerHistory,
      priorAnswerHistoryOmittedCount,
      targetedNeed: target,
      guidanceVersion: thread.guidanceVersion ?? this.resolveGuidanceVersion(),
      workingStrategy: normalizeStrategy(thread.privateStore.workingStrategy),
    };
  }

  async registerTargetedNeedForWorker(input: {
    assessmentId: string;
    correlationId: string;
    target: TargetedNeedRegistrationInput;
  }): Promise<AssessmentInterviewRuntimeState> {
    const target = parseTargetedNeedRegistration(input.target);
    const initialThread = await this.readThread(input.assessmentId);
    if (this.isDuplicateTargetedNeed(initialThread.privateStore, target)) {
      return initialThread.state;
    }
    const initialProvenance = await this.assessmentProvenance(
      input.assessmentId,
    );
    this.validateTargetedNeedRegistrationContext({
      thread: initialThread,
      provenance: initialProvenance,
      target,
      correlationId: input.correlationId,
    });
    const targetResult = await this.runInterviewTransaction(async (tx) => {
      await this.lockInterviewThread(input.assessmentId, tx);
      const thread = await this.readThread(input.assessmentId, tx);
      if (this.isDuplicateTargetedNeed(thread.privateStore, target)) {
        return {
          state: thread.state,
          workflowRunId: target.workflowRunId,
          partialCoveragePolicyDecision:
            thread.privateStore.partialCoveragePolicyDecision,
          registered: false,
        };
      }
      this.validateTargetedNeedRegistrationContext({
        thread,
        provenance: initialProvenance,
        target,
        correlationId: input.correlationId,
      });
      const originatingRuleAnalysisReference = `rule:${target.engineeringRuleId}:${target.needId}`;
      const targetedNeed: TargetedInterviewNeed = {
        needId: target.needId,
        state: BUSINESS_CONTEXT_NEED_STATES.active,
        engineeringRuleId: target.engineeringRuleId,
        criterionId: target.criterionId,
        authoredConditionIndex: target.authoredConditionIndex,
        question: target.question,
        observation: target.observation,
        resolutionCriterionIds: target.resolutionCriterionIds,
        governedEvidenceRefs: target.evidenceRefs,
        contextRevision: target.contextRevision,
        originatingRuleAnalysisReference,
        sourceVersion: initialProvenance.sourceVersion,
        pgeVersion: initialProvenance.pgeVersion,
      };
      const targetedContinuation: TargetedInterviewContinuation = {
        originatingRuleAnalysisReference,
        needId: target.needId,
        engineeringRuleId: target.engineeringRuleId,
        criterionId: target.criterionId,
        resolutionCriterionIds: target.resolutionCriterionIds,
        contextRevision: target.contextRevision,
        workflowRunId: target.workflowRunId,
        checkpointId: target.checkpointId,
        artifactVersions: target.artifactVersions,
        sourceVersion: initialProvenance.sourceVersion,
        pgeVersion: initialProvenance.pgeVersion,
      };
      const nextState: AssessmentInterviewRuntimeState = {
        ...thread.state,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: undefined,
        orchestrationRequested: true,
      };
      const privateStore: PrivateInterviewStore = {
        ...thread.privateStore,
        targetedNeed,
        targetedContinuation,
        partialCoveragePolicyDecision:
          initialProvenance.partialCoveragePolicyDecision,
      };
      await this.persistThreadState(input.assessmentId, nextState, tx, {
        contextRevision: thread.contextRevision,
        activeQuestionId: null,
        processedRevision: thread.processedRevision,
        privateStore,
        sourceVersion: initialProvenance.sourceVersion,
        pgeVersion: initialProvenance.pgeVersion,
        guidanceVersion:
          thread.guidanceVersion ?? this.resolveGuidanceVersion(),
      });
      await this.outboxRepository.enqueue(
        this.interviewAgentResumeCommand({
          assessmentId: input.assessmentId,
          workflowRunId: target.workflowRunId,
          actorId: target.actorId,
          correlationId: input.correlationId,
          contextRevision: thread.contextRevision,
          questionId: target.needId,
          sourceVersion: initialProvenance.sourceVersion,
          pgeVersion: initialProvenance.pgeVersion,
          guidanceVersion:
            thread.guidanceVersion ?? this.resolveGuidanceVersion(),
          resumeReason: BUSINESS_CONTEXT_RESOLUTION_REQUIRED,
        }),
        tx,
      );
      await this.interviewAudit.recordTargetedClarification(
        {
          assessmentId: input.assessmentId,
          originatingRuleAnalysisReference:
            targetedNeed.originatingRuleAnalysisReference,
          interviewContextRevision: String(thread.contextRevision ?? 0),
          sessionId: this.threadId(input.assessmentId),
          threadId: this.threadId(input.assessmentId),
          runId: target.workflowRunId,
          stage: ASSESSMENT_INTERVIEW_MODES.businessContextResolution,
          sourceSnapshot: {
            snapshotId: initialProvenance.snapshotId,
            commitSha: initialProvenance.commitSha,
            sourceVersion: initialProvenance.sourceVersion,
            pgeVersion: initialProvenance.pgeVersion,
            technicalCoverageState: initialProvenance.technicalCoverageState,
            coverageLimitations: initialProvenance.coverageLimitations,
            partialCoveragePolicyDecision:
              initialProvenance.partialCoveragePolicyDecision,
            guidanceVersion:
              thread.guidanceVersion ?? this.resolveGuidanceVersion(),
          },
          correlationId: input.correlationId,
        },
        tx,
      );

      return {
        state: nextState,
        workflowRunId: target.workflowRunId,
        partialCoveragePolicyDecision:
          initialProvenance.partialCoveragePolicyDecision,
        registered: true,
      };
    });

    if (targetResult.registered) {
      try {
        await this.runtimeEvents.recordToolWaitingInput({
          assessmentId: input.assessmentId,
          runId: targetResult.workflowRunId,
          correlationId: input.correlationId,
          stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
          toolName: INTERVIEW_TOOL_NAME,
          summary:
            "Business-context Interview has started and is waiting for Customer context.",
          outputSummary: {
            assessmentInterview: publicState(targetResult.state),
            interviewWorkflowEvent:
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewStarted,
            orchestratorAction:
              ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.waitForCustomer,
            interviewMode: ASSESSMENT_INTERVIEW_MODES.businessContextResolution,
            partialCoveragePolicyDecision:
              targetResult.partialCoveragePolicyDecision ?? null,
          },
          waitingReason: ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewStarted,
          startedAt: new Date(),
        });
      } catch (error) {
        this.logger.warn(
          `Targeted Interview runtime event failed after commit: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return targetResult.state;
  }

  private validateTargetedNeedRegistrationContext(input: {
    thread: InterviewThreadSnapshot;
    provenance: AssessmentProvenanceSnapshot;
    target: TargetedNeedRegistrationInput;
    correlationId: string;
  }): void {
    if (
      input.thread.state.outcome !==
        ASSESSMENT_INTERVIEW_OUTCOMES.contextReady &&
      input.thread.state.outcome !==
        ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved
    ) {
      throw problemException(
        "INTERVIEW_TARGETED_NEED_REQUIRES_READY_CONTEXT",
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    this.assertInitialInterviewCoverageUsable(
      input.provenance.technicalCoverageState,
      input.provenance.coverageLimitations,
      input.provenance.partialCoveragePolicyDecision,
      input.correlationId,
    );
    if (
      !input.thread.sourceVersion ||
      !input.thread.pgeVersion ||
      input.thread.sourceVersion !== input.provenance.sourceVersion ||
      input.thread.pgeVersion !== input.provenance.pgeVersion
    ) {
      throw problemException(
        "INTERVIEW_TARGETED_REGISTRATION_STALE_PROVENANCE",
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    if (input.target.contextRevision < (input.thread.contextRevision ?? 0)) {
      throw problemException(
        "INTERVIEW_TARGETED_REGISTRATION_STALE_CONTEXT_REVISION",
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const authoritativeRefs = new Set(input.provenance.governedEvidenceRefs);
    for (const ref of input.target.evidenceRefs) {
      if (!authoritativeRefs.has(ref)) {
        throw problemException(
          "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED",
          input.correlationId,
          { status: HttpStatus.BAD_REQUEST, meta: { unauthorizedRef: ref } },
        );
      }
    }
  }

  private isDuplicateTargetedNeed(
    privateStore: PrivateInterviewStore,
    target: TargetedNeedRegistrationInput,
  ): boolean {
    const need = privateStore.targetedNeed;
    const continuation = privateStore.targetedContinuation;
    return (
      need?.needId === target.needId &&
      need.engineeringRuleId === target.engineeringRuleId &&
      need.criterionId === target.criterionId &&
      need.contextRevision === target.contextRevision &&
      continuation?.workflowRunId === target.workflowRunId
    );
  }

  private async lockInitialInterviewSeed(
    assessmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // Serialize first materialization even when no thread row exists yet, then
    // lock an existing row so a delayed retry cannot race a Customer answer.
    const lockKey = `lcsp:assessment-interview-initial-seed:${assessmentId}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
    `;
    await this.lockInterviewThread(assessmentId, tx);
  }

  private async lockInterviewThread(
    assessmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM "AssessmentInterviewThread"
      WHERE "assessmentId" = ${assessmentId}
      FOR UPDATE
    `;
  }

  async getWorkerStateForWorker(
    assessmentId: string,
  ): Promise<AssessmentInterviewRuntimeState> {
    return (await this.readThread(assessmentId)).state;
  }

  async recordAgentDecision(input: {
    assessmentId: string;
    correlationId: string;
    decision: AgentDecisionInput;
  }): Promise<
    AssessmentInterviewRuntimeState & {
      continuation?: TargetedInterviewContinuation;
    }
  > {
    const decision = parseAgentDecision(input.decision);
    const authoritative = await this.assessmentProvenance(input.assessmentId);
    const result = await this.runInterviewTransaction(async (tx) => {
      const thread = await this.readThread(input.assessmentId, tx);
      if (decision.expectedContextRevision !== thread.contextRevision) {
        throw problemException(
          "INTERVIEW_DECISION_STALE_REVISION",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const latestPrivate = thread.privateRevisions.find(
        (revision) =>
          revision.contextRevision === decision.expectedContextRevision,
      );
      this.assertInitialInterviewCoverageUsable(
        authoritative.technicalCoverageState,
        authoritative.coverageLimitations,
        authoritative.partialCoveragePolicyDecision,
        input.correlationId,
      );
      if (
        thread.sourceVersion !== authoritative.sourceVersion ||
        thread.pgeVersion !== authoritative.pgeVersion ||
        (!!latestPrivate &&
          (latestPrivate.sourceVersion !== authoritative.sourceVersion ||
            latestPrivate.pgeVersion !== authoritative.pgeVersion))
      ) {
        throw problemException(
          "INTERVIEW_DECISION_STALE_PROVENANCE",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const authorizedRefs = new Set([
        ...authoritative.governedEvidenceRefs,
        ...(latestPrivate?.governedEvidenceRefs ?? []),
        ...(thread.privateStore.targetedNeed?.governedEvidenceRefs ?? []),
      ]);

      const isBlockedFollowup =
        thread.state.outcome ===
          ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved &&
        decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
      const isTargetedBootstrap =
        decision.mode ===
          ASSESSMENT_INTERVIEW_MODES.businessContextResolution &&
        decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
        thread.state.outcome ===
          ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
        !thread.activeQuestionId &&
        !!activeBusinessContextNeed(thread.privateStore);
      assertGuardedDecision(
        decision,
        latestPrivate,
        thread,
        input.correlationId,
        {
          isBlockedFollowup,
          isTargetedBootstrap,
        },
      );
      const transition = orchestratorInterviewTransition(
        decision,
        thread.privateStore,
        input.correlationId,
      );

      // Materialize authoritative confirmed context after guarded transition
      // checks. Model output supplies semantic facts only; runtime owns actor,
      // assessment, timestamp, source, resolution and evidence membership.
      if (isAuthoritative(decision.contextAuthority)) {
        if (!latestPrivate) {
          throw problemException(
            "INTERVIEW_AUTHORITATIVE_CONTEXT_REQUIRES_CUSTOMER_REVISION",
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        if (!decision.confirmedContext) {
          throw problemException(
            "INTERVIEW_CONFIRMED_CONTEXT_INVALID",
            input.correlationId,
            { status: HttpStatus.BAD_REQUEST },
          );
        }
        decision.confirmedContext =
          materializeConfirmedStructuredBusinessContext(
            decision.confirmedContext,
            authorizedRefs,
            input.assessmentId,
            latestPrivate,
            input.correlationId,
            {
              need: activeBusinessContextNeed(thread.privateStore),
              previousStatements: thread.state.confirmedContext?.statements,
            },
          );
        assertInitialPlanningContextReady(
          decision,
          transition.mode,
          input.correlationId,
        );
      }

      if (decision.activeQuestion) {
        decision.activeQuestion = parsePersistableInterviewQuestion(
          decision.activeQuestion,
          decision.outcome,
          authorizedRefs,
          input.correlationId,
        );
      }

      const state = decisionState(thread.state, decision);
      const revisions = thread.privateRevisions.map((revision) =>
        revision.contextRevision === decision.expectedContextRevision
          ? {
              ...revision,
              authority: decision.contextAuthority ?? revision.authority,
              processedAt: new Date().toISOString(),
            }
          : revision,
      );
      const updated = await tx.assessmentInterviewThread.updateMany({
        where: {
          assessmentId: input.assessmentId,
          contextRevision: decision.expectedContextRevision,
          activeQuestionId: thread.activeQuestionId,
          processedRevision:
            isBlockedFollowup || isTargetedBootstrap
              ? thread.processedRevision
              : { lt: decision.expectedContextRevision },
        },
        data: {
          stateJson: toJson(state),
          contextRevision: thread.contextRevision,
          activeQuestionId: state.activeQuestion?.id ?? null,
          processedRevision: decision.expectedContextRevision,
          privateContextJson: toJson({
            ...thread.privateStore,
            revisions,
            // A resolved decision settles the active need; it stays as provenance.
            targetedNeed:
              thread.privateStore.targetedNeed &&
              state.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved
                ? {
                    ...thread.privateStore.targetedNeed,
                    state: BUSINESS_CONTEXT_NEED_STATES.resolved,
                  }
                : thread.privateStore.targetedNeed,
          }),
        },
      });
      if (updated.count !== 1) {
        throw problemException(
          "INTERVIEW_DECISION_ALREADY_PROCESSED",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await this.interviewAudit.recordInterviewOutcome(
        {
          assessmentId: input.assessmentId,
          outcome: state.outcome,
          activeQuestionId: state.activeQuestion?.id,
          contextRevision: decision.expectedContextRevision,
          sessionId: this.threadId(input.assessmentId),
          threadId: this.threadId(input.assessmentId),
          guidanceVersion:
            thread.guidanceVersion ?? this.resolveGuidanceVersion(),
          correlationId: input.correlationId,
        },
        tx,
      );

      if (state.activeQuestion) {
        await this.interviewAudit.recordQuestionPersisted(
          {
            assessmentId: input.assessmentId,
            questionId: state.activeQuestion.id,
            questionIntent: state.activeQuestion.intent,
            prompt: state.activeQuestion.prompt,
            control: state.activeQuestion.control,
            choices: state.activeQuestion.choices,
            whyEvidenceRefs: state.activeQuestion.whyEvidenceRefs,
            sessionId: this.threadId(input.assessmentId),
            threadId: this.threadId(input.assessmentId),
            turnId: decision.expectedContextRevision,
            sourceSnapshot: {
              snapshotId: authoritative.snapshotId,
              commitSha: authoritative.commitSha,
              sourceVersion: authoritative.sourceVersion,
              pgeVersion: authoritative.pgeVersion,
              technicalCoverageState: authoritative.technicalCoverageState,
              coverageLimitations: authoritative.coverageLimitations,
              partialCoveragePolicyDecision:
                authoritative.partialCoveragePolicyDecision,
              guidanceVersion:
                thread.guidanceVersion ?? this.resolveGuidanceVersion(),
            },
            correlationId: input.correlationId,
          },
          tx,
        );
      }

      if (
        decision.flags?.includes(ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact)
      ) {
        await this.interviewAudit.recordDownstreamImpact(
          {
            assessmentId: input.assessmentId,
            interviewContextRevision: String(decision.expectedContextRevision),
            summary: "Context changes impact downstream evaluation.",
            sessionId: this.threadId(input.assessmentId),
            threadId: this.threadId(input.assessmentId),
            runId: `run:${input.assessmentId}:${decision.expectedContextRevision}`,
            sourceSnapshot: {
              snapshotId: authoritative.snapshotId,
              commitSha: authoritative.commitSha,
              sourceVersion: authoritative.sourceVersion,
              pgeVersion: authoritative.pgeVersion,
              technicalCoverageState: authoritative.technicalCoverageState,
              coverageLimitations: authoritative.coverageLimitations,
              partialCoveragePolicyDecision:
                authoritative.partialCoveragePolicyDecision,
              guidanceVersion:
                thread.guidanceVersion ?? this.resolveGuidanceVersion(),
            },
            correlationId: input.correlationId,
          },
          tx,
        );
      }

      return {
        state,
        transition,
        workflowRunId:
          thread.privateStore.targetedContinuation?.workflowRunId ??
          thread.privateStore.workflowRunId ??
          this.threadId(input.assessmentId),
        partialCoveragePolicyDecision:
          authoritative.partialCoveragePolicyDecision ??
          thread.privateStore.partialCoveragePolicyDecision,
        continuation:
          transition.exactResumeAllowed &&
          transition.action ===
            ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.resumeSameRule
            ? thread.privateStore.targetedContinuation
            : undefined,
      };
    });

    await this.recordTransitionWorkflowEvent({
      assessmentId: input.assessmentId,
      runId: result.workflowRunId,
      correlationId: input.correlationId,
      transition: result.transition,
      state: result.state,
      partialCoveragePolicyDecision: result.partialCoveragePolicyDecision,
    });

    await this.runtimeEvents.recordToolCompleted({
      assessmentId: input.assessmentId,
      runId: result.workflowRunId,
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary: "Interview decision persisted.",
      outputSummary: {
        interviewProgress: {
          contextRevision: result.state.contextRevision,
          phase: INTERVIEW_PROGRESS_PHASES.completed,
        },
      },
    });

    return result.continuation
      ? { ...result.state, continuation: result.continuation }
      : result.state;
  }

  async seedInitialQuestionForWorker(input: {
    assessmentId: string;
    correlationId: string;
    state: AssessmentInterviewRuntimeState;
    technicalEvidenceReportId?: string;
    workflowRunId?: string;
  }): Promise<AssessmentInterviewRuntimeState> {
    const workflowRunId =
      typeof input.workflowRunId === "string" && input.workflowRunId.trim()
        ? input.workflowRunId.trim()
        : randomUUID();
    const rawState = objectRecord(input.state);
    if (
      !rawState ||
      rawState.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer ||
      !objectRecord(rawState.activeQuestion)
    ) {
      throw problemException(
        "INTERVIEW_INITIAL_QUESTION_INVALID",
        input.correlationId,
        {
          status: HttpStatus.BAD_REQUEST,
        },
      );
    }
    const expectedContextRevision = rawState.expectedContextRevision ?? 0;
    if (
      typeof expectedContextRevision !== "number" ||
      !Number.isInteger(expectedContextRevision) ||
      expectedContextRevision !== 0 ||
      (rawState.contextRevision !== undefined &&
        (typeof rawState.contextRevision !== "number" ||
          !Number.isInteger(rawState.contextRevision) ||
          rawState.contextRevision !== 0))
    ) {
      throw problemException(
        "INTERVIEW_INITIAL_SEED_STALE",
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const provenance = await this.assessmentProvenance(
      input.assessmentId,
      input.technicalEvidenceReportId,
    );
    const seedResult = await this.runInterviewTransaction(async (tx) => {
      await this.lockInitialInterviewSeed(input.assessmentId, tx);
      const existing = await this.readThread(input.assessmentId, tx);
      const guidanceVersion =
        existing.guidanceVersion ?? this.resolveGuidanceVersion();
      this.assertInitialInterviewCoverageUsable(
        provenance.technicalCoverageState,
        provenance.coverageLimitations,
        provenance.partialCoveragePolicyDecision,
        input.correlationId,
      );
      const authorizedRefs = new Set(provenance.governedEvidenceRefs);
      const validatedQuestion = parsePersistableInterviewQuestion(
        rawState.activeQuestion,
        rawState.outcome as string,
        authorizedRefs,
        input.correlationId,
      );
      if (!validatedQuestion) {
        throw problemException(
          "INTERVIEW_INITIAL_QUESTION_INVALID",
          input.correlationId,
          { status: HttpStatus.BAD_REQUEST },
        );
      }
      const activeQuestionId = validatedQuestion.id;
      const state: AssessmentInterviewRuntimeState = {
        ...(rawState as unknown as AssessmentInterviewRuntimeState),
        activeQuestion: validatedQuestion,
      };

      const computedState: AssessmentInterviewRuntimeState = {
        ...state,
        threadId: this.threadId(input.assessmentId),
        contextRevision: 0,
        orchestrationRequested: false,
      };

      const unprogressedSeed =
        existing.contextRevision === 0 &&
        existing.processedRevision === 0 &&
        existing.privateRevisions.length === 0 &&
        (existing.state.answerHistory?.length ?? 0) === 0 &&
        existing.state.outcome ===
          ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
        existing.activeQuestionId === activeQuestionId &&
        stableJson(existing.state.activeQuestion ?? null) ===
          stableJson(validatedQuestion) &&
        existing.sourceVersion === provenance.sourceVersion &&
        existing.pgeVersion === provenance.pgeVersion &&
        existing.privateStore.workflowRunId === workflowRunId &&
        stableJson(
          existing.privateStore.partialCoveragePolicyDecision ?? null,
        ) === stableJson(provenance.partialCoveragePolicyDecision ?? null);

      const exactReplay =
        existing.exists &&
        unprogressedSeed &&
        existing.guidanceVersion === guidanceVersion;
      if (exactReplay) {
        return {
          state: existing.state,
          partialCoveragePolicyDecision:
            existing.privateStore.partialCoveragePolicyDecision,
          idempotentReplay: true,
        };
      }

      const legacyGuidanceBackfill =
        existing.exists &&
        unprogressedSeed &&
        existing.guidanceVersion === null;
      if (existing.exists && !legacyGuidanceBackfill) {
        // Initial seeding is monotonic. Once a materialized thread diverges from
        // the exact revision-0 seed (including any Customer advancement), a
        // delayed worker retry must never reset question/revision/provenance.
        throw problemException(
          "INTERVIEW_INITIAL_SEED_STALE",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await this.persistThreadState(input.assessmentId, computedState, tx, {
        contextRevision: computedState.contextRevision ?? 0,
        activeQuestionId,
        processedRevision: 0,
        privateStore: {
          ...existing.privateStore,
          workflowRunId,
          partialCoveragePolicyDecision:
            provenance.partialCoveragePolicyDecision,
          workingStrategy: normalizeStrategy(
            existing.privateStore.workingStrategy,
          ),
        },
        sourceVersion: provenance.sourceVersion,
        pgeVersion: provenance.pgeVersion,
        guidanceVersion,
      });

      if (state.activeQuestion) {
        await this.interviewAudit.recordQuestionPersisted(
          {
            assessmentId: input.assessmentId,
            questionId: activeQuestionId,
            questionIntent: state.activeQuestion.intent,
            prompt: state.activeQuestion.prompt,
            control: state.activeQuestion.control,
            choices: state.activeQuestion.choices,
            whyEvidenceRefs: state.activeQuestion.whyEvidenceRefs,
            sessionId: this.threadId(input.assessmentId),
            threadId: this.threadId(input.assessmentId),
            turnId: 0,
            sourceSnapshot: {
              snapshotId: provenance.snapshotId,
              commitSha: provenance.commitSha,
              sourceVersion: provenance.sourceVersion,
              pgeVersion: provenance.pgeVersion,
              technicalCoverageState: provenance.technicalCoverageState,
              coverageLimitations: provenance.coverageLimitations,
              partialCoveragePolicyDecision:
                provenance.partialCoveragePolicyDecision,
              guidanceVersion,
            },
            correlationId: input.correlationId,
          },
          tx,
        );
      }

      await this.runtimeEvents.recordToolWaitingInput(
        {
          assessmentId: input.assessmentId,
          runId: workflowRunId,
          correlationId: input.correlationId,
          stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
          toolName: INTERVIEW_TOOL_NAME,
          summary: "Interview Agent question is waiting for Customer response.",
          outputSummary: {
            assessmentInterview: publicState(computedState),
            interviewWorkflowEvent:
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewStarted,
            orchestratorAction:
              ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.waitForCustomer,
            interviewMode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
            partialCoveragePolicyDecision:
              provenance.partialCoveragePolicyDecision ?? null,
          },
          waitingReason: ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewStarted,
          startedAt: new Date(),
        },
        tx,
      );

      return {
        state: computedState,
        partialCoveragePolicyDecision: provenance.partialCoveragePolicyDecision,
        idempotentReplay: false,
      };
    });

    return seedResult.state;
  }

  private async recordTransitionWorkflowEvent(input: {
    assessmentId: string;
    runId: string;
    correlationId: string;
    transition: OrchestratorInterviewTransition;
    state: AssessmentInterviewRuntimeState;
    partialCoveragePolicyDecision?: PartialCoveragePolicyDecision;
  }): Promise<void> {
    const payload = {
      assessmentInterview: runtimeEventState(input.state),
      interviewWorkflowEvent: input.transition.workflowEvent,
      interviewWorkflowEvents: interviewWorkflowEventsForTransition(
        input.transition,
      ),
      orchestratorAction: input.transition.action,
      interviewMode: input.transition.mode,
      partialCoveragePolicyDecision:
        input.partialCoveragePolicyDecision ?? null,
    };
    const base = {
      assessmentId: input.assessmentId,
      runId: input.runId,
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      inputSummary: { decisionOutcome: input.state.outcome },
      outputSummary: payload,
      startedAt: new Date(),
    };

    if (
      input.transition.action ===
      ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.waitForCustomer
    ) {
      await this.runtimeEvents.recordToolWaitingInput({
        ...base,
        summary:
          "Interview Agent guarded decision persisted; Interview is waiting for Customer response.",
        waitingReason: input.transition.workflowEvent,
      });
      return;
    }

    if (
      input.transition.action ===
      ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.keepBusinessContextBlocked
    ) {
      await this.runtimeEvents.recordToolWaitingInput({
        ...base,
        summary: "Interview business context remains blocked or unresolved.",
        waitingReason: input.transition.workflowEvent,
      });
      return;
    }

    if (
      input.transition.action ===
      ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.routeRuntimeRecovery
    ) {
      await this.runtimeEvents.recordToolFailed({
        ...base,
        summary:
          "Interview runtime failed and requires orchestration recovery.",
        errorSummary: input.transition.workflowEvent,
      });
      return;
    }

    await this.runtimeEvents.recordToolCompleted({
      ...base,
      summary:
        input.transition.action ===
        ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.resumeSameRule
          ? "Targeted Interview context resolved; exact rule resume is authorized."
          : input.transition.action ===
              ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.selectiveRerunRescope
            ? "Targeted Interview context resolved; downstream re-evaluation rescope is required."
            : "Initial Interview context is ready for engineering rule evaluation.",
      waitingReason: null,
    });
  }

  private assertInitialInterviewCoverageUsable(
    technicalCoverageState: InterviewTechnicalCoverageState,
    coverageLimitations: string[],
    partialCoveragePolicyDecision: PartialCoveragePolicyDecision | undefined,
    correlationId: string,
  ): void {
    if (
      technicalCoverageState === INTERVIEW_TECHNICAL_COVERAGE_STATES.unavailable
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.interviewTechnicalCoverageUnusable,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    if (
      technicalCoverageState !== INTERVIEW_TECHNICAL_COVERAGE_STATES.partial
    ) {
      return;
    }

    if (
      !partialCoveragePolicyDecision ||
      partialCoveragePolicyDecision.permittedForInterview !== true ||
      !partialCoveragePolicyDecision.policyDecisionRef.trim() ||
      !partialCoveragePolicyDecision.policyVersion.trim() ||
      partialCoveragePolicyDecision.limitations.length === 0 ||
      coverageLimitations.length === 0
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.interviewPartialCoverageLimitationsRequired,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
  }

  async assertAssessmentVisible(
    assessmentId: string,
    actor: RbacRequestContext,
  ): Promise<void> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, ownerId: true },
    });
    if (!assessment) {
      throw new NotFoundException({ code: ASSESSMENT_ERROR_CODES.notFound });
    }
    if (
      actor.role === AUTH_USER_ROLES.customer &&
      assessment.ownerId !== actor.userId
    ) {
      throw new NotFoundException({ code: ASSESSMENT_ERROR_CODES.notFound });
    }
  }

  private async readThread(
    assessmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<InterviewThreadSnapshot> {
    const client = tx ?? this.prisma;
    const thread = await client.assessmentInterviewThread.findUnique({
      where: { assessmentId },
    });
    const fallbackState: AssessmentInterviewRuntimeState = {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      threadId: this.threadId(assessmentId),
      contextRevision: 0,
      answerHistory: [],
    };
    if (!thread) {
      const privateStore: PrivateInterviewStore = { revisions: [] };
      return {
        exists: false,
        state: fallbackState,
        privateStore,
        privateRevisions: privateStore.revisions,
        contextRevision: 0,
        activeQuestionId: null,
        processedRevision: 0,
        sourceVersion: null,
        pgeVersion: null,
        guidanceVersion: null,
      };
    }
    const state = parseStoredInterviewState(thread.stateJson) ?? fallbackState;
    const privateStore = parsePrivateStore(thread.privateContextJson);
    return {
      exists: true,
      state,
      privateStore,
      privateRevisions: privateStore.revisions,
      contextRevision: thread.contextRevision,
      activeQuestionId: thread.activeQuestionId,
      processedRevision: thread.processedRevision,
      sourceVersion: thread.sourceVersion,
      pgeVersion: thread.pgeVersion,
      guidanceVersion: thread.guidanceVersion,
    };
  }

  private async persistThreadState(
    assessmentId: string,
    state: AssessmentInterviewRuntimeState,
    tx?: Prisma.TransactionClient,
    input?: {
      contextRevision: number;
      activeQuestionId: string | null;
      processedRevision: number;
      privateStore: PrivateInterviewStore;
      sourceVersion: string;
      pgeVersion: string;
      guidanceVersion: string;
    },
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.assessmentInterviewThread.upsert({
      where: { assessmentId },
      update: {
        stateJson: toJson(state),
        ...(input
          ? {
              privateContextJson: toJson(input.privateStore),
              contextRevision: input.contextRevision,
              activeQuestionId: input.activeQuestionId,
              processedRevision: input.processedRevision,
              sourceVersion: input.sourceVersion,
              pgeVersion: input.pgeVersion,
              guidanceVersion: input.guidanceVersion,
            }
          : {}),
      },
      create: {
        id: this.threadId(assessmentId),
        assessmentId,
        stateJson: toJson(state),
        privateContextJson: toJson(input?.privateStore ?? { revisions: [] }),
        contextRevision: input?.contextRevision ?? state.contextRevision ?? 0,
        activeQuestionId: input?.activeQuestionId ?? state.activeQuestion?.id,
        processedRevision: input?.processedRevision ?? 0,
        sourceVersion: input?.sourceVersion,
        pgeVersion: input?.pgeVersion,
        guidanceVersion:
          input?.guidanceVersion ?? this.resolveGuidanceVersion(),
      },
    });
  }

  private interviewAgentResumeCommand(input: {
    assessmentId: string;
    workflowRunId: string;
    actorId: string;
    actorType?: AuditActorType;
    correlationId: string;
    contextRevision: number;
    questionId: string;
    sourceVersion: string;
    pgeVersion: string;
    guidanceVersion: string;
    resumeReason: string;
    // Customer resume attempt; distinct outbox key so the retry is not deduplicated.
    resumeAttempt?: number;
  }) {
    const attemptSuffix = input.resumeAttempt
      ? `:resume-${input.resumeAttempt}`
      : "";
    return buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      aggregateId: input.assessmentId,
      eventType: ASSESSMENT_EVENT_TYPES.interviewAgentResumeRequestedOutbox,
      assessmentId: input.assessmentId,
      correlationId: input.correlationId,
      causationId: input.correlationId,
      actor: {
        id: input.actorId,
        type: input.actorType ?? AUDIT_ACTOR_TYPES.user,
      },
      result: ASSESSMENT_EVENT_TYPES.interviewAnswerSubmitted,
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      idempotencyKey: `${input.assessmentId}:${input.contextRevision}:${input.resumeReason}:${input.questionId}:${ASSESSMENT_EVENT_TYPES.interviewAgentResumeRequestedOutbox}${attemptSuffix}`,
      payload: {
        assessmentId: input.assessmentId,
        threadId: this.threadId(input.assessmentId),
        workflowRunId: input.workflowRunId,
        contextRevision: input.contextRevision,
        questionId: input.questionId,
        sourceVersion: input.sourceVersion,
        pgeVersion: input.pgeVersion,
        guidanceVersion: input.guidanceVersion,
        resumeReason: input.resumeReason,
      },
    });
  }

  private auditRef(
    assessmentId: string,
    actorId: string,
    correlationId: string,
    input: {
      contextRevision: number;
      priorRevision?: number;
      newRevision?: number;
      relatedQuestionId?: string;
      provenance: {
        sourceVersion: string;
        pgeVersion: string;
        governedEvidenceRefs: string[];
        guidanceVersion?: string;
      };
    },
  ) {
    return {
      authenticatedActorId: actorId,
      timestamp: new Date().toISOString(),
      assessmentId,
      sourceVersion: input.provenance.sourceVersion,
      pgeVersion: input.provenance.pgeVersion,
      guidanceVersion: input.provenance.guidanceVersion,
      sessionId: this.threadId(assessmentId),
      turnId: correlationId,
      governedEvidenceRefs: input.provenance.governedEvidenceRefs,
      contextRevision: input.contextRevision,
      priorRevision: input.priorRevision,
      newRevision: input.newRevision,
      relatedQuestionId: input.relatedQuestionId,
    };
  }

  /**
   * Scanner-backed provenance plus the canonical `source:` refs accepted into the
   * EngineeringRuleAssessment ledger. Ledger refs are read fresh (never cached) so a
   * ref accepted seconds ago is immediately authorized for need registration; an
   * empty or missing Scanner evidence_graph is tolerated.
   */
  private async assessmentProvenance(
    assessmentId: string,
    technicalEvidenceReportId?: string,
  ): Promise<AssessmentProvenanceSnapshot> {
    const base = await this.scannerProvenance(
      assessmentId,
      technicalEvidenceReportId,
    );
    const ledgerRefs = await this.acceptedRuleEvidenceRefs(assessmentId);
    return ledgerRefs.length === 0
      ? base
      : {
          ...base,
          governedEvidenceRefs: Array.from(
            new Set([...base.governedEvidenceRefs, ...ledgerRefs]),
          ),
        };
  }

  private async acceptedRuleEvidenceRefs(
    assessmentId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.engineeringRuleAssessment.findMany({
      where: { assessmentId },
      select: { criteria: true },
    });
    const refs = new Set<string>();
    for (const row of rows) {
      if (!Array.isArray(row.criteria)) continue;
      for (const criterion of row.criteria) {
        const items = objectRecord(criterion)?.evidenceRefs;
        if (!Array.isArray(items)) continue;
        for (const ref of items) {
          if (typeof ref === "string" && ref.length > 0) refs.add(ref);
        }
      }
    }
    return [...refs];
  }

  private async scannerProvenance(
    assessmentId: string,
    technicalEvidenceReportId?: string,
  ): Promise<AssessmentProvenanceSnapshot> {
    const cacheKey = `${assessmentId}:${technicalEvidenceReportId ?? "latest"}`;
    const cached = this.provenanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const client = this.prisma;
    const report = await client.technicalEvidenceReport.findFirst({
      where: technicalEvidenceReportId
        ? {
            assessmentId,
            id: technicalEvidenceReportId,
            status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
          }
        : {
            assessmentId,
            status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
          },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        schemaVersion: true,
        evidencePayload: true,
        snapshotId: true,
        snapshot: { select: { id: true, commitSha: true } },
      },
    });
    const snapshot = report?.snapshot
      ? report.snapshot
      : await client.repositorySnapshot.findFirst({
          where: { assessmentId },
          orderBy: { createdAt: "desc" },
          select: { id: true, commitSha: true },
        });
    const evidencePayload = objectRecord(report?.evidencePayload);
    const evidenceGraph = objectRecord(
      evidencePayload?.evidence_graph ??
        evidencePayload?.evidenceGraph ??
        evidencePayload?.programEvidenceGraph ??
        evidencePayload?.program_evidence_graph,
    );
    const technicalCoverageState: InterviewTechnicalCoverageState =
      readTechnicalCoverageState(
        evidenceGraph?.coverage_state ??
          evidenceGraph?.coverageState ??
          evidencePayload?.technicalCoverageState ??
          evidencePayload?.coverageState,
      ) ??
      (report
        ? INTERVIEW_TECHNICAL_COVERAGE_STATES.unavailable
        : INTERVIEW_TECHNICAL_COVERAGE_STATES.unavailable);
    const partialCoveragePolicyDecision = parsePartialCoveragePolicyDecision(
      evidenceGraph?.partialCoveragePolicyDecision ??
        evidenceGraph?.partial_coverage_policy_decision ??
        evidencePayload?.partialCoveragePolicyDecision ??
        evidencePayload?.partial_coverage_policy_decision ??
        evidencePayload?.coveragePolicyDecision ??
        evidencePayload?.coverage_policy_decision,
    );
    const graphCoverageNotes =
      evidenceGraph?.coverage_notes ?? evidenceGraph?.coverageNotes;
    const rawCoverageLimitations = Array.isArray(graphCoverageNotes)
      ? graphCoverageNotes.filter(
          (item): item is string => typeof item === "string",
        )
      : Array.isArray(evidencePayload?.coverageLimitations)
        ? evidencePayload.coverageLimitations.filter(
            (item): item is string => typeof item === "string",
          )
        : Array.isArray(evidencePayload?.limitations)
          ? evidencePayload.limitations.filter(
              (item): item is string => typeof item === "string",
            )
          : [];
    const coverageLimitations =
      technicalCoverageState === INTERVIEW_TECHNICAL_COVERAGE_STATES.partial &&
      partialCoveragePolicyDecision
        ? partialCoveragePolicyDecision.limitations
        : rawCoverageLimitations;

    const rawGraphRefs =
      evidenceGraph?.evidence_refs ?? evidenceGraph?.evidenceRefs;
    const graphRefs: string[] = Array.isArray(rawGraphRefs)
      ? rawGraphRefs.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];

    const rawNodes = evidenceGraph?.nodes;
    const nodeRefs: string[] = Array.isArray(rawNodes)
      ? rawNodes.flatMap((node) => {
          const rec = objectRecord(node);
          const refs = rec?.evidence_refs ?? rec?.evidenceRefs;
          return Array.isArray(refs)
            ? refs.filter(
                (item): item is string =>
                  typeof item === "string" && item.trim().length > 0,
              )
            : [];
        })
      : [];

    const rawEdges = evidenceGraph?.edges;
    const edgeRefs: string[] = Array.isArray(rawEdges)
      ? rawEdges.flatMap((edge) => {
          const rec = objectRecord(edge);
          const refs = rec?.evidence_refs ?? rec?.evidenceRefs;
          return Array.isArray(refs)
            ? refs.filter(
                (item): item is string =>
                  typeof item === "string" && item.trim().length > 0,
              )
            : [];
        })
      : [];

    const rawPayloadRefs =
      evidencePayload?.evidence_refs ?? evidencePayload?.evidenceRefs;
    const payloadRefs: string[] = Array.isArray(rawPayloadRefs)
      ? rawPayloadRefs.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];

    const provenance: AssessmentProvenanceSnapshot = {
      snapshotId: snapshot?.id,
      commitSha: snapshot?.commitSha,
      sourceVersion: snapshot
        ? `${snapshot.id}:${snapshot.commitSha}`
        : MISSING_SOURCE_VERSION,
      pgeVersion: report
        ? `${report.id}:${report.schemaVersion}`
        : MISSING_PGE_VERSION,
      technicalCoverageState,
      coverageLimitations,
      partialCoveragePolicyDecision,
      governedEvidenceRefs: Array.from(
        new Set([
          ...(snapshot ? [`repositorySnapshot:${snapshot.id}`] : []),
          ...(report ? [`technicalEvidenceReport:${report.id}`] : []),
          `interviewRuntime:${INTERVIEW_SOURCE_VERSION}`,
          ...graphRefs,
          ...nodeRefs,
          ...edgeRefs,
          ...payloadRefs,
        ]),
      ),
    };

    // Only report-backed snapshots are cached: an accepted evidence report and
    // its snapshot are immutable, so a positive snapshot can never go stale in a
    // dangerous direction. A "no report yet" snapshot must never be cached, or a
    // newly accepted report would be masked until the TTL expires.
    if (report) {
      this.provenanceCache.set(cacheKey, {
        value: provenance,
        expiresAt: Date.now() + PROVENANCE_CACHE_TTL_MS,
      });
      while (this.provenanceCache.size > PROVENANCE_CACHE_MAX_ENTRIES) {
        const oldestKey: string | undefined = this.provenanceCache.keys().next()
          .value as string | undefined;
        if (oldestKey === undefined) {
          break;
        }
        this.provenanceCache.delete(oldestKey);
      }
    }

    return provenance;
  }

  private threadId(assessmentId: string): string {
    return `interview:${assessmentId}`;
  }

  private resolveGuidanceVersion(): string {
    return this.guidanceResolver.resolveActiveGuidanceVersion();
  }

  /**
   * Runs one interview-thread transaction with an explicit timeout budget and
   * bounded retries for transient infrastructure failures (expired interactive
   * transactions, write conflicts). Every caller is idempotent under retry via
   * in-transaction duplicate guards and deterministic outbox identifiers, so a
   * replay after rollback can never duplicate targeted needs, questions,
   * runtime events, or outbox messages.
   */
  private async runInterviewTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          timeout: INTERVIEW_TRANSACTION_TIMEOUT_MS,
          maxWait: INTERVIEW_TRANSACTION_MAX_WAIT_MS,
        });
      } catch (error) {
        if (
          attempt >= INTERVIEW_TRANSACTION_RETRY_ATTEMPTS ||
          !isTransientInterviewTransactionError(error)
        ) {
          throw error;
        }
        this.logger.warn(
          `Interview transaction rolled back on a transient error; retrying (attempt ${
            attempt + 1
          }/${INTERVIEW_TRANSACTION_RETRY_ATTEMPTS}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            INTERVIEW_TRANSACTION_RETRY_DELAY_MS * (attempt + 1),
          ),
        );
      }
    }
  }
}

function isTransientInterviewTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2024" || error.code === "P2034";
  }
  return (
    error instanceof Error && error.message.includes("expired transaction")
  );
}

function parseSubmitAnswerCommand(
  value: unknown,
  routeAssessmentId: string,
): {
  answer: AssessmentInterviewAnswerInput;
  sessionId: string;
  expectedSessionRevision: number;
  clientRequestId: string;
} {
  const record = objectRecord(value);
  if (!record || !objectRecord(record.answer)) {
    throw new BadRequestException({ code: "INTERVIEW_SUBMIT_COMMAND_INVALID" });
  }
  if (
    record.contractVersion !== INTERVIEW_TECHNICAL_CONTRACT_VERSION ||
    record.assessmentId !== routeAssessmentId ||
    typeof record.sessionId !== "string" ||
    !record.sessionId.trim() ||
    typeof record.questionRef !== "string" ||
    !record.questionRef.trim() ||
    typeof record.expectedSessionRevision !== "number" ||
    !Number.isInteger(record.expectedSessionRevision) ||
    record.expectedSessionRevision < 0 ||
    typeof record.clientRequestId !== "string" ||
    !record.clientRequestId.trim()
  ) {
    throw new BadRequestException({ code: "INTERVIEW_SUBMIT_COMMAND_INVALID" });
  }
  return {
    answer: parseCustomerAnswer(record.questionRef.trim(), record.answer),
    sessionId: record.sessionId.trim(),
    expectedSessionRevision: record.expectedSessionRevision,
    clientRequestId: record.clientRequestId.trim(),
  };
}

function parseCustomerAnswer(
  questionId: string,
  value: unknown,
): AssessmentInterviewAnswerInput {
  const answer = objectRecord(value);
  if (
    !answer ||
    !Object.values(ASSESSMENT_INTERVIEW_CONTROLS).includes(answer.kind as never)
  ) {
    throw new BadRequestException({ code: "INTERVIEW_ANSWER_INVALID" });
  }
  const kind = answer.kind as CustomerAnswer["kind"];
  if (kind === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    if (typeof answer.text !== "string" || !answer.text.trim()) {
      throw new BadRequestException({ code: "INTERVIEW_ANSWER_INVALID" });
    }
    return { questionId, freeText: answer.text };
  }
  if (kind === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect) {
    if (typeof answer.value !== "string" || !answer.value.trim()) {
      throw new BadRequestException({ code: "INTERVIEW_ANSWER_INVALID" });
    }
    return {
      questionId,
      selectedChoiceIds: [answer.value],
      comment: typeof answer.comment === "string" ? answer.comment : undefined,
    };
  }
  if (kind === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect) {
    const values = Array.isArray(answer.values)
      ? answer.values.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];
    if (!values.length || new Set(values).size !== values.length) {
      throw new BadRequestException({ code: "INTERVIEW_ANSWER_INVALID" });
    }
    return {
      questionId,
      selectedChoiceIds: values,
      comment: typeof answer.comment === "string" ? answer.comment : undefined,
    };
  }
  if (kind === ASSESSMENT_INTERVIEW_CONTROLS.boolean) {
    if (typeof answer.value !== "boolean") {
      throw new BadRequestException({ code: "INTERVIEW_ANSWER_INVALID" });
    }
    return {
      questionId,
      selectedChoiceIds: [answer.value ? "yes" : "no"],
      comment: typeof answer.comment === "string" ? answer.comment : undefined,
    };
  }
  if (kind === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    if (answer.action === ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm) {
      return {
        questionId,
        confirmed: true,
        comment:
          typeof answer.comment === "string" ? answer.comment : undefined,
      };
    }
    if (
      answer.action === ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust &&
      typeof answer.adjustmentText === "string" &&
      answer.adjustmentText.trim()
    ) {
      return {
        questionId,
        adjusted: true,
        freeText: answer.adjustmentText,
      };
    }
  }
  throw new BadRequestException({ code: "INTERVIEW_ANSWER_INVALID" });
}

function parseBlockedAction(value: unknown): AssessmentInterviewBlockedInput {
  const record = objectRecord(value);
  if (
    !record ||
    !Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
      record.action as never,
    )
  ) {
    throw new BadRequestException({ code: "INTERVIEW_BLOCKED_ACTION_INVALID" });
  }
  return {
    action: record.action as AssessmentInterviewBlockedInput["action"],
    draft: typeof record.draft === "string" ? record.draft : undefined,
  };
}

function parsePostFindingDecision(
  value: unknown,
  correlationId: string,
): AssessmentPostFindingDecisionInput["decision"] {
  const record = objectRecord(value);
  if (!record || !isRemediationDecision(record.decision)) {
    throw problemException("POST_FINDING_DECISION_INVALID", correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
  return record.decision;
}

/** The need currently being asked; a RESOLVED/CANCELLED need is provenance only. */
function activeBusinessContextNeed(
  store: PrivateInterviewStore,
): TargetedInterviewNeed | undefined {
  return store.targetedNeed?.state === BUSINESS_CONTEXT_NEED_STATES.active
    ? store.targetedNeed
    : undefined;
}

function orchestratorInterviewTransition(
  decision: Pick<AgentDecisionInput, "mode" | "outcome" | "flags">,
  privateStore: PrivateInterviewStore,
  correlationId: string,
): OrchestratorInterviewTransition {
  const mode =
    activeBusinessContextNeed(privateStore) ||
    decision.mode === ASSESSMENT_INTERVIEW_MODES.businessContextResolution
      ? ASSESSMENT_INTERVIEW_MODES.businessContextResolution
      : ASSESSMENT_INTERVIEW_MODES.initialInterview;
  const hasDownstreamImpact = Boolean(
    decision.flags?.includes(ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact),
  );

  if (mode === ASSESSMENT_INTERVIEW_MODES.initialInterview) {
    if (decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer) {
      return {
        mode,
        action: ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.waitForCustomer,
        workflowEvent:
          ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewWaitingForCustomer,
        exactResumeAllowed: false,
        requiresDownstreamRescope: false,
      };
    }
    if (decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady) {
      return {
        mode,
        action:
          ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.continueToEngineeringRule,
        workflowEvent:
          ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextReady,
        exactResumeAllowed: false,
        requiresDownstreamRescope: false,
      };
    }
    if (
      decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved
    ) {
      return {
        mode,
        action:
          ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.keepBusinessContextBlocked,
        workflowEvent:
          ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewBlockedOrUnresolved,
        exactResumeAllowed: false,
        requiresDownstreamRescope: false,
      };
    }
    if (decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.failed) {
      return {
        mode,
        action: ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.routeRuntimeRecovery,
        workflowEvent: ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewFailed,
        exactResumeAllowed: false,
        requiresDownstreamRescope: false,
      };
    }
    throw problemException(
      "INTERVIEW_ORCHESTRATOR_TRANSITION_INVALID",
      correlationId,
      {
        status: HttpStatus.CONFLICT,
      },
    );
  }

  if (decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer) {
    return {
      mode,
      action: ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.waitForCustomer,
      workflowEvent:
        ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewWaitingForCustomer,
      exactResumeAllowed: false,
      requiresDownstreamRescope: false,
    };
  }
  if (decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved) {
    return {
      mode,
      action: hasDownstreamImpact
        ? ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.selectiveRerunRescope
        : ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.resumeSameRule,
      workflowEvent: hasDownstreamImpact
        ? ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.downstreamReevaluationStarted
        : ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.ruleReassessmentResumed,
      exactResumeAllowed: !hasDownstreamImpact,
      requiresDownstreamRescope: hasDownstreamImpact,
    };
  }
  if (decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved) {
    return {
      mode,
      action:
        ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.keepBusinessContextBlocked,
      workflowEvent:
        ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewBlockedOrUnresolved,
      exactResumeAllowed: false,
      requiresDownstreamRescope: false,
    };
  }
  if (decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.failed) {
    return {
      mode,
      action: ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.routeRuntimeRecovery,
      workflowEvent: ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewFailed,
      exactResumeAllowed: false,
      requiresDownstreamRescope: false,
    };
  }

  throw problemException(
    "INTERVIEW_ORCHESTRATOR_TRANSITION_INVALID",
    correlationId,
    {
      status: HttpStatus.CONFLICT,
    },
  );
}

function interviewWorkflowEventsForTransition(
  transition: OrchestratorInterviewTransition,
): AssessmentInterviewWorkflowEvent[] {
  if (
    transition.action ===
      ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.resumeSameRule ||
    transition.action ===
      ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.selectiveRerunRescope
  ) {
    return [
      ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextResolved,
      transition.workflowEvent,
    ];
  }
  return [transition.workflowEvent];
}

function postFindingPhaseAfterDecision(
  current: AssessmentPostFindingRuntimeState,
  decision: AssessmentPostFindingDecisionInput["decision"],
) {
  if (decision === REMEDIATION_DECISIONS.continueDetectedPr) {
    return POST_FINDING_RUNTIME_PHASES.existingPr;
  }
  if (decision === REMEDIATION_DECISIONS.createRemediationPr) {
    return POST_FINDING_RUNTIME_PHASES.createPr;
  }
  return current.phase;
}

const STABLE_NEED_ID = /^need:[A-Za-z0-9_.:-]{1,300}$/;
const MAX_NEED_ITEMS = 50;

function parseTargetedNeedRegistration(
  value: unknown,
): TargetedNeedRegistrationInput {
  const record = objectRecord(value);
  const text = (key: string, max: number): string | null => {
    const item = record?.[key];
    return typeof item === "string" && item.trim() && item.trim().length <= max
      ? item.trim()
      : null;
  };
  const list = (key: string, max: number, itemMax: number): string[] | null => {
    const items = record?.[key];
    if (!Array.isArray(items)) return null;
    const cleaned = items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= itemMax);
    return cleaned.length <= max ? cleaned : null;
  };
  const actorId = text("actorId", 200);
  const needId = text("needId", 300);
  const engineeringRuleId = text("engineeringRuleId", 200);
  const criterionId = text("criterionId", 200);
  const question = text("question", 1_000);
  const observation = text("observation", 1_000);
  const workflowRunId = text("workflowRunId", 200);
  const resolutionCriterionIds = list("resolutionCriterionIds", 50, 200);
  const evidenceRefs = list("evidenceRefs", MAX_NEED_ITEMS, 300);
  const contextRevision = record?.contextRevision;
  const authoredConditionIndex = record?.authoredConditionIndex;
  const checkpointId = record?.checkpointId;
  if (
    !record ||
    !actorId ||
    !needId ||
    !STABLE_NEED_ID.test(needId) ||
    !engineeringRuleId ||
    !criterionId ||
    !question ||
    !observation ||
    !workflowRunId ||
    !resolutionCriterionIds ||
    resolutionCriterionIds.length === 0 ||
    !resolutionCriterionIds.includes(criterionId) ||
    !evidenceRefs ||
    typeof contextRevision !== "number" ||
    !Number.isSafeInteger(contextRevision) ||
    contextRevision < 0 ||
    (authoredConditionIndex !== undefined &&
      authoredConditionIndex !== null &&
      (typeof authoredConditionIndex !== "number" ||
        !Number.isSafeInteger(authoredConditionIndex) ||
        authoredConditionIndex < 0)) ||
    (checkpointId !== undefined &&
      checkpointId !== null &&
      typeof checkpointId !== "string")
  ) {
    throw new BadRequestException({ code: "INTERVIEW_TARGETED_NEED_INVALID" });
  }
  assertNeutralTargetedText({
    businessContextNeed: question,
    resolutionCriteria: [],
    whyNeeded: observation,
  });
  const rawArtifactVersions = objectRecord(record.artifactVersions);
  const artifactVersions = rawArtifactVersions
    ? Object.fromEntries(
        Object.entries(rawArtifactVersions)
          .filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === "string" && entry[1].trim().length > 0,
          )
          .map(([key, item]) => [key, item.trim()]),
      )
    : undefined;
  return {
    actorId,
    needId,
    engineeringRuleId,
    criterionId,
    ...(typeof authoredConditionIndex === "number"
      ? { authoredConditionIndex }
      : {}),
    question,
    observation,
    resolutionCriterionIds,
    evidenceRefs,
    contextRevision,
    workflowRunId,
    ...(typeof checkpointId === "string" && checkpointId.trim()
      ? { checkpointId: checkpointId.trim() }
      : {}),
    ...(artifactVersions && Object.keys(artifactVersions).length > 0
      ? { artifactVersions }
      : {}),
  };
}

function parsePersistableInterviewQuestion(
  value: unknown,
  outcome: string,
  authorizedEvidenceRefs?: Set<string>,
  correlationId: string = "",
): AssessmentInterviewQuestion | undefined {
  if (outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer) {
    return undefined;
  }
  const record = objectRecord(value);
  if (
    !record ||
    !nonEmptyString(record.id) ||
    !Object.values(ASSESSMENT_INTERVIEW_QUESTION_INTENTS).includes(
      record.intent as never,
    ) ||
    !Object.values(ASSESSMENT_INTERVIEW_CONTROLS).includes(
      record.control as never,
    ) ||
    !nonEmptyString(record.prompt)
  ) {
    throw problemException(
      "INTERVIEW_INITIAL_QUESTION_INVALID",
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }

  // Canonical frontier validation (CUSTOMER + MATERIAL required)
  const frontierRecord = objectRecord(record.frontier);
  if (!frontierRecord) {
    throw problemException(
      "INTERVIEW_QUESTION_FRONTIER_REQUIRED",
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
  if (frontierRecord.owner !== INTERVIEW_FRONTIER_OWNERS.customer) {
    throw problemException(
      "INTERVIEW_QUESTION_FRONTIER_NOT_CUSTOMER_OWNED",
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
  if (
    frontierRecord.materiality !== INTERVIEW_FRONTIER_MATERIALITIES.material
  ) {
    throw problemException(
      "INTERVIEW_QUESTION_FRONTIER_NOT_MATERIAL",
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
  if (!nonEmptyString(frontierRecord.description)) {
    throw problemException(
      "INTERVIEW_QUESTION_FRONTIER_DESCRIPTION_REQUIRED",
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }

  const frontierEvidenceRefs = Array.isArray(frontierRecord.evidenceRefs)
    ? frontierRecord.evidenceRefs.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : undefined;

  const whyEvidenceRefs = Array.isArray(record.whyEvidenceRefs)
    ? record.whyEvidenceRefs.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : undefined;

  // Server-side evidence-ref authorization validation
  if (authorizedEvidenceRefs) {
    const refsToValidate = [
      ...(whyEvidenceRefs ?? []),
      ...(frontierEvidenceRefs ?? []),
    ];
    for (const ref of refsToValidate) {
      if (!authorizedEvidenceRefs.has(ref)) {
        throw problemException(
          "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED",
          correlationId,
          {
            status: HttpStatus.BAD_REQUEST,
            meta: { unauthorizedRef: ref },
          },
        );
      }
    }
  }

  const choices = Array.isArray(record.choices)
    ? record.choices
        .map((c) => {
          const choiceRecord = objectRecord(c);
          if (
            !choiceRecord ||
            !nonEmptyString(choiceRecord.id) ||
            !nonEmptyString(choiceRecord.label)
          ) {
            return null;
          }
          return {
            id: choiceRecord.id.trim(),
            label: choiceRecord.label.trim(),
            description:
              typeof choiceRecord.description === "string"
                ? choiceRecord.description.trim()
                : undefined,
            requiresFreeText: Boolean(choiceRecord.requiresFreeText),
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
    : undefined;
  const control = record.control as AssessmentInterviewControl;
  const proposedInterpretation =
    typeof record.proposedInterpretation === "string"
      ? record.proposedInterpretation.trim()
      : undefined;
  if (control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    const choicesById = new Map(
      (choices ?? []).map((choice) => [choice.id, choice]),
    );
    if (
      record.intent !== ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify ||
      !proposedInterpretation ||
      choicesById.size !== 2 ||
      !choicesById.has("CONFIRM") ||
      !choicesById.has("ADJUST") ||
      choicesById.get("CONFIRM")?.requiresFreeText === true ||
      choicesById.get("ADJUST")?.requiresFreeText !== true
    ) {
      throw problemException(
        "INTERVIEW_CONFIRM_ADJUST_QUESTION_INVALID",
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
  }

  return {
    id: record.id.trim(),
    needId:
      typeof record.needId === "string" ? record.needId.trim() : undefined,
    intent: record.intent as AssessmentInterviewQuestionIntent,
    control,
    prompt: record.prompt.trim(),
    choices,
    priorAnswerSummary:
      typeof record.priorAnswerSummary === "string"
        ? record.priorAnswerSummary.trim()
        : undefined,
    proposedInterpretation,
    whyEvidenceRefs,
    whyAreWeAsking:
      typeof record.whyAreWeAsking === "string"
        ? record.whyAreWeAsking.trim()
        : undefined,
    snippetRef: parseAiDiscoverySnippetRef(record.snippetRef),
    frontier: {
      owner: INTERVIEW_FRONTIER_OWNERS.customer,
      materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
      description: frontierRecord.description.trim(),
      evidenceRefs: frontierEvidenceRefs,
    },
  };
}

function parseAgentDecision(value: unknown): AgentDecisionInput {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.expectedContextRevision !== "number" ||
    !Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(
      record.outcome as never,
    )
  ) {
    throw new BadRequestException({ code: "INTERVIEW_AGENT_DECISION_INVALID" });
  }
  const outcome = record.outcome as AgentDecisionInput["outcome"];
  const activeQuestion = parsePersistableInterviewQuestion(
    record.activeQuestion,
    outcome,
  );
  const storedMode = canonicalizeLegacyInterviewValue(record.mode);
  const mode =
    storedMode === ASSESSMENT_INTERVIEW_MODES.initialInterview
      ? ASSESSMENT_INTERVIEW_MODES.initialInterview
      : storedMode === ASSESSMENT_INTERVIEW_MODES.businessContextResolution
        ? ASSESSMENT_INTERVIEW_MODES.businessContextResolution
        : undefined;
  if (!mode) {
    throw new BadRequestException({ code: "INTERVIEW_AGENT_DECISION_INVALID" });
  }
  return {
    expectedContextRevision: record.expectedContextRevision,
    mode,
    outcome,
    activeQuestion,
    rationale:
      typeof record.rationale === "string" && record.rationale.trim()
        ? record.rationale.trim()
        : undefined,
    contextAuthority: Object.values(
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
    ).includes(record.contextAuthority as never)
      ? (record.contextAuthority as AssessmentContextAuthorityStatus)
      : undefined,
    confirmedContext: objectRecord(record.confirmedContext) ?? undefined,
    blockedActions: Array.isArray(record.blockedActions)
      ? record.blockedActions.filter((item): item is never =>
          Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
            item as never,
          ),
        )
      : undefined,
    flags: Array.isArray(record.flags)
      ? record.flags.filter((item): item is never => typeof item === "string")
      : undefined,
  };
}

function parseStoredInterviewState(
  value: unknown,
): AssessmentInterviewRuntimeState | null {
  const record = objectRecord(value);
  if (
    !record ||
    !Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(
      record.outcome as never,
    )
  ) {
    return null;
  }
  return record as AssessmentInterviewRuntimeState;
}

function parseResumeInput(
  value: unknown,
  correlationId: string,
): AssessmentInterviewResumeInput {
  const record =
    value === undefined || value === null ? {} : objectRecord(value);
  const expected = record?.expectedSessionRevision;
  if (
    !record ||
    Object.keys(record).some((key) => key !== "expectedSessionRevision") ||
    (expected !== undefined &&
      (typeof expected !== "number" ||
        !Number.isSafeInteger(expected) ||
        expected < 0))
  ) {
    throw problemException(
      ASSESSMENT_INTERVIEW_RESUME_PROBLEM_CODES.notAvailable,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
  return expected === undefined ? {} : { expectedSessionRevision: expected };
}

function parsePrivateStore(value: unknown): PrivateInterviewStore {
  if (Array.isArray(value)) {
    return { revisions: value.filter(isPrivateRevision) };
  }
  const record = objectRecord(value);
  if (!record) {
    return { revisions: [] };
  }
  const revisions = Array.isArray(record.revisions)
    ? record.revisions.filter(isPrivateRevision)
    : [];
  const targetedNeed = parseStoredTargetedNeed(record.targetedNeed);
  const targetedContinuation = parseStoredTargetedContinuation(
    record.targetedContinuation,
  );
  return {
    revisions,
    submittedAnswerRequests: Array.isArray(record.submittedAnswerRequests)
      ? record.submittedAnswerRequests.filter(isAnswerIdempotencyRecord)
      : undefined,
    workflowRunId:
      typeof record.workflowRunId === "string" && record.workflowRunId.trim()
        ? record.workflowRunId.trim()
        : undefined,
    targetedNeed,
    targetedContinuation,
    partialCoveragePolicyDecision: parsePartialCoveragePolicyDecision(
      record.partialCoveragePolicyDecision,
    ),
    workingStrategy: normalizeStrategy(
      record.workingStrategy as Partial<InterviewWorkingStrategy> | undefined,
    ),
    failedDecisionRevision: positiveSafeInteger(record.failedDecisionRevision),
    resumeAttempts: parseResumeAttempts(record.resumeAttempts),
  };
}

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function parseResumeAttempts(
  value: unknown,
): InterviewResumeAttempts | undefined {
  const record = objectRecord(value);
  const contextRevision = positiveSafeInteger(record?.contextRevision);
  const count = positiveSafeInteger(record?.count);
  return contextRevision && count ? { contextRevision, count } : undefined;
}

// READ-ONLY legacy adapter for Interview thread JSON persisted before the
// Investigator -> business-context/same-rule vocabulary rename. It only maps stored
// or in-flight values to the canonical ones; nothing here is ever emitted.
// Removal condition: delete one release after this rename is deployed, once no
// persisted thread or in-flight worker message can carry the legacy values.
const LEGACY_INTERVIEW_VALUE_ALIASES: Readonly<Record<string, string>> = {
  INVESTIGATOR_RESOLUTION: ASSESSMENT_INTERVIEW_MODES.businessContextResolution,
  INVESTIGATOR_RESOLUTION_REQUIRED:
    ASSESSMENT_INTERVIEW_RESUME_REASONS.businessContextResolutionRequired,
  RESUME_EXACT_INVESTIGATOR:
    ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.resumeSameRule,
  INVESTIGATION_RESUMED:
    ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.ruleReassessmentResumed,
};

function canonicalizeLegacyInterviewValue(value: unknown): unknown {
  return typeof value === "string"
    ? (LEGACY_INTERVIEW_VALUE_ALIASES[value] ?? value)
    : value;
}

function readOriginatingRuleAnalysisReference(
  record: Record<string, unknown>,
): unknown {
  return (
    record.originatingRuleAnalysisReference ??
    record.originatingInvestigationReference
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseStoredTargetedNeed(
  value: unknown,
): TargetedInterviewNeed | undefined {
  const record = objectRecord(value);
  const originatingRuleAnalysisReference = record
    ? readOriginatingRuleAnalysisReference(record)
    : undefined;
  if (
    !record ||
    typeof record.needId !== "string" ||
    typeof originatingRuleAnalysisReference !== "string" ||
    typeof record.sourceVersion !== "string" ||
    typeof record.pgeVersion !== "string"
  ) {
    return undefined;
  }
  const state =
    record.state === BUSINESS_CONTEXT_NEED_STATES.resolved ||
    record.state === BUSINESS_CONTEXT_NEED_STATES.cancelled
      ? record.state
      : BUSINESS_CONTEXT_NEED_STATES.active;
  const governedEvidenceRefs = Array.isArray(record.governedEvidenceRefs)
    ? stringList(record.governedEvidenceRefs)
    : undefined;
  if (
    typeof record.engineeringRuleId === "string" &&
    typeof record.criterionId === "string" &&
    typeof record.question === "string"
  ) {
    return {
      needId: record.needId,
      state,
      engineeringRuleId: record.engineeringRuleId,
      criterionId: record.criterionId,
      authoredConditionIndex:
        typeof record.authoredConditionIndex === "number"
          ? record.authoredConditionIndex
          : undefined,
      question: record.question,
      observation:
        typeof record.observation === "string" ? record.observation : "",
      resolutionCriterionIds: stringList(record.resolutionCriterionIds),
      governedEvidenceRefs,
      contextRevision:
        typeof record.contextRevision === "number" ? record.contextRevision : 0,
      originatingRuleAnalysisReference,
      sourceVersion: record.sourceVersion,
      pgeVersion: record.pgeVersion,
    };
  }
  // Compatibility adapter: need persisted by the pre-BusinessContextNeed runtime.
  if (
    typeof record.businessContextNeed !== "string" ||
    !Array.isArray(record.resolutionCriteria)
  ) {
    return undefined;
  }
  return {
    needId: record.needId,
    state,
    engineeringRuleId: "",
    criterionId: "",
    question: record.businessContextNeed,
    observation: typeof record.whyNeeded === "string" ? record.whyNeeded : "",
    resolutionCriterionIds: [],
    governedEvidenceRefs,
    contextRevision: 0,
    originatingRuleAnalysisReference,
    sourceVersion: record.sourceVersion,
    pgeVersion: record.pgeVersion,
    legacyResolutionCriteria: stringList(record.resolutionCriteria),
  };
}

function parseStoredTargetedContinuation(
  value: unknown,
): TargetedInterviewContinuation | undefined {
  const record = objectRecord(value);
  const originatingRuleAnalysisReference = record
    ? readOriginatingRuleAnalysisReference(record)
    : undefined;
  if (
    !record ||
    typeof originatingRuleAnalysisReference !== "string" ||
    typeof record.workflowRunId !== "string" ||
    typeof record.sourceVersion !== "string" ||
    typeof record.pgeVersion !== "string"
  ) {
    return undefined;
  }
  const artifactVersions = objectRecord(record.artifactVersions);
  const engineeringRuleId =
    typeof record.engineeringRuleId === "string"
      ? record.engineeringRuleId
      : // Compatibility adapter: pre-BusinessContextNeed continuation rows.
        stringList(record.affectedRuleIds)[0];
  return {
    originatingRuleAnalysisReference,
    needId: typeof record.needId === "string" ? record.needId : "",
    engineeringRuleId: engineeringRuleId ?? "",
    criterionId:
      typeof record.criterionId === "string" ? record.criterionId : undefined,
    resolutionCriterionIds: Array.isArray(record.resolutionCriterionIds)
      ? stringList(record.resolutionCriterionIds)
      : undefined,
    contextRevision:
      typeof record.contextRevision === "number" ? record.contextRevision : 0,
    workflowRunId: record.workflowRunId,
    checkpointId:
      typeof record.checkpointId === "string" ? record.checkpointId : undefined,
    artifactVersions: artifactVersions
      ? Object.fromEntries(
          Object.entries(artifactVersions).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined,
    sourceVersion: record.sourceVersion,
    pgeVersion: record.pgeVersion,
  };
}

function parsePartialCoveragePolicyDecision(
  value: unknown,
): PartialCoveragePolicyDecision | undefined {
  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }
  const limitations = Array.isArray(record.limitations)
    ? record.limitations
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim())
    : [];
  if (
    typeof record.policyDecisionRef !== "string" ||
    !record.policyDecisionRef.trim() ||
    typeof record.policyVersion !== "string" ||
    !record.policyVersion.trim() ||
    typeof record.permittedForInterview !== "boolean"
  ) {
    return undefined;
  }
  return {
    policyDecisionRef: record.policyDecisionRef.trim(),
    policyVersion: record.policyVersion.trim(),
    permittedForInterview: record.permittedForInterview,
    limitations,
  };
}

function isPrivateRevision(
  value: unknown,
): value is PrivateInterviewAnswerRevision {
  const record = objectRecord(value);
  return (
    !!record &&
    typeof record.questionId === "string" &&
    objectRecord(record.answer) !== null &&
    typeof record.actorId === "string" &&
    typeof record.answeredAt === "string" &&
    typeof record.contextRevision === "number" &&
    typeof record.priorRevision === "number" &&
    Object.values(ASSESSMENT_CONTEXT_AUTHORITY_STATUSES).includes(
      record.authority as never,
    ) &&
    typeof record.sourceVersion === "string" &&
    typeof record.pgeVersion === "string" &&
    Array.isArray(record.governedEvidenceRefs)
  );
}

function isAnswerIdempotencyRecord(
  value: unknown,
): value is InterviewAnswerIdempotencyRecord {
  const record = objectRecord(value);
  return (
    !!record &&
    typeof record.clientRequestId === "string" &&
    record.clientRequestId.trim().length > 0 &&
    typeof record.payloadFingerprint === "string" &&
    typeof record.questionId === "string" &&
    typeof record.contextRevision === "number" &&
    typeof record.recordedAt === "string"
  );
}

function assertInitialPlanningContextReady(
  decision: AgentDecisionInput,
  mode: CanonicalAssessmentInterviewMode,
  correlationId: string,
): void {
  // Targeted BUSINESS_CONTEXT_RESOLUTION turns resolve one rule-specific need and must
  // never be re-gated by the initial minimum planning context.
  if (
    mode !== ASSESSMENT_INTERVIEW_MODES.initialInterview ||
    decision.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.contextReady
  ) {
    return;
  }
  const missingDimensions = missingInitialPlanningContextDimensions(
    decision.confirmedContext,
  );
  if (missingDimensions.length === 0) {
    return;
  }
  throw problemException(
    ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES.minimumContextIncomplete,
    correlationId,
    {
      status: HttpStatus.CONFLICT,
      meta: {
        missingDimensionCount: missingDimensions.length,
        missingDimensions: missingDimensions.join(","),
      },
    },
  );
}

function assertGuardedDecision(
  decision: AgentDecisionInput,
  privateRevision: PrivateInterviewAnswerRevision | undefined,
  thread: {
    state: AssessmentInterviewRuntimeState;
    sourceVersion: string | null;
    pgeVersion: string | null;
    privateStore: PrivateInterviewStore;
  },
  correlationId: string,
  followup: { isBlockedFollowup: boolean; isTargetedBootstrap: boolean },
): void {
  if (
    !privateRevision &&
    !followup.isBlockedFollowup &&
    !followup.isTargetedBootstrap
  ) {
    throw problemException(
      "INTERVIEW_PRIVATE_REVISION_NOT_FOUND",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
    !decision.activeQuestion
  ) {
    throw problemException(
      "INTERVIEW_WAITING_REQUIRES_QUESTION",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    decision.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
    decision.activeQuestion
  ) {
    throw problemException(
      "INTERVIEW_ACTIVE_QUESTION_OUTCOME_INVALID",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  assertAuthorityProvenance(
    decision.contextAuthority,
    privateRevision,
    correlationId,
  );
  if (activeBusinessContextNeed(thread.privateStore)) {
    if (
      decision.mode !== ASSESSMENT_INTERVIEW_MODES.businessContextResolution
    ) {
      throw problemException(
        "INTERVIEW_TARGETED_MODE_REQUIRED",
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const targetedOutcomes = new Set<string>([
      ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
      ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
      ASSESSMENT_INTERVIEW_OUTCOMES.failed,
    ]);
    if (!targetedOutcomes.has(decision.outcome)) {
      throw problemException(
        "INTERVIEW_TARGETED_OUTCOME_INVALID",
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
  }
  const boundNeed = activeBusinessContextNeed(thread.privateStore);
  if (boundNeed && decision.confirmedContext) {
    assertAnswerBoundToNeed(
      decision.confirmedContext,
      boundNeed,
      correlationId,
    );
  }
  assertTargetedQuestionBounded(decision, thread, correlationId);
  if (
    decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady &&
    !isAuthoritative(decision.contextAuthority)
  ) {
    throw problemException(
      "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (decision.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved) {
    return;
  }
  if (decision.mode !== ASSESSMENT_INTERVIEW_MODES.businessContextResolution) {
    throw problemException(
      "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_TARGETED_MODE",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (!isAuthoritative(decision.contextAuthority)) {
    throw problemException(
      "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_AUTHORITY",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  const target = activeBusinessContextNeed(thread.privateStore);
  const continuation = thread.privateStore.targetedContinuation;
  if (!target || !continuation) {
    throw problemException(
      "INTERVIEW_TARGETED_CONTEXT_NOT_REGISTERED",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    target.originatingRuleAnalysisReference !==
    continuation.originatingRuleAnalysisReference
  ) {
    throw problemException(
      "INTERVIEW_CONTINUATION_ORIGIN_MISMATCH",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    target.sourceVersion !== thread.sourceVersion ||
    target.pgeVersion !== thread.pgeVersion ||
    continuation.sourceVersion !== thread.sourceVersion ||
    continuation.pgeVersion !== thread.pgeVersion
  ) {
    throw problemException("INTERVIEW_CONTINUATION_STALE", correlationId, {
      status: HttpStatus.CONFLICT,
    });
  }
  if (!continuation.engineeringRuleId) {
    throw problemException(
      "INTERVIEW_CONTINUATION_SCOPE_REQUIRED",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  const context = decision.confirmedContext ?? {};
  const missing = target.legacyResolutionCriteria
    ? target.legacyResolutionCriteria.filter(
        (criterion) => !confirmedContextSatisfiesCriterion(context, criterion),
      )
    : target.resolutionCriterionIds.filter(
        (criterionId) =>
          !confirmedContextResolvesCriterion(context, criterionId),
      );
  if (missing.length > 0) {
    throw problemException(
      "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED",
      correlationId,
      {
        status: HttpStatus.CONFLICT,
        meta: { missing: missing.join(",") },
      },
    );
  }
}

/**
 * A criterion is settled when a confirmed statement cites it through the model-selected
 * `resolvesCriterionId`. Runs before API provenance is materialized.
 */
function confirmedContextResolvesCriterion(
  context: Record<string, unknown>,
  criterionId: string,
): boolean {
  if (!Array.isArray(context.statements)) {
    return false;
  }
  return context.statements.some((value) => {
    const statement = objectRecord(value);
    return (
      !!statement &&
      statement.resolvesCriterionId === criterionId &&
      (statement.resolutionState === undefined ||
        statement.resolutionState ===
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed)
    );
  });
}

function confirmedContextSatisfiesCriterion(
  context: Record<string, unknown>,
  criterion: string,
): boolean {
  const structuredTopics = confirmedStructuredContextTopics(context);
  if (structuredTopics) {
    return structuredTopics.has(criterion);
  }
  return Object.hasOwn(context, criterion);
}

function confirmedStructuredContextTopics(
  context: Record<string, unknown>,
): Set<string> | null {
  if (
    context.authority !==
      CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly &&
    !Array.isArray(context.statements)
  ) {
    return null;
  }
  if (
    (context.authority !== undefined &&
      context.authority !==
        CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly) ||
    !Array.isArray(context.statements)
  ) {
    return new Set();
  }
  const topics = new Set<string>();
  for (const value of context.statements) {
    const statement = objectRecord(value);
    if (
      statement &&
      // This guard runs before API-owned provenance is materialized. Model
      // candidates may omit it, but explicit unresolved states fail closed.
      (statement.resolutionState === undefined ||
        statement.resolutionState ===
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed) &&
      nonEmptyString(statement.topic)
    ) {
      topics.add(statement.topic);
    }
  }
  return topics;
}

function assertTargetedQuestionBounded(
  decision: AgentDecisionInput,
  thread: {
    privateStore: PrivateInterviewStore;
  },
  correlationId: string,
): void {
  if (
    decision.mode !== ASSESSMENT_INTERVIEW_MODES.businessContextResolution ||
    decision.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer ||
    !decision.activeQuestion
  ) {
    return;
  }
  const target = activeBusinessContextNeed(thread.privateStore);
  if (!target) {
    throw problemException(
      "INTERVIEW_TARGETED_CONTEXT_NOT_REGISTERED",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  const questionNeedId = (decision.activeQuestion as { needId?: unknown })
    .needId;
  if (
    typeof questionNeedId === "string" &&
    questionNeedId.trim() &&
    questionNeedId !== target.needId
  ) {
    throw problemException(
      "INTERVIEW_TARGETED_QUESTION_NEED_MISMATCH",
      correlationId,
      {
        status: HttpStatus.CONFLICT,
      },
    );
  }
  assertNeutralTargetedText({
    businessContextNeed: decision.activeQuestion.prompt,
    resolutionCriteria: [
      decision.activeQuestion.priorAnswerSummary,
      ...(decision.activeQuestion.choices ?? []).flatMap((choice) => [
        choice.label,
        choice.description,
      ]),
    ].filter((item): item is string => typeof item === "string"),
    whyNeeded: undefined,
  });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertNeutralTargetedText(input: {
  businessContextNeed: string;
  resolutionCriteria: string[];
  whyNeeded?: string;
}): void {
  const texts = [
    input.businessContextNeed,
    ...input.resolutionCriteria,
    input.whyNeeded,
  ].filter((item): item is string => typeof item === "string");
  const leaked = texts.find((text) =>
    TARGETED_TEXT_LEAK_PATTERNS.some((pattern) => pattern.test(text)),
  );
  if (leaked) {
    throw new BadRequestException({
      code: "INTERVIEW_TARGETED_NEED_NON_NEUTRAL",
    });
  }
}

function assertAuthorityProvenance(
  authority: AssessmentContextAuthorityStatus | undefined,
  privateRevision: PrivateInterviewAnswerRevision | undefined,
  correlationId: string,
): void {
  if (!isAuthoritative(authority)) {
    return;
  }
  if (!privateRevision) {
    throw problemException(
      "INTERVIEW_AUTHORITATIVE_CONTEXT_REQUIRES_CUSTOMER_REVISION",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }

  const explicitlyConfirmed =
    privateRevision.questionControl ===
      ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust &&
    privateRevision.answer.confirmed === true &&
    privateRevision.answer.adjusted !== true;

  const directLosslessCustomerStatement =
    privateRevision.questionIntent ===
      ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask &&
    privateRevision.questionControl !==
      ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust &&
    privateRevision.answer.adjusted !== true &&
    !revisionRequiresAnswerInterpretation(privateRevision);

  if (authority === ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed) {
    if (!explicitlyConfirmed && !directLosslessCustomerStatement) {
      throw problemException(
        "INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_DIRECT_OR_EXPLICIT_CONFIRMATION",
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return;
  }

  if (!directLosslessCustomerStatement) {
    throw problemException(
      "INTERVIEW_CONFIRMED_REQUIRES_DIRECT_ASK",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
}

function revisionRequiresAnswerInterpretation(
  privateRevision: PrivateInterviewAnswerRevision,
): boolean {
  if (privateRevision.answerRequiresInterpretation === true) {
    return true;
  }
  const answer = privateRevision.answer;
  return (
    privateRevision.questionControl ===
      ASSESSMENT_INTERVIEW_CONTROLS.freeText ||
    Boolean(answer.freeText?.trim()) ||
    Boolean(answer.comment?.trim()) ||
    Boolean(answer.otherText?.trim())
  );
}

function requiresAnswerInterpretation(
  answer: AssessmentInterviewAnswerInput,
  question: NonNullable<AssessmentInterviewRuntimeState["activeQuestion"]>,
): boolean {
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    return true;
  }
  if (answer.comment?.trim() || answer.otherText?.trim()) {
    return true;
  }
  const choiceById = new Map(
    (question.choices ?? []).map((choice) => [choice.id, choice]),
  );
  return (answer.selectedChoiceIds ?? []).some(
    (choiceId) => choiceById.get(choiceId)?.requiresFreeText === true,
  );
}

function assertAnswerMatchesQuestion(
  answer: AssessmentInterviewAnswerInput,
  question: NonNullable<AssessmentInterviewRuntimeState["activeQuestion"]>,
): void {
  const invalid = () => {
    throw new BadRequestException({ code: "INTERVIEW_ANSWER_CONTROL_INVALID" });
  };
  const selected = answer.selectedChoiceIds ?? [];
  if (new Set(selected).size !== selected.length) {
    invalid();
  }
  const choiceById = new Map(
    (question.choices ?? []).map((choice) => [choice.id, choice]),
  );
  const unknownChoice = selected.some((choiceId) => !choiceById.has(choiceId));
  const requiresOtherText = selected.some(
    (choiceId) => choiceById.get(choiceId)?.requiresFreeText === true,
  );
  const hasOtherText = Boolean(
    answer.otherText?.trim() || answer.comment?.trim(),
  );
  const hasFreeText = Boolean(answer.freeText?.trim());
  const hasComment = Boolean(answer.comment?.trim());

  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    if (
      !hasFreeText ||
      selected.length ||
      answer.confirmed ||
      answer.adjusted ||
      hasOtherText ||
      hasComment
    )
      invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean) {
    if (
      selected.length !== 1 ||
      !["yes", "no"].includes(selected[0] ?? "") ||
      answer.confirmed ||
      answer.adjusted ||
      hasOtherText
    )
      invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect) {
    if (
      selected.length !== 1 ||
      unknownChoice ||
      answer.confirmed ||
      answer.adjusted
    )
      invalid();
    if (requiresOtherText !== hasOtherText) invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect) {
    if (
      !selected.length ||
      unknownChoice ||
      answer.confirmed ||
      answer.adjusted
    )
      invalid();
    if (requiresOtherText !== hasOtherText) invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    if (
      answer.confirmed === answer.adjusted ||
      selected.length ||
      hasOtherText ||
      (answer.confirmed === true && hasFreeText) ||
      (answer.adjusted === true && !hasFreeText)
    )
      invalid();
    return;
  }
  invalid();
}

function decisionState(
  current: AssessmentInterviewRuntimeState,
  decision: AgentDecisionInput,
): AssessmentInterviewRuntimeState {
  return {
    ...current,
    outcome: decision.outcome,
    // Transition rationale is never persisted as customer chat content. The
    // deterministic handoff copy for CONTEXT_READY / CONTEXT_RESOLVED is resolved
    // from @lcsp/i18n by the web interview handoff presentation.
    assistantMessage: undefined,
    activeQuestion:
      decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer
        ? decision.activeQuestion
        : undefined,
    contextAuthority: decision.contextAuthority ?? current.contextAuthority,
    confirmedContext:
      isAuthoritative(decision.contextAuthority) && decision.confirmedContext
        ? decision.confirmedContext
        : current.confirmedContext,
    blockedActions:
      decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved
        ? (decision.blockedActions ??
          Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS))
        : decision.blockedActions,
    flags: decision.flags ?? current.flags,
    orchestrationRequested: false,
  };
}

function isAuthoritative(value: unknown): boolean {
  return (
    value === ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed ||
    value === ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed
  );
}

function truncateWorkerHistoryText(
  text: string | undefined,
): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= WORKER_PRIOR_ANSWER_HISTORY_TEXT_LIMIT) return trimmed;
  return (
    trimmed.slice(0, WORKER_PRIOR_ANSWER_HISTORY_TEXT_LIMIT) +
    WORKER_PRIOR_ANSWER_HISTORY_TRUNCATION_MARKER
  );
}

// Worker-only: never call this for anything that feeds publicState, logs, or a
// runtime event — this is the one place verbatim Customer comment/free text from
// prior turns is allowed to leave private storage.
function buildWorkerPriorAnswerHistory(
  revisions: PrivateInterviewAnswerRevision[],
  currentRevision: number,
): {
  items: WorkerPriorAnswerHistoryItem[];
  omittedCount: number;
} {
  const prior = revisions.filter(
    (revision) => revision.contextRevision !== currentRevision,
  );
  const omittedCount = Math.max(
    0,
    prior.length - WORKER_PRIOR_ANSWER_HISTORY_MAX_ENTRIES,
  );
  const kept = prior.slice(-WORKER_PRIOR_ANSWER_HISTORY_MAX_ENTRIES);
  const items = kept.map((revision): WorkerPriorAnswerHistoryItem => {
    const item: WorkerPriorAnswerHistoryItem = {
      questionId: revision.questionId,
      contextRevision: revision.contextRevision,
      questionIntent: revision.questionIntent,
      questionControl: revision.questionControl,
    };
    if (revision.answer.selectedChoiceIds?.length) {
      item.selectedChoiceIds = revision.answer.selectedChoiceIds;
    }
    if (typeof revision.answer.confirmed === "boolean") {
      item.confirmed = revision.answer.confirmed;
    }
    if (typeof revision.answer.adjusted === "boolean") {
      item.adjusted = revision.answer.adjusted;
    }
    const freeText = truncateWorkerHistoryText(revision.answer.freeText);
    if (freeText) item.freeText = freeText;
    const comment = truncateWorkerHistoryText(
      revision.answer.comment ?? revision.answer.otherText,
    );
    if (comment) item.comment = comment;
    return item;
  });
  return { items, omittedCount };
}

function summarizeAnswer(answer: AssessmentInterviewAnswerInput): string {
  if (answer.confirmed) {
    return "Customer confirmed prior material context.";
  }
  if (answer.adjusted) {
    return "Customer requested adjustment to prior material context.";
  }
  if (answer.selectedChoiceIds?.length) {
    return `Customer selected ${answer.selectedChoiceIds.length} option(s).`;
  }
  return "Customer supplied free-text Interview context.";
}

export function sanitizePublicText(text?: string): string | undefined {
  if (!text) return undefined;
  let sanitized = text;
  sanitized = sanitized.replace(
    /(?:api[_-]?key|secret|token|password|client[_-]?secret)\s*[:=]\s*['"][^'"]+['"]/gi,
    "[redacted secret]",
  );
  sanitized = sanitized.replace(
    /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    "[redacted token]",
  );
  sanitized = sanitized.replace(
    /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/gi,
    "[redacted token]",
  );
  sanitized = sanitized.replace(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    "[redacted token]",
  );
  sanitized = sanitized.replace(
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
    "[redacted token]",
  );
  sanitized = sanitized.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted secret]");
  sanitized = sanitized.replace(
    /\bsk_(?:live|test)_[A-Za-z0-9_-]{12,}\b/gi,
    "[redacted secret]",
  );
  sanitized = sanitized.replace(
    /(?:postgres|mysql|mongodb|redis|amqp|http|https):\/\/[^/\s:@]+:[^/\s:@]+@[^/\s]+/gi,
    "[redacted url]",
  );
  sanitized = sanitized.replace(
    /(?:^|[\s"'`([])\/(?:etc|var|proc|sys|root|home|Users|private|tmp|app|secrets?)(?:\/[A-Za-z0-9_.-]+)*/gi,
    " [path reference]",
  );
  sanitized = sanitized.replace(
    /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|cpp|c|h|rb|php|cs|scala|kt|json|yaml|yml|env|conf|cfg|ini|log|txt|sh|bash)(?::\d+(?::\d+)?)?\b/gi,
    "[file reference]",
  );
  sanitized = sanitized.replace(/\b(?:ENG|ER|LR)-\d+\b/gi, "");
  sanitized = sanitized.replace(/\b(?:EngineeringRule|LegalRule)\b/gi, "");
  sanitized = sanitized.replace(
    /\bcheckpoint(?:Id)?\s*[:=]\s*['"][^'"]+['"]/gi,
    "",
  );
  sanitized = sanitized.replace(
    /\bthread(?:Id)?\s*[:=]\s*['"][^'"]+['"]/gi,
    "",
  );
  sanitized = sanitized.replace(
    /\bcontinuation(?:Token)?\s*[:=]\s*['"][^'"]+['"]/gi,
    "",
  );
  sanitized = sanitized.replace(/\bcp-[A-Za-z0-9_-]+\b/gi, "");
  sanitized = sanitized.replace(/\bcheckpoint(?:Id)?\b/gi, "");
  sanitized = sanitized.replace(/\bcontinuation(?: token)?\b/gi, "");
  sanitized = sanitized.replace(/\bthread(?:Id)?\b/gi, "");
  sanitized = sanitized.replace(/\bLangGraph\b/gi, "");
  sanitized = sanitized.replace(/\bnode:[0-9a-fA-F-]{8,}\b/gi, "");
  sanitized = sanitized.replace(/\bsymbol:[a-zA-Z0-9_.:/-]+\b/gi, "");
  for (const pattern of INTERNAL_ORCHESTRATION_TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized.replace(/[ \t]+/g, " ").trim();
}

/**
 * Server-owned identity for a governed answer to a BusinessContextNeed.
 *
 * The model may only pick, per statement, ONE of the criterion ids the active need listed
 * (`resolvesCriterionId`). `sourceNeedId`, `engineeringRuleId` and `resolvedCriterionIds`
 * are stamped here from the need the server itself registered; anything the model wrote
 * for those fields is never copied. An answer is therefore tied to its need by identity,
 * not by topic or wording, and resolves only that need's criteria.
 */
function needIdentityFor(
  stmt: Record<string, unknown>,
  need: TargetedInterviewNeed | undefined,
  previous: Map<string, Record<string, unknown>>,
  statementId: string,
): Record<string, unknown> {
  const carried = previous.get(statementId);
  if (carried && typeof carried.sourceNeedId === "string") {
    // Identity already established on an earlier revision survives later turns that
    // re-emit the same statement.
    return {
      sourceNeedId: carried.sourceNeedId,
      ...(typeof carried.engineeringRuleId === "string"
        ? { engineeringRuleId: carried.engineeringRuleId }
        : {}),
      resolvedCriterionIds: carried.resolvedCriterionIds,
    };
  }
  const claimed = stmt.resolvesCriterionId;
  if (
    need?.engineeringRuleId &&
    typeof claimed === "string" &&
    need.resolutionCriterionIds.includes(claimed)
  ) {
    return {
      sourceNeedId: need.needId,
      engineeringRuleId: need.engineeringRuleId,
      resolvedCriterionIds: [claimed],
    };
  }
  return {};
}

/**
 * Rejects an answer that names an identity its need does not own: a foreign need id,
 * rule id, or a criterion id outside the registered resolutionCriterionIds.
 */
function assertAnswerBoundToNeed(
  context: Record<string, unknown>,
  need: TargetedInterviewNeed,
  correlationId: string,
): void {
  if (need.legacyResolutionCriteria || !Array.isArray(context.statements)) {
    return;
  }
  for (const value of context.statements) {
    const statement = objectRecord(value);
    if (!statement) continue;
    const claimed = statement.resolvesCriterionId;
    if (
      claimed !== undefined &&
      claimed !== null &&
      (typeof claimed !== "string" ||
        !need.resolutionCriterionIds.includes(claimed))
    ) {
      throw problemException(
        "INTERVIEW_ANSWER_CRITERION_UNKNOWN",
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const foreignNeed =
      statement.sourceNeedId !== undefined &&
      statement.sourceNeedId !== need.needId;
    const foreignRule =
      statement.engineeringRuleId !== undefined &&
      statement.engineeringRuleId !== need.engineeringRuleId;
    if (foreignNeed || foreignRule) {
      throw problemException("INTERVIEW_ANSWER_NEED_MISMATCH", correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
  }
}

export function materializeConfirmedStructuredBusinessContext(
  context: Record<string, unknown>,
  authorizedRefs: Set<string>,
  assessmentId: string,
  privateRevision: PrivateInterviewAnswerRevision,
  correlationId: string,
  identity: {
    need?: TargetedInterviewNeed;
    previousStatements?: unknown;
  } = {},
): Record<string, unknown> {
  const previous = new Map<string, Record<string, unknown>>();
  if (Array.isArray(identity.previousStatements)) {
    for (const item of identity.previousStatements) {
      const record = objectRecord(item);
      if (record && typeof record.statementId === "string") {
        previous.set(record.statementId, record);
      }
    }
  }
  if (!Array.isArray(context.statements) || context.statements.length === 0) {
    throw problemException(
      "INTERVIEW_CONFIRMED_CONTEXT_INVALID",
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }

  const respondentRef = `actor:authenticated:${privateRevision.actorId}`;
  const statements = context.statements.map((item) => {
    const stmt = objectRecord(item);
    if (
      !stmt ||
      !nonEmptyString(stmt.statementId) ||
      !nonEmptyString(stmt.topic) ||
      !nonEmptyString(stmt.statement)
    ) {
      throw problemException(
        "INTERVIEW_CONFIRMED_CONTEXT_INVALID",
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const evidenceRefs = Array.isArray(stmt.evidenceRefs)
      ? stmt.evidenceRefs.filter(
          (ref): ref is string =>
            typeof ref === "string" && ref.trim().length > 0,
        )
      : [];
    for (const ref of evidenceRefs) {
      if (!authorizedRefs.has(ref)) {
        throw problemException(
          "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED",
          correlationId,
          { status: HttpStatus.BAD_REQUEST, meta: { unauthorizedRef: ref } },
        );
      }
    }
    const rawScope = objectRecord(stmt.scope);
    const scope = rawScope
      ? rawScope
      : typeof stmt.scope === "string" && stmt.scope.trim()
        ? { needId: stmt.scope.trim() }
        : {};
    return {
      statementId: stmt.statementId.trim(),
      assessmentId,
      topic: stmt.topic.trim(),
      statement: stmt.statement.trim(),
      normalizedValue: Object.hasOwn(stmt, "normalizedValue")
        ? stmt.normalizedValue
        : stmt.statement.trim(),
      scope,
      evidenceRefs,
      respondentRef,
      createdAt: privateRevision.answeredAt,
      ...(nonEmptyString(stmt.supersedesStatementId)
        ? { supersedesStatementId: stmt.supersedesStatementId.trim() }
        : {}),
      ...needIdentityFor(
        stmt,
        identity.need,
        previous,
        stmt.statementId.trim(),
      ),
      source: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
      resolutionState: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
    };
  });

  return {
    authority:
      CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
    assessmentId,
    contextRevision: privateRevision.contextRevision,
    statements,
    createdByActorRef: respondentRef,
  };
}

function publicActiveQuestion(
  question?: AssessmentInterviewQuestion,
): AssessmentInterviewQuestion | undefined {
  if (!question) {
    return undefined;
  }
  const hasSupportingEvidence = Boolean(
    (question.whyEvidenceRefs && question.whyEvidenceRefs.length > 0) ||
    (question.frontier?.evidenceRefs &&
      question.frontier.evidenceRefs.length > 0) ||
    question.hasSupportingEvidence,
  );
  const frontier = question.frontier
    ? {
        owner: question.frontier.owner,
        materiality: question.frontier.materiality,
        description:
          sanitizePublicText(question.frontier.description) ??
          question.frontier.description,
      }
    : undefined;

  const choices = question.choices?.map((c) => ({
    id: c.id,
    label: sanitizePublicText(c.label) ?? c.label,
    description: sanitizePublicText(c.description),
    requiresFreeText: c.requiresFreeText,
  }));

  return {
    id: question.id,
    needId: question.needId,
    intent: question.intent,
    control: question.control,
    prompt: sanitizePublicText(question.prompt) ?? question.prompt,
    choices,
    priorAnswerSummary: sanitizePublicText(question.priorAnswerSummary),
    proposedInterpretation: sanitizePublicText(question.proposedInterpretation),
    whyAreWeAsking: sanitizePublicText(question.whyAreWeAsking),
    hasSupportingEvidence,
    snippetRef: question.snippetRef,
    frontier,
  };
}

function publicState(
  state: AssessmentInterviewRuntimeState,
): AssessmentInterviewRuntimeState {
  return {
    outcome: state.outcome,
    threadId: state.threadId,
    contextRevision: state.contextRevision,
    contextAuthority: state.contextAuthority,
    assistantMessage: sanitizePublicText(state.assistantMessage),
    activeQuestion: publicActiveQuestion(state.activeQuestion),
    blockedActions: state.blockedActions,
    flags: state.flags,
    orchestrationRequested: state.orchestrationRequested,
    audit: undefined,
    pendingDraft: sanitizePublicText(state.pendingDraft),
    answerHistory: state.answerHistory?.map((item) => ({
      questionId: item.questionId,
      questionPrompt: sanitizePublicText(item.questionPrompt),
      answeredAt: item.answeredAt,
      summary: sanitizePublicText(item.summary) ?? item.summary,
    })),
  };
}

function runtimeEventState(
  state: AssessmentInterviewRuntimeState,
): AssessmentInterviewRuntimeState {
  return { ...publicState(state), pendingDraft: undefined, audit: undefined };
}

function parseAiDiscoverySnippetRef(
  value: unknown,
): AiDiscoverySnippetRef | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  const snapshotId = nonEmptyString(record.snapshot_id)
    ? record.snapshot_id.trim()
    : "";
  const commitSha = nonEmptyString(record.commit_sha)
    ? record.commit_sha.trim()
    : "";
  const filePath = nonEmptyString(record.file_path)
    ? record.file_path.replaceAll("\\", "/").replace(/^\/+/, "")
    : "";
  const startLine = record.start_line;
  const endLine = record.end_line;
  const evidenceHash = nonEmptyString(record.evidence_hash)
    ? record.evidence_hash.trim().toLowerCase()
    : "";
  if (
    !snapshotId ||
    !commitSha ||
    !filePath ||
    filePath.split("/").includes("..") ||
    typeof startLine !== "number" ||
    typeof endLine !== "number" ||
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine - startLine + 1 > 7 ||
    !/^sha256:[0-9a-f]{64}$/.test(evidenceHash) ||
    record.snippet_policy !== "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1"
  ) {
    return undefined;
  }
  return {
    snapshot_id: snapshotId,
    commit_sha: commitSha,
    file_path: filePath,
    symbol: nonEmptyString(record.symbol) ? record.symbol.trim() : undefined,
    start_line: startLine,
    end_line: endLine,
    evidence_hash: evidenceHash,
    snippet_policy: "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
  };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readTechnicalCoverageState(
  value: unknown,
): InterviewTechnicalCoverageState | undefined {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "SUFFICIENT") {
      return INTERVIEW_TECHNICAL_COVERAGE_STATES.ready;
    }
    if (normalized === "LIMITED") {
      return INTERVIEW_TECHNICAL_COVERAGE_STATES.partial;
    }
    if (
      Object.values(INTERVIEW_TECHNICAL_COVERAGE_STATES).includes(
        normalized as InterviewTechnicalCoverageState,
      )
    ) {
      return normalized as InterviewTechnicalCoverageState;
    }
  }
  return undefined;
}
