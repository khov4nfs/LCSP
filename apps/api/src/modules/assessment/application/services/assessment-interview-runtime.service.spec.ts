import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES,
  ASSESSMENT_INTERVIEW_MODES,
  ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES,
  INTERVIEW_FRONTIER_MATERIALITIES,
  INTERVIEW_FRONTIER_OWNERS,
  INTERVIEW_TECHNICAL_CONTRACT_VERSION,
  LEGACY_ASSESSMENT_INTERVIEW_MODES,
  POST_FINDING_RUNTIME_PHASES,
  REMEDIATION_APPROVAL_STATUSES,
  REMEDIATION_DECISIONS,
  type CustomerAnswer,
  type SubmitInterviewAnswerCommand,
  type AssessmentPostFindingRuntimeState,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { INTERVIEW_TECHNICAL_COVERAGE_STATES } from "@lcsp/contracts/audit";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { InterviewAuditService } from "../../../audit/application/services/interview-audit.service.js";
import { AssessmentInterviewRuntimeService } from "./assessment-interview-runtime.service.js";
import { missingInitialPlanningContextDimensions } from "./interview-minimum-planning-context.js";

const TEST_GUIDANCE_VERSION = "interview-context-test-v1";
const RICH_INITIAL_PLANNING_CONTEXT_STATEMENT =
  "The AI model drafts recommendations in the customer onboarding workflow; " +
  "a human reviewer approves every customer-facing action before any status update " +
  "or workflow gate changes, affected subjects are customers and their organizations, " +
  "and the material data sources are customer profile records, support tickets, " +
  "repository code, and business documents.";

function initialPlanningReadyStatements(): Array<{
  topic: string;
  statement: string;
  normalizedValue?: unknown;
}> {
  return [
    {
      topic: "initial_planning_context",
      statement: RICH_INITIAL_PLANNING_CONTEXT_STATEMENT,
      normalizedValue: "rich_initial_planning_context",
    },
  ];
}

function confirmedStructuredContext(input: {
  assessmentId?: string;
  contextRevision?: number;
  topic?: string;
  statement?: string;
  normalizedValue?: unknown;
  statements?: Array<{
    topic: string;
    statement: string;
    normalizedValue?: unknown;
    evidenceRefs?: string[];
  }>;
  source?: string;
  resolutionState?: string;
  evidenceRefs?: string[];
}): Record<string, unknown> {
  const topic = input.topic ?? "decision_authority";
  const statements = input.statements ?? [
    {
      topic,
      statement: input.statement ?? "Human approval is required before action.",
      normalizedValue: input.normalizedValue ?? "human_approval_required",
      evidenceRefs: input.evidenceRefs,
    },
  ];
  return {
    assessmentId: input.assessmentId ?? "assessment-1",
    contextRevision: input.contextRevision ?? 2,
    authority:
      CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
    statements: statements.map((statement, index) => ({
      statementId: `stmt-${statement.topic}-${index}`,
      assessmentId: input.assessmentId ?? "assessment-1",
      topic: statement.topic,
      statement: statement.statement,
      normalizedValue: Object.hasOwn(statement, "normalizedValue")
        ? statement.normalizedValue
        : statement.statement,
      scope: { needId: "need-1" },
      evidenceRefs: statement.evidenceRefs ??
        input.evidenceRefs ?? ["technicalEvidenceReport:report-1"],
      respondentRef: "actor:authenticated:user-1",
      createdAt: "2026-09-05T00:00:00Z",
      source:
        input.source ?? ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
      resolutionState:
        input.resolutionState ??
        ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
    })),
    limitations: ["customer-confirmed current statements only"],
    sourceVersionRef: "snap-1:sha-123456",
    pgeVersion: "report-1:v1",
    guidanceVersion: "guidance-1",
  };
}

function submitAnswerCommand(input: {
  questionId: string;
  expectedSessionRevision?: number;
  clientRequestId?: string;
  answer: CustomerAnswer;
}): SubmitInterviewAnswerCommand {
  return {
    contractVersion: INTERVIEW_TECHNICAL_CONTRACT_VERSION,
    assessmentId: "assessment-1",
    sessionId: "interview:assessment-1",
    questionRef: input.questionId,
    expectedSessionRevision: input.expectedSessionRevision ?? 1,
    clientRequestId:
      input.clientRequestId ?? `client-request-${input.questionId}`,
    answer: input.answer,
  };
}

function initialInterviewThreadFixture(
  revision: Partial<{
    questionId: string;
    answer: Record<string, unknown>;
    questionIntent: string;
    questionControl: string;
  }> = {},
): Record<string, unknown> {
  return {
    assessmentId: "assessment-1",
    contextRevision: 1,
    processedRevision: 0,
    activeQuestionId: revision.questionId ?? "q-1",
    stateJson: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      contextRevision: 1,
    },
    privateContextJson: {
      revisions: [
        {
          questionId: revision.questionId ?? "q-1",
          answer: revision.answer ?? {
            questionId: revision.questionId ?? "q-1",
            selectedChoiceIds: ["yes"],
          },
          actorId: "user-1",
          answeredAt: "2026-09-07T00:00:00.000Z",
          contextRevision: 1,
          priorRevision: 0,
          authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
          questionIntent:
            revision.questionIntent ??
            ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          questionControl:
            revision.questionControl ?? ASSESSMENT_INTERVIEW_CONTROLS.boolean,
          sourceVersion: "snap-1:sha-123456",
          pgeVersion: "report-1:v1",
          governedEvidenceRefs: [],
        },
      ],
      workflowRunId: "10000000-0000-4000-8000-000000000002",
      partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
    },
    sourceVersion: "snap-1:sha-123456",
    pgeVersion: "report-1:v1",
  };
}

function targetedResolutionThreadFixture(): Record<string, unknown> {
  return {
    assessmentId: "assessment-1",
    contextRevision: 2,
    processedRevision: 1,
    activeQuestionId: null,
    stateJson: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      contextRevision: 2,
    },
    privateContextJson: {
      revisions: [
        {
          questionId: "q-1",
          answer: { questionId: "q-1", confirmed: true },
          actorId: "user-1",
          answeredAt: new Date().toISOString(),
          contextRevision: 2,
          priorRevision: 1,
          authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
          questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          questionControl: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          sourceVersion: "snap-1:sha-123456",
          pgeVersion: "report-1:v1",
          governedEvidenceRefs: [],
        },
      ],
      targetedNeed: {
        needId: "need-1",
        businessContextNeed: "Who approves this action?",
        resolutionCriteria: ["decision_authority"],
        originatingInvestigationReference: "inv-ref-1",
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      },
      targetedContinuation: {
        originatingInvestigationReference: "inv-ref-1",
        investigatorExecutionId: "exec-1",
        workflowRunId: "10000000-0000-4000-8000-000000000001",
        checkpointId: "cp-1",
        affectedRuleIds: ["ENG-1"],
        artifactVersions: {
          technicalEvidenceReportId: "report-1",
          repositorySnapshotId: "snap-1",
          legalRuleCatalogVersionId: "catalog-1",
          legalCorpusVersionId: "corpus-1",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      },
    },
    sourceVersion: "snap-1:sha-123456",
    pgeVersion: "report-1:v1",
  };
}

function partialCoveragePolicyDecision(overrides?: {
  permittedForInterview?: boolean;
  limitations?: string[];
}): Record<string, unknown> {
  return {
    policyDecisionRef: "coverage-policy:assessment-1:report-pinned",
    policyVersion: "partial-coverage-policy-v1",
    permittedForInterview: overrides?.permittedForInterview ?? true,
    limitations: overrides?.limitations ?? [
      "dynamic routing was not statically resolved",
    ],
  };
}

function readyTechnicalEvidenceReport(): Record<string, unknown> {
  return {
    id: "report-1",
    schemaVersion: "v1",
    evidencePayload: {
      technicalCoverageState: INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
      partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
    },
  };
}

function targetedNeedRegistrationPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    actorId: "investigator-1",
    needId: "need-data-residency",
    businessContextNeed: "Clarify cloud provider region",
    resolutionCriteria: ["Customer specifies AWS or GCP region"],
    whyNeeded: "This determines the operational deployment location.",
    governedEvidenceRefs: ["evidence:region-config"],
    originatingInvestigationReference: "inv-ref-404",
    investigatorExecutionId: "exec-1",
    workflowRunId: "10000000-0000-4000-8000-000000000010",
    checkpointId: "cp-1",
    affectedRuleIds: ["rule-1"],
    artifactVersions: {
      technicalEvidenceReportId: "report-1",
      repositorySnapshotId: "snap-1",
      legalRuleCatalogVersionId: "catalog-1",
      legalCorpusVersionId: "corpus-1",
    },
    ...overrides,
  };
}

type MockPrismaDelegates = {
  $queryRaw: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  $executeRaw: jest.Mock<(...args: unknown[]) => Promise<number>>;
  assessment: {
    findUnique: jest.Mock<() => Promise<{ id: string; ownerId: string }>>;
  };
  assessmentInterviewThread: {
    findUnique: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    updateMany: jest.Mock<(...args: unknown[]) => Promise<{ count: number }>>;
    upsert: jest.Mock<(...args: unknown[]) => Promise<Record<string, unknown>>>;
  };
  repositorySnapshot: {
    findFirst: jest.Mock<() => Promise<{ id: string; commitSha: string }>>;
  };
  technicalEvidenceReport: {
    findFirst: jest.Mock<
      () => Promise<{
        id: string;
        schemaVersion: string;
        evidencePayload: {
          technicalCoverageState?: string;
          coverageLimitations?: string[];
          [key: string]: unknown;
        };
      }>
    >;
  };
};

type MockOutboxRepository = {
  enqueue: jest.Mock<(...args: unknown[]) => Promise<string>>;
};

type MockInterviewAudit = {
  recordQuestionPersisted: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordCustomerAnswer: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordContextRevisionCreated: jest.Mock<
    (...args: unknown[]) => Promise<void>
  >;
  recordInterviewOutcome: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordTargetedClarification: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordDownstreamImpact: jest.Mock<(...args: unknown[]) => Promise<void>>;
};

type MockRuntimeEvents = {
  recordToolStarted: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordToolWaitingInput: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordToolCompleted: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordToolFailed: jest.Mock<(...args: unknown[]) => Promise<void>>;
  getLatestPostFindingState: jest.Mock<
    () => Promise<AssessmentPostFindingRuntimeState | null>
  >;
};

describe("AssessmentInterviewRuntimeService Audit & Provenance Emission", () => {
  let service: AssessmentInterviewRuntimeService;
  let mockTransaction: jest.Mock<
    (
      callback: (tx: MockPrismaDelegates) => Promise<unknown>,
      options?: unknown,
    ) => Promise<unknown>
  >;
  const findHistoricalQuestion =
    jest.fn<
      (
        ...args: unknown[]
      ) => Promise<{ payload: Record<string, unknown> } | null>
    >();
  let mockTx: MockPrismaDelegates;
  let mockOutboxRepository: MockOutboxRepository;
  let mockInterviewAudit: MockInterviewAudit;
  let mockInterviewGuidanceResolver: {
    resolveActiveGuidanceVersion: jest.Mock<() => string>;
  };
  let mockRuntimeEvents: MockRuntimeEvents;

  it("projects the author's stored answer with redaction instead of the generic history summary", async () => {
    const thread = targetedResolutionThreadFixture();
    const timestamp = "2026-09-09T00:00:00.000Z";
    const store = thread.privateContextJson as {
      revisions: Record<string, unknown>[];
    };
    store.revisions[0].answeredAt = timestamp;
    store.revisions[0].answer = {
      questionId: "q-1",
      freeText: 'Original answer\napi_key="sensitive"',
    };
    thread.stateJson = {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      answerHistory: [
        {
          questionId: "q-1",
          answeredAt: timestamp,
          summary: "Generic summary",
        },
      ],
    };
    mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(thread);
    findHistoricalQuestion.mockResolvedValue({
      payload: {
        prompt: "What does workflow gating block?",
        whyEvidenceRefs: ["private-ref"],
      },
    });
    const actor = {
      userId: "user-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: "assessment:assessment-1",
    };
    const state = await service.getState("assessment-1", actor);
    expect(state.answerHistory?.[0].summary).toContain("Original answer");
    expect(state.answerHistory?.[0].questionPrompt).toBe(
      "What does workflow gating block?",
    );
    expect(state.answerHistory?.[0]).not.toHaveProperty("whyEvidenceRefs");
    expect(findHistoricalQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          resourceId: "assessment-1",
          sessionId: "interview:assessment-1",
          payload: { path: ["questionId"], equals: "q-1" },
        }),
      }),
    );
    expect(state.answerHistory?.[0].summary).not.toContain("sensitive");
    expect(state.answerHistory?.[0]).not.toHaveProperty("actorId");
    store.revisions[0].answer = {
      questionId: "q-1",
      selectedChoiceIds: ["internal"],
      comment:
        'A mix of internal advice and external sharing.\napi_key="sensitive"',
    };
    findHistoricalQuestion.mockResolvedValue({
      payload: {
        prompt: "How are results used?",
        questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        choices: [
          { id: "internal", label: "Internal advice" },
          { id: "external", label: "External sharing" },
        ],
        whyEvidenceRefs: ["private-ref"],
      },
    });
    const selection = (await service.getState("assessment-1", actor))
      .answerHistory?.[0];
    expect(selection?.selectedChoiceIds).toEqual(["internal"]);
    expect(selection?.comment).toContain(
      "A mix of internal advice and external sharing.",
    );
    expect(selection?.comment).not.toContain("sensitive");
    store.revisions[0].answer = {
      questionId: "q-1",
      selectedChoiceIds: ["internal"],
      otherText: "Previously saved supplementary text.",
    };
    expect(
      (await service.getState("assessment-1", actor)).answerHistory?.[0]
        .comment,
    ).toBe("Previously saved supplementary text.");
    expect(selection?.question?.choices).toHaveLength(2);
    expect(selection?.question).not.toHaveProperty("whyEvidenceRefs");
    store.revisions[0].actorId = "another-user";
    expect(
      (await service.getState("assessment-1", actor)).answerHistory?.[0]
        .comment,
    ).toBeUndefined();
    expect(
      (await service.getState("assessment-1", actor)).answerHistory?.[0]
        .selectedChoiceIds,
    ).toBeUndefined();
    expect(
      (await service.getState("assessment-1", actor)).answerHistory?.[0]
        .summary,
    ).toBe("Generic summary");
  });

  it("keeps snippet provenance private while resolving it for authorized callers", async () => {
    const snippetRef = {
      snapshot_id: "snap-1",
      commit_sha: "sha-123456",
      file_path: "src/ai.ts",
      start_line: 42,
      end_line: 42,
      evidence_hash: "sha256:" + "a".repeat(64),
      snippet_policy: "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
    };
    mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
      assessmentId: "assessment-1",
      contextRevision: 1,
      processedRevision: 0,
      activeQuestionId: "q-1",
      stateJson: {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: "q-1",
          prompt: "Where is AI used?",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          whyEvidenceRefs: ["technicalEvidenceReport:report-1"],
          snippetRef,
        },
      },
      privateContextJson: { revisions: [] },
      sourceVersion: "snap-1:sha-123456",
      pgeVersion: "report-1:v1",
    });
    const actor = {
      userId: "user-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: "assessment:assessment-1",
    };

    const publicState = await service.getState("assessment-1", actor);
    expect(publicState.activeQuestion).not.toHaveProperty("whyEvidenceRefs");
    expect(publicState.activeQuestion?.snippetRef).toEqual(snippetRef);

    await expect(
      service.resolveActiveQuestionSnippetContext("assessment-1", "q-1", actor),
    ).resolves.toEqual({ evidenceReportId: "report-1", snippetRef });
    await expect(
      service.resolveActiveQuestionSnippetContext(
        "assessment-1",
        "wrong-q",
        actor,
      ),
    ).rejects.toMatchObject({
      response: { code: "INTERVIEW_SOURCE_SNIPPET_UNAVAILABLE" },
    });
  });

  beforeEach(() => {
    findHistoricalQuestion.mockReset().mockResolvedValue(null);
    mockTx = {
      $queryRaw: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue([]),
      $executeRaw: jest
        .fn<(...args: unknown[]) => Promise<number>>()
        .mockResolvedValue(1),
      assessment: {
        findUnique: jest
          .fn<() => Promise<{ id: string; ownerId: string }>>()
          .mockResolvedValue({
            id: "assessment-1",
            ownerId: "user-1",
          }),
      },
      assessmentInterviewThread: {
        findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
        updateMany: jest
          .fn<(...args: unknown[]) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
        upsert: jest
          .fn<(...args: unknown[]) => Promise<Record<string, unknown>>>()
          .mockResolvedValue({}),
      },
      repositorySnapshot: {
        findFirst: jest
          .fn<() => Promise<{ id: string; commitSha: string }>>()
          .mockResolvedValue({
            id: "snap-1",
            commitSha: "sha-123456",
          }),
      },
      technicalEvidenceReport: {
        findFirst: jest
          .fn<
            () => Promise<{
              id: string;
              schemaVersion: string;
              evidencePayload: {
                technicalCoverageState: string;
                coverageLimitations: string[];
              };
            }>
          >()
          .mockResolvedValue({
            id: "report-1",
            schemaVersion: "v1",
            evidencePayload: {
              technicalCoverageState: "READY",
              coverageLimitations: [],
            },
          }),
      },
    };

    mockTransaction = jest.fn(
      async <T>(
        cb: (tx: MockPrismaDelegates) => Promise<T>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _options?: unknown,
      ): Promise<T> => cb(mockTx),
    );
    const mockPrisma = {
      auditEvent: { findFirst: findHistoricalQuestion },
      ...mockTx,
      $transaction: mockTransaction,
    };

    mockOutboxRepository = {
      enqueue: jest
        .fn<(...args: unknown[]) => Promise<string>>()
        .mockResolvedValue("outbox-1"),
    };

    mockRuntimeEvents = {
      recordToolStarted: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordToolWaitingInput: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordToolCompleted: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordToolFailed: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      getLatestPostFindingState: jest
        .fn<() => Promise<AssessmentPostFindingRuntimeState | null>>()
        .mockResolvedValue(null),
    };

    mockInterviewAudit = {
      recordQuestionPersisted: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordCustomerAnswer: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordContextRevisionCreated: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordInterviewOutcome: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordTargetedClarification: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      recordDownstreamImpact: jest
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    };

    mockInterviewGuidanceResolver = {
      resolveActiveGuidanceVersion: jest
        .fn<() => string>()
        .mockReturnValue(TEST_GUIDANCE_VERSION),
    };

    service = new AssessmentInterviewRuntimeService(
      mockPrisma as unknown as PrismaService,
      mockRuntimeEvents as unknown as AssessmentRuntimeEventService,
      mockOutboxRepository as unknown as OutboxRepository,
      mockInterviewAudit as unknown as InterviewAuditService,
    );
    Object.defineProperty(service, "guidanceResolver", {
      configurable: true,
      value: mockInterviewGuidanceResolver,
    });
  });

  describe("submitPostFindingDecision", () => {
    it("persists the stable remediation decision through runtime events", async () => {
      mockRuntimeEvents.getLatestPostFindingState.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        phase: POST_FINDING_RUNTIME_PHASES.needsInput,
        codeReviewActivities: [
          {
            id: "review-1",
            label: "Code review completed",
            status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
          },
        ],
        decisionAvailability: [
          REMEDIATION_DECISIONS.updateGithubPat,
          REMEDIATION_DECISIONS.continueDetectedPr,
          REMEDIATION_DECISIONS.createRemediationPr,
        ],
        approvalStatus: REMEDIATION_APPROVAL_STATUSES.pendingCustomer,
        verificationActivities: [],
      });

      const result = await service.submitPostFindingDecision({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "customer-1",
        },
        correlationId: "corr-post-finding-1",
        decision: {
          decision: REMEDIATION_DECISIONS.continueDetectedPr,
        },
      });

      expect(result.selectedDecision).toBe(
        REMEDIATION_DECISIONS.continueDetectedPr,
      );
      expect(result.phase).toBe(POST_FINDING_RUNTIME_PHASES.existingPr);
      expect(mockRuntimeEvents.recordToolWaitingInput).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          correlationId: "corr-post-finding-1",
          inputSummary: {
            decision: REMEDIATION_DECISIONS.continueDetectedPr,
          },
          outputSummary: {
            postFinding: expect.objectContaining({
              selectedDecision: REMEDIATION_DECISIONS.continueDetectedPr,
              phase: POST_FINDING_RUNTIME_PHASES.existingPr,
            }),
          },
        }),
      );
    });
  });

  describe("submitAnswer", () => {
    it("atomically records customer answer and context revision audit events in the same transaction", async () => {
      const activeState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 1,
        activeQuestion: {
          id: "q-1",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          prompt: "Please confirm the current interpretation.",
          control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          proposedInterpretation: "Data remains in the selected region.",
          choices: [
            { id: "CONFIRM", label: "Confirm" },
            { id: "ADJUST", label: "Adjust", requiresFreeText: true },
          ],
        },
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-1",
        stateJson: activeState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.submitAnswer({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-submit-1",
        answer: submitAnswerCommand({
          questionId: "q-1",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
            action: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm,
          },
        }),
      });

      expect(result.contextRevision).toBe(2);
      expect(mockInterviewAudit.recordCustomerAnswer).toHaveBeenCalledTimes(1);
      expect(mockInterviewAudit.recordCustomerAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          questionId: "q-1",
          questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          responseMode: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          responseAction: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm,
          sessionId: "interview:assessment-1",
          threadId: "interview:assessment-1",
          turnId: 2,
          sourceSnapshot: expect.objectContaining({
            snapshotId: "snap-1",
            commitSha: "sha-123456",
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
            technicalCoverageState: "READY",
            coverageLimitations: [],
            guidanceVersion: TEST_GUIDANCE_VERSION,
          }),
        }),
        mockTx,
      );

      expect(
        mockInterviewAudit.recordContextRevisionCreated,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockInterviewAudit.recordContextRevisionCreated,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          contextRevision: 2,
          priorRevision: 1,
          authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
          statementKey: "q-1",
          sessionId: "interview:assessment-1",
          threadId: "interview:assessment-1",
          turnId: 2,
        }),
        mockTx,
      );
    });

    it("rejects confirm-only answers for FREE_TEXT and requires text for CONFIRM_ADJUST adjustments", async () => {
      const threadFor = (
        activeQuestion: NonNullable<
          AssessmentInterviewRuntimeState["activeQuestion"]
        >,
      ) => ({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: activeQuestion.id,
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 1,
          activeQuestion,
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });
      const submit = (input: { questionId: string; answer: CustomerAnswer }) =>
        service.submitAnswer({
          assessmentId: "assessment-1",
          actor: {
            userId: "user-1",
            sessionId: "session-1",
            role: AUTH_USER_ROLES.customer,
            scope: "assessment:assessment-1",
          },
          correlationId: "corr-submit-control",
          answer: submitAnswerCommand(input),
        });

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        threadFor({
          id: "q-free-text",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "Describe the business purpose.",
          control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        }),
      );
      await expect(
        submit({
          questionId: "q-free-text",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
            action: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm,
          },
        }),
      ).rejects.toMatchObject({
        response: { code: "INTERVIEW_ANSWER_CONTROL_INVALID" },
      });

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        threadFor({
          id: "q-confirm-adjust",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          prompt: "Please confirm the current interpretation.",
          control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          proposedInterpretation: "A manager approves before action.",
          choices: [
            { id: "CONFIRM", label: "Confirm" },
            { id: "ADJUST", label: "Adjust", requiresFreeText: true },
          ],
        }),
      );
      await expect(
        submit({
          questionId: "q-confirm-adjust",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
            action: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust,
            adjustmentText: "",
          },
        }),
      ).rejects.toMatchObject({
        response: { code: "INTERVIEW_ANSWER_INVALID" },
      });

      const adjusted = await submit({
        questionId: "q-confirm-adjust",
        answer: {
          kind: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          action: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust,
          adjustmentText: "A senior manager approves before action.",
        },
      });
      expect(adjusted.contextRevision).toBe(2);
      expect(mockInterviewAudit.recordCustomerAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          responseMode: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          responseAction: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.adjust,
        }),
        mockTx,
      );
    });

    it("preserves BOOLEAN question control as responseMode for boolean answers", async () => {
      const activeState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 1,
        activeQuestion: {
          id: "q-bool",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "Is encryption enabled?",
          control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
          choices: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-bool",
        stateJson: activeState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.submitAnswer({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-submit-bool",
        answer: submitAnswerCommand({
          questionId: "q-bool",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
            value: true,
          },
        }),
      });

      expect(result.contextRevision).toBe(2);
      expect(mockInterviewAudit.recordCustomerAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: "q-bool",
          responseMode: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
          answerValue: ["yes"],
        }),
        mockTx,
      );
    });

    it("preserves MULTI_SELECT question control as responseMode for multi-select answers", async () => {
      const activeState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 1,
        activeQuestion: {
          id: "q-multi",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "Select compliance frameworks",
          control: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
          choices: [
            { id: "soc2", label: "SOC 2" },
            { id: "iso27001", label: "ISO 27001" },
          ],
        },
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-multi",
        stateJson: activeState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.submitAnswer({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-submit-multi",
        answer: submitAnswerCommand({
          questionId: "q-multi",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
            values: ["soc2", "iso27001"],
          },
        }),
      });

      expect(result.contextRevision).toBe(2);
      expect(mockInterviewAudit.recordCustomerAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: "q-multi",
          responseMode: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
          answerValue: ["soc2", "iso27001"],
        }),
        mockTx,
      );
    });

    it("accepts canonical SINGLE_SELECT Other comments and persists them for resume", async () => {
      const activeState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 1,
        activeQuestion: {
          id: "q-single-other",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "Select the deployment model.",
          control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
          choices: [
            { id: "standard", label: "Standard" },
            { id: "other", label: "Other", requiresFreeText: true },
          ],
        },
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-single-other",
        stateJson: activeState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.submitAnswer({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-submit-single-other",
        answer: submitAnswerCommand({
          questionId: "q-single-other",
          clientRequestId: "client-request-single-other",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
            value: "other",
            comment: "Hosted in a customer-managed region.",
          },
        }),
      });

      expect(result.contextRevision).toBe(2);
      expect(result.answerHistory).toEqual([
        expect.objectContaining({
          questionId: "q-single-other",
          summary: "Customer selected 1 option(s).",
          questionPrompt: "Select the deployment model.",
        }),
      ]);
      expect(mockTx.assessmentInterviewThread.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            privateContextJson: expect.objectContaining({
              revisions: [
                expect.objectContaining({
                  questionId: "q-single-other",
                  answer: expect.objectContaining({
                    selectedChoiceIds: ["other"],
                    comment: "Hosted in a customer-managed region.",
                  }),
                }),
              ],
            }),
          }),
        }),
      );
    });

    it("accepts canonical MULTI_SELECT Other comments and persists them for resume", async () => {
      const activeState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 1,
        activeQuestion: {
          id: "q-multi-other",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "Select compliance frameworks.",
          control: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
          choices: [
            { id: "soc2", label: "SOC 2" },
            { id: "other", label: "Other", requiresFreeText: true },
          ],
        },
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-multi-other",
        stateJson: activeState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.submitAnswer({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-submit-multi-other",
        answer: submitAnswerCommand({
          questionId: "q-multi-other",
          clientRequestId: "client-request-multi-other",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
            values: ["soc2", "other"],
            comment: "PCI DSS also applies to this flow.",
          },
        }),
      });

      expect(result.contextRevision).toBe(2);
      expect(result.answerHistory).toEqual([
        expect.objectContaining({
          questionId: "q-multi-other",
          summary: "Customer selected 2 option(s).",
          questionPrompt: "Select compliance frameworks.",
        }),
      ]);
      expect(mockTx.assessmentInterviewThread.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            privateContextJson: expect.objectContaining({
              revisions: [
                expect.objectContaining({
                  questionId: "q-multi-other",
                  answer: expect.objectContaining({
                    selectedChoiceIds: ["soc2", "other"],
                    comment: "PCI DSS also applies to this flow.",
                  }),
                }),
              ],
            }),
          }),
        }),
      );
    });

    it("accepts canonical SubmitInterviewAnswerCommand and persists the clientRequestId fingerprint", async () => {
      const activeState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 1,
        activeQuestion: {
          id: "q-canonical-bool",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "Is human review required?",
          control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
          choices: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-canonical-bool",
        stateJson: activeState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.submitAnswer({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-submit-canonical",
        answer: {
          ...submitAnswerCommand({
            questionId: "q-canonical-bool",
            clientRequestId: "client-request-1",
            answer: {
              kind: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
              value: true,
            },
          }),
        },
      });

      expect(result.contextRevision).toBe(2);
      expect(mockTx.assessmentInterviewThread.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            privateContextJson: expect.objectContaining({
              submittedAnswerRequests: [
                expect.objectContaining({
                  clientRequestId: "client-request-1",
                  questionId: "q-canonical-bool",
                  contextRevision: 2,
                }),
              ],
            }),
          }),
        }),
      );
      expect(mockInterviewAudit.recordCustomerAnswer).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: "q-canonical-bool",
          responseMode: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
          answerValue: ["yes"],
        }),
        mockTx,
      );
    });

    it("rejects stale canonical expectedSessionRevision before mutating the thread", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: "q-stale",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
          activeQuestion: {
            id: "q-stale",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
            prompt: "Describe purpose.",
            control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          },
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await expect(
        service.submitAnswer({
          assessmentId: "assessment-1",
          actor: {
            userId: "user-1",
            sessionId: "session-1",
            role: AUTH_USER_ROLES.customer,
            scope: "assessment:assessment-1",
          },
          correlationId: "corr-submit-stale-revision",
          answer: {
            contractVersion: "interview-technical-contract-v1.0.0",
            assessmentId: "assessment-1",
            sessionId: "interview:assessment-1",
            questionRef: "q-stale",
            expectedSessionRevision: 1,
            clientRequestId: "client-request-stale",
            answer: {
              kind: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
              text: "Business purpose answer.",
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_SESSION_REVISION_STALE" },
        },
      });
      expect(
        mockTx.assessmentInterviewThread.updateMany,
      ).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordCustomerAnswer).not.toHaveBeenCalled();
    });

    it("returns the persisted state for duplicate canonical delivery without replaying side effects", async () => {
      const persistedState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 2,
        answerHistory: [
          {
            questionId: "q-idempotent",
            answeredAt: "2026-09-08T00:00:00.000Z",
            actorId: "user-1",
            summary: "Customer supplied free-text Interview context.",
          },
        ],
      };
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: null,
        stateJson: persistedState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          submittedAnswerRequests: [
            {
              clientRequestId: "client-request-idempotent",
              payloadFingerprint:
                '{"answer":{"freeText":"Business purpose answer.","questionId":"q-idempotent"},"assessmentId":"assessment-1","expectedSessionRevision":1,"questionRef":"q-idempotent","sessionId":"interview:assessment-1"}',
              questionId: "q-idempotent",
              contextRevision: 2,
              recordedAt: "2026-09-08T00:00:00.000Z",
            },
          ],
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.submitAnswer({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-submit-duplicate",
        answer: {
          contractVersion: "interview-technical-contract-v1.0.0",
          assessmentId: "assessment-1",
          sessionId: "interview:assessment-1",
          questionRef: "q-idempotent",
          expectedSessionRevision: 1,
          clientRequestId: "client-request-idempotent",
          answer: {
            kind: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
            text: "Business purpose answer.",
          },
        },
      });

      expect(result.contextRevision).toBe(2);
      expect(result.answerHistory?.[0]?.actorId).toBeUndefined();
      expect(
        mockTx.assessmentInterviewThread.updateMany,
      ).not.toHaveBeenCalled();
      expect(mockOutboxRepository.enqueue).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordCustomerAnswer).not.toHaveBeenCalled();
    });

    it("rejects a reused canonical clientRequestId with a different payload", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: null,
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          submittedAnswerRequests: [
            {
              clientRequestId: "client-request-conflict",
              payloadFingerprint: '{"answer":"original"}',
              questionId: "q-idempotent",
              contextRevision: 2,
              recordedAt: "2026-09-08T00:00:00.000Z",
            },
          ],
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await expect(
        service.submitAnswer({
          assessmentId: "assessment-1",
          actor: {
            userId: "user-1",
            sessionId: "session-1",
            role: AUTH_USER_ROLES.customer,
            scope: "assessment:assessment-1",
          },
          correlationId: "corr-submit-idempotency-conflict",
          answer: {
            contractVersion: "interview-technical-contract-v1.0.0",
            assessmentId: "assessment-1",
            sessionId: "interview:assessment-1",
            questionRef: "q-idempotent",
            expectedSessionRevision: 1,
            clientRequestId: "client-request-conflict",
            answer: {
              kind: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
              text: "Different business purpose.",
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_ANSWER_IDEMPOTENCY_CONFLICT" },
        },
      });
      expect(
        mockTx.assessmentInterviewThread.updateMany,
      ).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordCustomerAnswer).not.toHaveBeenCalled();
    });
  });

  describe("recordBlockedAction", () => {
    it("atomically records blocked interview outcome in transaction", async () => {
      const currentState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 2,
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: "q-1",
        stateJson: currentState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.recordBlockedAction({
        assessmentId: "assessment-1",
        actor: {
          userId: "user-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-1",
        },
        correlationId: "corr-blocked-1",
        blocked: {
          action: ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
        },
      });

      expect(result.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
      );
      expect(mockInterviewAudit.recordInterviewOutcome).toHaveBeenCalledTimes(
        1,
      );
      expect(mockInterviewAudit.recordInterviewOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
          contextRevision: 2,
          sessionId: "interview:assessment-1",
          threadId: "interview:assessment-1",
        }),
        mockTx,
      );
    });
  });

  describe("registerTargetedNeedForWorker", () => {
    it("atomically records targeted clarification started in transaction", async () => {
      const readyState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextRevision: 2,
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: readyState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: "READY",
          coverageLimitations: [],
          programEvidenceGraph: {
            coverage_state: "SUFFICIENT",
            coverage_notes: [],
            evidence_refs: ["evidence:region-config"],
            nodes: [],
            edges: [],
          },
        },
      });

      await service.registerTargetedNeedForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-target-1",
        target: {
          actorId: "investigator-1",
          needId: "need-data-residency",
          businessContextNeed: "Clarify cloud provider region",
          resolutionCriteria: ["Customer specifies AWS or GCP region"],
          whyNeeded: "This determines the operational deployment location.",
          governedEvidenceRefs: ["evidence:region-config"],
          originatingInvestigationReference: "inv-ref-404",
          investigatorExecutionId: "exec-1",
          workflowRunId: "10000000-0000-4000-8000-000000000010",
          checkpointId: "cp-1",
          affectedRuleIds: ["rule-1"],
          artifactVersions: {
            technicalEvidenceReportId: "report-1",
            repositorySnapshotId: "snap-1",
            legalRuleCatalogVersionId: "catalog-1",
            legalCorpusVersionId: "corpus-1",
          },
        },
      });

      expect(
        mockTx.assessmentInterviewThread.upsert as jest.Mock<
          (input: unknown) => Promise<Record<string, unknown>>
        >,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            privateContextJson: expect.objectContaining({
              workflowRunId: "10000000-0000-4000-8000-000000000001",
              targetedNeed: expect.objectContaining({
                needId: "need-data-residency",
                businessContextNeed: "Clarify cloud provider region",
                resolutionCriteria: ["Customer specifies AWS or GCP region"],
                whyNeeded:
                  "This determines the operational deployment location.",
                governedEvidenceRefs: ["evidence:region-config"],
              }),
              targetedContinuation: expect.objectContaining({
                investigatorExecutionId: "exec-1",
                workflowRunId: "10000000-0000-4000-8000-000000000010",
                checkpointId: "cp-1",
                affectedRuleIds: ["rule-1"],
                artifactVersions: {
                  technicalEvidenceReportId: "report-1",
                  repositorySnapshotId: "snap-1",
                  legalRuleCatalogVersionId: "catalog-1",
                  legalCorpusVersionId: "corpus-1",
                },
              }),
            }),
          }),
        }),
      );
      expect(mockOutboxRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(mockOutboxRepository.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "command.assessment-interview.resume-agent.v1",
        }),
        mockTx,
      );

      expect(
        mockInterviewAudit.recordTargetedClarification,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockInterviewAudit.recordTargetedClarification,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          originatingInvestigationReference: "inv-ref-404",
          sessionId: "interview:assessment-1",
          threadId: "interview:assessment-1",
          runId: "10000000-0000-4000-8000-000000000010",
          sourceSnapshot: expect.objectContaining({
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
            technicalCoverageState: "READY",
          }),
        }),
        mockTx,
      );
    });

    it("treats retry of the same targeted need as an idempotent success", async () => {
      const waitingState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 2,
        orchestrationRequested: true,
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: waitingState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          targetedNeed: {
            needId: "need-data-residency",
            businessContextNeed: "Clarify cloud provider region",
            resolutionCriteria: ["Customer specifies AWS or GCP region"],
            whyNeeded: "This determines the operational deployment location.",
            governedEvidenceRefs: ["evidence:region-config"],
            originatingInvestigationReference: "inv-ref-404",
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
          },
          targetedContinuation: {
            originatingInvestigationReference: "inv-ref-404",
            investigatorExecutionId: "exec-1",
            workflowRunId: "10000000-0000-4000-8000-000000000010",
            checkpointId: "cp-1",
            affectedRuleIds: ["rule-1"],
            artifactVersions: {
              technicalEvidenceReportId: "report-1",
              repositorySnapshotId: "snap-1",
              legalRuleCatalogVersionId: "catalog-1",
              legalCorpusVersionId: "corpus-1",
            },
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
          },
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await expect(
        service.registerTargetedNeedForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-target-retry",
          target: targetedNeedRegistrationPayload() as never,
        }),
      ).resolves.toEqual(waitingState);

      expect(mockTx.technicalEvidenceReport.findFirst).not.toHaveBeenCalled();
      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockOutboxRepository.enqueue).not.toHaveBeenCalled();
      expect(
        mockInterviewAudit.recordTargetedClarification,
      ).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("retries a transient expired transaction and returns success instead of a callback failure", async () => {
      const readyState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextRevision: 2,
      };
      const readyThread = {
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: readyState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      };
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        readyThread,
      );
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: "READY",
          coverageLimitations: [],
          programEvidenceGraph: {
            coverage_state: "SUFFICIENT",
            coverage_notes: [],
            evidence_refs: ["evidence:region-config"],
            nodes: [],
            edges: [],
          },
        },
      });
      const expiredTransaction = new Error(
        "Transaction API error: A query cannot be executed on an expired transaction. timeout: 5000 ms",
      );
      mockTransaction.mockImplementationOnce(() =>
        Promise.reject(expiredTransaction),
      );

      const result = await service.registerTargetedNeedForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-target-transient",
        target: targetedNeedRegistrationPayload() as never,
      });

      expect(result.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      );
      expect(mockTransaction).toHaveBeenCalledTimes(2);
      expect(mockTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ timeout: 15_000, maxWait: 5_000 }),
      );
      expect(mockTx.assessmentInterviewThread.upsert).toHaveBeenCalledTimes(1);
      expect(mockOutboxRepository.enqueue).toHaveBeenCalledTimes(1);
      expect(
        mockInterviewAudit.recordTargetedClarification,
      ).toHaveBeenCalledTimes(1);
      expect(mockRuntimeEvents.recordToolWaitingInput).toHaveBeenCalledTimes(1);
      expect(mockRuntimeEvents.recordToolWaitingInput).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          toolName: "assessment_interview",
          waitingReason: ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewStarted,
        }),
      );
    });

    it("treats a concurrent duplicate registration observed under the lock as idempotent", async () => {
      const readyState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextRevision: 2,
      };
      const waitingState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 2,
        orchestrationRequested: true,
      };
      const readyThread = {
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: readyState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      };
      const concurrentlyRegisteredThread = {
        ...readyThread,
        stateJson: waitingState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          targetedNeed: {
            needId: "need-data-residency",
            businessContextNeed: "Clarify cloud provider region",
            resolutionCriteria: ["Customer specifies AWS or GCP region"],
            whyNeeded: "This determines the operational deployment location.",
            governedEvidenceRefs: ["evidence:region-config"],
            originatingInvestigationReference: "inv-ref-404",
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
          },
          targetedContinuation: {
            originatingInvestigationReference: "inv-ref-404",
            investigatorExecutionId: "exec-1",
            workflowRunId: "10000000-0000-4000-8000-000000000010",
            checkpointId: "cp-1",
            affectedRuleIds: ["rule-1"],
            artifactVersions: {
              technicalEvidenceReportId: "report-1",
              repositorySnapshotId: "snap-1",
              legalRuleCatalogVersionId: "catalog-1",
              legalCorpusVersionId: "corpus-1",
            },
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
          },
        },
      };
      mockTx.assessmentInterviewThread.findUnique
        .mockResolvedValueOnce(readyThread)
        .mockResolvedValueOnce(concurrentlyRegisteredThread);
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: "READY",
          coverageLimitations: [],
          programEvidenceGraph: {
            coverage_state: "SUFFICIENT",
            coverage_notes: [],
            evidence_refs: ["evidence:region-config"],
            nodes: [],
            edges: [],
          },
        },
      });

      const result = await service.registerTargetedNeedForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-target-concurrent",
        target: targetedNeedRegistrationPayload() as never,
      });

      expect(result.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      );
      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockOutboxRepository.enqueue).not.toHaveBeenCalled();
      expect(
        mockInterviewAudit.recordTargetedClarification,
      ).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("rejects incomplete targeted needs and missing immutable artifact pins", async () => {
      const readyState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        contextRevision: 2,
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: readyState,
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await expect(
        service.registerTargetedNeedForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-target-invalid",
          target: {
            actorId: "investigator-1",
            needId: "need-invalid",
            businessContextNeed: "Clarify deployment owner",
            resolutionCriteria: ["deployment_owner"],
            originatingInvestigationReference: "inv-ref-invalid",
            investigatorExecutionId: "exec-invalid",
            workflowRunId: "run-invalid",
            checkpointId: "cp-invalid",
            affectedRuleIds: ["rule-1"],
            artifactVersions: {
              technicalEvidenceReportId: "report-1",
              repositorySnapshotId: "snap-1",
            },
          },
        }),
      ).rejects.toMatchObject({
        response: { code: "INTERVIEW_TARGETED_NEED_INVALID" },
      });
    });

    it("rejects non-neutral customer-facing targeted need text", async () => {
      await expect(
        service.registerTargetedNeedForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-target-leak",
          target: {
            actorId: "investigator-1",
            needId: "need-leak",
            businessContextNeed: "Clarify EngineeringRule ENG-7 handling",
            resolutionCriteria: ["risk category for EU AI Act"],
            originatingInvestigationReference: "inv-ref-leak",
            investigatorExecutionId: "exec-leak",
            workflowRunId: "20000000-0000-4000-8000-000000000001",
            checkpointId: "cp-leak",
            affectedRuleIds: ["ENG-7"],
            artifactVersions: {
              technicalEvidenceReportId: "report-1",
              repositorySnapshotId: "snap-1",
              legalRuleCatalogVersionId: "catalog-1",
              legalCorpusVersionId: "corpus-1",
            },
          },
        }),
      ).rejects.toMatchObject({
        response: { code: "INTERVIEW_TARGETED_NEED_NON_NEUTRAL" },
      });
    });
  });

  describe("recordAgentDecision", () => {
    it("rejects PRE_PLANNER on the internal agent decision path", async () => {
      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-legacy-mode",
          decision: {
            expectedContextRevision: 2,
            mode: LEGACY_ASSESSMENT_INTERVIEW_MODES.prePlanner,
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
          } as never,
        }),
      ).rejects.toMatchObject({
        response: { code: "INTERVIEW_AGENT_DECISION_INVALID" },
      });

      expect(
        mockTx.assessmentInterviewThread.findUnique,
      ).not.toHaveBeenCalled();
    });

    it("atomically records outcome, question persistence, and downstream impact in transaction", async () => {
      const waitingState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 2,
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: null,
        stateJson: waitingState,
        privateContextJson: {
          revisions: [
            {
              questionId: "q-1",
              answer: { questionId: "q-1", confirmed: true },
              actorId: "user-1",
              answeredAt: new Date().toISOString(),
              contextRevision: 2,
              priorRevision: 1,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              sourceVersion: "snap-1:sha-123456",
              pgeVersion: "report-1:v1",
              governedEvidenceRefs: [],
            },
          ],
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-decision-1",
        decision: {
          expectedContextRevision: 2,
          mode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          activeQuestion: {
            id: "q-next-1",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
            prompt: "Is this storage multi-region?",
            control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
            frontier: {
              owner: INTERVIEW_FRONTIER_OWNERS.customer,
              materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
              description: "Storage multi-region configuration",
            },
          },
          flags: [ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact],
        },
      });

      expect(mockInterviewAudit.recordInterviewOutcome).toHaveBeenCalledTimes(
        1,
      );
      expect(mockInterviewAudit.recordInterviewOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          activeQuestionId: "q-next-1",
          contextRevision: 2,
          sessionId: "interview:assessment-1",
        }),
        mockTx,
      );

      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledTimes(
        1,
      );
      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          questionId: "q-next-1",
          questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          sessionId: "interview:assessment-1",
        }),
        mockTx,
      );

      expect(mockInterviewAudit.recordDownstreamImpact).toHaveBeenCalledTimes(
        1,
      );
      expect(mockInterviewAudit.recordDownstreamImpact).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          interviewContextRevision: "2",
          sessionId: "interview:assessment-1",
          threadId: "interview:assessment-1",
        }),
        mockTx,
      );
      expect(mockRuntimeEvents.recordToolWaitingInput).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "interview:assessment-1",
          waitingReason:
            ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewWaitingForCustomer,
          outputSummary: expect.objectContaining({
            interviewWorkflowEvent:
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewWaitingForCustomer,
            orchestratorAction:
              ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.waitForCustomer,
            interviewMode: "INITIAL_INTERVIEW",
          }),
        }),
      );
    });

    it("rejects CONTEXT_RESOLVED outside targeted Interview mode", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: null,
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
        },
        privateContextJson: {
          revisions: [
            {
              questionId: "q-1",
              answer: { questionId: "q-1", selectedChoiceIds: ["yes"] },
              actorId: "user-1",
              answeredAt: new Date().toISOString(),
              contextRevision: 2,
              priorRevision: 1,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
              sourceVersion: "snap-1:sha-123456",
              pgeVersion: "report-1:v1",
              governedEvidenceRefs: [],
            },
          ],
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-resolve-initial",
          decision: {
            expectedContextRevision: 2,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: confirmedStructuredContext({}),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_TARGETED_MODE",
          },
        },
      });
    });

    it("rejects recordAgentDecision with CONTEXT_READY when confirmedContext is non-structured", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-1",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 1,
        },
        privateContextJson: {
          revisions: [
            {
              questionId: "q-1",
              // Non-interpretive direct-ASK answer so assertAuthorityProvenance's
              // (now-tightened) directLosslessCustomerStatement check passes and this
              // test still exercises the confirmedContext structure guard, not authority.
              answer: { questionId: "q-1", selectedChoiceIds: ["yes"] },
              actorId: "user-1",
              answeredAt: "2026-09-07T00:00:00.000Z",
              contextRevision: 1,
              priorRevision: 0,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
              sourceVersion: "snap-1:sha-123456",
              pgeVersion: "report-1:v1",
              governedEvidenceRefs: [],
            },
          ],
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-ready-non-structured",
          decision: {
            expectedContextRevision: 1,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: { decision_authority: true },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_CONFIRMED_CONTEXT_INVALID" },
        },
      });
    });

    it("rejects recordAgentDecision with CONTEXT_RESOLVED when confirmedContext is non-structured", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        targetedResolutionThreadFixture(),
      );

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-target-non-structured",
          decision: {
            expectedContextRevision: 2,
            mode: "INVESTIGATOR_RESOLUTION",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
            contextAuthority:
              ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
            confirmedContext: { decision_authority: true },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_CONFIRMED_CONTEXT_INVALID" },
        },
      });
    });

    it("rejects initial CONTEXT_READY when only AI usage was confirmed", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValue(
        readyTechnicalEvidenceReport() as never,
      );
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        initialInterviewThreadFixture(),
      );

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-initial-context-incomplete",
          decision: {
            expectedContextRevision: 1,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: confirmedStructuredContext({
              contextRevision: 1,
              topic: "ai_usage",
              statement:
                "The AI model drafts recommendations in the onboarding workflow.",
              normalizedValue: "ai_model_recommendations",
            }),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES.minimumContextIncomplete,
            meta: {
              missingDimensions: expect.stringContaining("humanOversight"),
            },
          },
        },
      });
      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-initial-broad-context-not-ready-repeat",
          decision: {
            expectedContextRevision: 1,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: confirmedStructuredContext({
              contextRevision: 1,
              topic: "ai_usage",
              statement:
                "The AI model drafts recommendations in the onboarding workflow.",
              normalizedValue: "ai_model_recommendations",
            }),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          problem: {
            meta: {
              missingDimensions: expect.stringContaining("affectedSubjects"),
            },
          },
        },
      });
      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-initial-broad-context-not-ready-repeat-2",
          decision: {
            expectedContextRevision: 1,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: confirmedStructuredContext({
              contextRevision: 1,
              topic: "ai_usage",
              statement:
                "The AI model drafts recommendations in the onboarding workflow.",
              normalizedValue: "ai_model_recommendations",
            }),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          problem: {
            meta: {
              missingDimensions: expect.stringContaining("dataCategories"),
            },
          },
        },
      });
    });

    it("accepts initial CONTEXT_READY from one rich customer-confirmed planning statement", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValue(
        readyTechnicalEvidenceReport() as never,
      );
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        initialInterviewThreadFixture(),
      );

      const result = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-initial-rich-context-ready",
        decision: {
          expectedContextRevision: 1,
          mode: "INITIAL_INTERVIEW",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
          contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
          confirmedContext: confirmedStructuredContext({
            contextRevision: 1,
            statements: initialPlanningReadyStatements(),
          }),
        },
      });

      expect(result.outcome).toBe(ASSESSMENT_INTERVIEW_OUTCOMES.contextReady);
    });

    it("does not expose internal orchestration tokens as public ready chat text", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValue(
        readyTechnicalEvidenceReport() as never,
      );
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        initialInterviewThreadFixture(),
      );

      const state = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-internal-token-rationale",
        decision: {
          expectedContextRevision: 1,
          mode: "INITIAL_INTERVIEW",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
          contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
          rationale:
            "CUSTOMER_CONFIRMED authority satisfied CONTEXT_READY resolutionCriteria.",
          confirmedContext: confirmedStructuredContext({
            contextRevision: 1,
            statements: initialPlanningReadyStatements(),
          }),
        },
      });

      expect(state.assistantMessage).toBeUndefined();
      const stateUpdate = mockTx.assessmentInterviewThread.updateMany.mock
        .calls[0]?.[0] as { data?: { stateJson?: unknown } };
      const serializedState = JSON.stringify(
        stateUpdate.data?.stateJson ?? null,
      );
      expect(serializedState).not.toContain("authority satisfied");
      expect(serializedState).not.toContain("assistantMessage");
      expect(state.activeQuestion).toBeUndefined();
      const customerVisibleText = JSON.stringify({
        assistantMessage: state.assistantMessage,
        activeQuestion: state.activeQuestion,
        pendingDraft: state.pendingDraft,
      });
      for (const token of [
        "CUSTOMER_CONFIRMED",
        "CONTEXT_READY",
        "resolutionCriteria",
      ]) {
        expect(customerVisibleText).not.toContain(token);
      }
    });

    it("treats explicit human-review and advisory-only statements as resolved but still asks for missing dimensions", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce(
        readyTechnicalEvidenceReport() as never,
      );
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        initialInterviewThreadFixture(),
      );

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-initial-explicit-negative",
          decision: {
            expectedContextRevision: 1,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: confirmedStructuredContext({
              contextRevision: 1,
              statements: [
                {
                  topic: "decision_influence",
                  statement:
                    "AI only drafts recommendations; a person must approve every action.",
                  normalizedValue: "advisory_only_human_approval_required",
                },
              ],
            }),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES.minimumContextIncomplete,
            meta: {
              missingDimensions:
                expect.not.stringContaining("decisionInfluence"),
            },
          },
        },
      });
      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-initial-explicit-negative-repeat",
          decision: {
            expectedContextRevision: 1,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: confirmedStructuredContext({
              contextRevision: 1,
              statements: [
                {
                  topic: "decision_influence",
                  statement:
                    "AI only drafts recommendations; a person must approve every action.",
                  normalizedValue: "advisory_only_human_approval_required",
                },
              ],
            }),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          problem: {
            meta: {
              missingDimensions: expect.not.stringContaining("humanOversight"),
            },
          },
        },
      });
    });

    it("keeps unknown decision influence distinct from an explicit negative while requiring the remaining context", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce(
        readyTechnicalEvidenceReport() as never,
      );
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        initialInterviewThreadFixture(),
      );

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-initial-unknown-decision-effect",
          decision: {
            expectedContextRevision: 1,
            mode: "INITIAL_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
            contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            confirmedContext: confirmedStructuredContext({
              contextRevision: 1,
              statements: [
                {
                  topic: "decision_influence",
                  statement:
                    "I don't know whether the AI output is automatically applied to any decision or action.",
                  normalizedValue: "UNKNOWN",
                },
              ],
            }),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES.minimumContextIncomplete,
            meta: {
              missingDimensions:
                expect.not.stringContaining("decisionInfluence"),
            },
          },
        },
      });
    });

    it("rejects targeted resolution when criteria are unsatisfied", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        targetedResolutionThreadFixture(),
      );

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-target-unsatisfied",
          decision: {
            expectedContextRevision: 2,
            mode: "INVESTIGATOR_RESOLUTION",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
            contextAuthority:
              ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
            confirmedContext: confirmedStructuredContext({
              topic: "unrelated",
            }),
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED" },
        },
      });
    });

    it.each([true, false])(
      "accepts targeted resolution topics with candidate-only provenance: %s",
      async (candidateOnly) => {
        mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
          targetedResolutionThreadFixture(),
        );

        const result = await service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-target-structured-resolved",
          decision: {
            expectedContextRevision: 2,
            mode: "INVESTIGATOR_RESOLUTION",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
            contextAuthority:
              ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
            confirmedContext: candidateOnly
              ? {
                  statements: [
                    {
                      statementId: "statement-direct-answer",
                      topic: "decision_authority",
                      statement:
                        "The organization denies using external national databases.",
                      normalizedValue: false,
                      evidenceRefs: [],
                    },
                  ],
                }
              : confirmedStructuredContext({}),
          },
        });

        expect(result).toMatchObject({
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
          continuation: expect.objectContaining({
            investigatorExecutionId: "exec-1",
            checkpointId: "cp-1",
          }),
        });
        expect(mockRuntimeEvents.recordToolCompleted).toHaveBeenCalledWith(
          expect.objectContaining({
            runId: "10000000-0000-4000-8000-000000000001",
            outputSummary: expect.objectContaining({
              interviewWorkflowEvent:
                ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.investigationResumed,
              interviewWorkflowEvents: [
                ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextResolved,
                ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.investigationResumed,
              ],
              orchestratorAction:
                ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.resumeExactInvestigator,
              interviewMode: "INVESTIGATOR_RESOLUTION",
            }),
          }),
        );
        const updateCalls =
          mockTx.assessmentInterviewThread.updateMany.mock.calls;
        const updateInput = updateCalls[0]?.[0] as {
          data?: { stateJson?: unknown };
        };
        expect(updateInput.data?.stateJson).toMatchObject({
          confirmedContext: {
            authority:
              CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
            statements: [
              expect.objectContaining({
                topic: "decision_authority",
                source: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
                resolutionState:
                  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
              }),
            ],
          },
        });
      },
    );

    it("routes targeted downstream impact to selective rerun instead of exact resume", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        targetedResolutionThreadFixture(),
      );

      const result = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-target-downstream-impact",
        decision: {
          expectedContextRevision: 2,
          mode: "INVESTIGATOR_RESOLUTION",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
          contextAuthority:
            ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
          confirmedContext: confirmedStructuredContext({}),
          flags: [ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact],
        },
      });

      expect(result).toMatchObject({
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
      });
      expect(result).not.toHaveProperty("continuation");
      expect(mockRuntimeEvents.recordToolCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "10000000-0000-4000-8000-000000000001",
          outputSummary: expect.objectContaining({
            interviewWorkflowEvent:
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.downstreamReevaluationStarted,
            interviewWorkflowEvents: [
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextResolved,
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.downstreamReevaluationStarted,
            ],
            orchestratorAction:
              ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.selectiveRerunRescope,
            interviewMode: "INVESTIGATOR_RESOLUTION",
          }),
        }),
      );
    });

    it("E: never re-applies the initial minimum context gate to targeted resolution", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
        targetedResolutionThreadFixture(),
      );
      const shallowTargetedContext = confirmedStructuredContext({});
      expect(
        missingInitialPlanningContextDimensions(shallowTargetedContext),
      ).not.toEqual([]);

      const result = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-target-not-initial-gated",
        decision: {
          expectedContextRevision: 2,
          mode: "INVESTIGATOR_RESOLUTION",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
          contextAuthority:
            ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
          confirmedContext: shallowTargetedContext,
          flags: [ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact],
        },
      });

      expect(result.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
      );
    });

    it("routes initial CONTEXT_READY to engineering rule evaluation workflow", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
          partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
        },
      });
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-1",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 1,
        },
        privateContextJson: {
          revisions: [
            {
              questionId: "q-1",
              answer: { questionId: "q-1", selectedChoiceIds: ["yes"] },
              actorId: "user-1",
              answeredAt: "2026-09-07T00:00:00.000Z",
              contextRevision: 1,
              priorRevision: 0,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
              sourceVersion: "snap-1:sha-123456",
              pgeVersion: "report-1:v1",
              governedEvidenceRefs: [],
            },
          ],
          workflowRunId: "10000000-0000-4000-8000-000000000002",
          partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-initial-context-ready",
        decision: {
          expectedContextRevision: 1,
          mode: "INITIAL_INTERVIEW",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
          rationale:
            "I have enough confirmed business context to continue the assessment.",
          contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
          confirmedContext: confirmedStructuredContext({
            contextRevision: 1,
            statements: initialPlanningReadyStatements(),
          }),
        },
      });

      expect(result.outcome).toBe(ASSESSMENT_INTERVIEW_OUTCOMES.contextReady);
      expect(result.assistantMessage).toBeUndefined();
      const stateUpdate = mockTx.assessmentInterviewThread.updateMany.mock
        .calls[0]?.[0] as {
        data?: { stateJson?: unknown };
      };
      expect(stateUpdate.data?.stateJson).toMatchObject({
        assistantMessage: undefined,
      });
      expect(mockRuntimeEvents.recordToolCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "10000000-0000-4000-8000-000000000002",
          outputSummary: expect.objectContaining({
            interviewWorkflowEvent:
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewContextReady,
            orchestratorAction:
              ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.continueToEngineeringRule,
            interviewMode: "INITIAL_INTERVIEW",
            partialCoveragePolicyDecision: {
              policyDecisionRef: "coverage-policy:assessment-1:report-pinned",
              policyVersion: "partial-coverage-policy-v1",
              permittedForInterview: true,
              limitations: ["dynamic routing was not statically resolved"],
            },
          }),
        }),
      );
    });

    it("accepts CUSTOMER_CONFIRMED with multiple statements from one explicit CONFIRM_ADJUST answer", async () => {
      // Worker-side synthesis may now merge several facts volunteered in one
      // FREE_TEXT answer into a single CONFIRM_ADJUST turn (interview_boundary.py
      // ::_confirmation_statement_text). Once the customer confirms that one turn,
      // the API's explicit-confirm authority check must accept every statement the
      // specialist resubmits, regardless of statement count.
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
          partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
        },
      });
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-confirm-adjust-1",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 1,
        },
        privateContextJson: {
          revisions: [
            {
              questionId: "q-confirm-adjust-1",
              answer: { questionId: "q-confirm-adjust-1", confirmed: true },
              actorId: "user-1",
              answeredAt: "2026-09-07T00:00:00.000Z",
              contextRevision: 1,
              priorRevision: 0,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
              sourceVersion: "snap-1:sha-123456",
              pgeVersion: "report-1:v1",
              governedEvidenceRefs: [],
            },
          ],
          workflowRunId: "10000000-0000-4000-8000-000000000002",
          partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const result = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-multi-statement-confirm",
        decision: {
          expectedContextRevision: 1,
          mode: "INITIAL_INTERVIEW",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
          rationale: "Both volunteered facts are now customer-confirmed.",
          contextAuthority:
            ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
          confirmedContext: {
            assessmentId: "assessment-1",
            contextRevision: 1,
            authority:
              CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
            statements: [
              {
                statementId: "stmt-ai-usage",
                assessmentId: "assessment-1",
                topic: "ai_usage",
                statement:
                  "The AI model drafts recommendations in the customer onboarding workflow.",
                normalizedValue: "ai_model_recommendations_customer_onboarding",
                scope: { needId: "need-1" },
                evidenceRefs: [],
                respondentRef: "actor:authenticated:user-1",
              },
              {
                statementId: "stmt-human-approval",
                assessmentId: "assessment-1",
                topic: "human_approval",
                statement:
                  "A recruiter reviews and approves every customer-facing action before any status update or workflow gate changes.",
                normalizedValue:
                  "recruiter_approval_before_status_or_gate_change",
                scope: { needId: "need-1" },
                evidenceRefs: [],
                respondentRef: "actor:authenticated:user-1",
              },
              {
                statementId: "stmt-data-sources",
                assessmentId: "assessment-1",
                topic: "data_sources",
                statement:
                  "Material data sources are customer profile records, support tickets, repository code, and business documents.",
                normalizedValue:
                  "customer_profile_support_repository_documents",
                scope: { needId: "need-1" },
                evidenceRefs: [],
                respondentRef: "actor:authenticated:user-1",
              },
            ],
            limitations: [],
            sourceVersionRef: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
            guidanceVersion: "guidance-1",
          },
        },
      });

      expect(result.outcome).toBe(ASSESSMENT_INTERVIEW_OUTCOMES.contextReady);
      const stateUpdate = mockTx.assessmentInterviewThread.updateMany.mock
        .calls[0]?.[0] as {
        data?: { stateJson?: unknown };
      };
      expect(stateUpdate.data?.stateJson).toMatchObject({
        confirmedContext: {
          statements: [
            expect.objectContaining({ topic: "ai_usage" }),
            expect.objectContaining({ topic: "human_approval" }),
            expect.objectContaining({ topic: "data_sources" }),
          ],
        },
      });
    });

    it.each([
      {
        name: "FREE_TEXT",
        revision: {
          answer: { questionId: "q-1", freeText: "Human approval" },
          questionControl: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          answerRequiresInterpretation: true,
        },
      },
      {
        name: "Other comment",
        revision: {
          answer: {
            questionId: "q-1",
            selectedChoiceIds: ["other"],
            comment: "Hosted in a customer-managed region.",
          },
          questionControl: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
          answerRequiresInterpretation: true,
        },
      },
      {
        name: "selected choice comment",
        revision: {
          answer: {
            questionId: "q-1",
            selectedChoiceIds: ["standard"],
            comment: "Mostly standard, except admin approval.",
          },
          questionControl: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
          answerRequiresInterpretation: true,
        },
      },
    ])(
      "rejects initial CONTEXT_READY from interpretive $name answers before confirm-adjust",
      async ({ revision }) => {
        mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
          assessmentId: "assessment-1",
          contextRevision: 1,
          processedRevision: 0,
          activeQuestionId: "q-1",
          stateJson: {
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            contextRevision: 1,
          },
          privateContextJson: {
            revisions: [
              {
                questionId: "q-1",
                ...revision,
                actorId: "user-1",
                answeredAt: "2026-09-07T00:00:00.000Z",
                contextRevision: 1,
                priorRevision: 0,
                authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
                questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
                sourceVersion: "snap-1:sha-123456",
                pgeVersion: "report-1:v1",
                governedEvidenceRefs: [],
              },
            ],
            workflowRunId: "10000000-0000-4000-8000-000000000002",
            partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
          },
          sourceVersion: "snap-1:sha-123456",
          pgeVersion: "report-1:v1",
        });

        await expect(
          service.recordAgentDecision({
            assessmentId: "assessment-1",
            correlationId: "corr-interpretive-context-ready",
            decision: {
              expectedContextRevision: 1,
              mode: "INITIAL_INTERVIEW",
              outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
              contextAuthority:
                ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
              confirmedContext: confirmedStructuredContext({
                contextRevision: 1,
              }),
            },
          }),
        ).rejects.toMatchObject({
          response: {
            ok: false,
            problem: {
              code: "INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_DIRECT_OR_EXPLICIT_CONFIRMATION",
            },
          },
        });
      },
    );

    it.each([
      { resolutionState: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.uncertain },
      { resolutionState: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.conflicted },
    ])(
      "rejects contradictory targeted statement provenance: %j",
      async (provenance) => {
        mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(
          targetedResolutionThreadFixture(),
        );

        await expect(
          service.recordAgentDecision({
            assessmentId: "assessment-1",
            correlationId: "corr-target-structured-unconfirmed",
            decision: {
              expectedContextRevision: 2,
              mode: "INVESTIGATOR_RESOLUTION",
              outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
              contextAuthority:
                ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
              confirmedContext: confirmedStructuredContext(provenance),
            },
          }),
        ).rejects.toMatchObject({
          response: {
            ok: false,
            problem: { code: "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED" },
          },
        });
      },
    );
  });

  describe("seedInitialQuestionForWorker", () => {
    const initialQuestionState = (): AssessmentInterviewRuntimeState => ({
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: {
        id: "q-init-coverage-gate",
        intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        prompt: "What is the business purpose of this flow?",
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        frontier: {
          owner: INTERVIEW_FRONTIER_OWNERS.customer,
          materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
          description: "Business purpose of this flow",
        },
      },
    });

    it.each([
      ["a missing coverage state", {}],
      ["an unknown coverage state", { coverageState: "UNKNOWN" }],
    ])(
      "does not persist an Initial Interview question for selected report with %s",
      async (_description, evidencePayload) => {
        mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
          id: "report-unusable",
          schemaVersion: "v1",
          evidencePayload,
        });

        await expect(
          service.seedInitialQuestionForWorker({
            assessmentId: "assessment-1",
            correlationId: "corr-unusable-coverage",
            workflowRunId: "10000000-0000-4000-8000-000000000001",
            state: initialQuestionState(),
            technicalEvidenceReportId: "report-unusable",
          }),
        ).rejects.toMatchObject({
          response: {
            ok: false,
            problem: {
              code: ASSESSMENT_ERROR_CODES.interviewTechnicalCoverageUnusable,
            },
          },
        });

        expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
        expect(
          mockInterviewAudit.recordQuestionPersisted,
        ).not.toHaveBeenCalled();
        expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
      },
    );

    it("does not persist an Initial Interview question for UNAVAILABLE coverage", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-unavailable",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState:
            INTERVIEW_TECHNICAL_COVERAGE_STATES.unavailable,
          coverageLimitations: ["source retrieval failed"],
        },
      });

      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-unavailable-coverage",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: initialQuestionState(),
          technicalEvidenceReportId: "report-unavailable",
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: ASSESSMENT_ERROR_CODES.interviewTechnicalCoverageUnusable,
          },
        },
      });

      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordQuestionPersisted).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("does not persist PARTIAL coverage without preserved limitations", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-partial-without-limitations",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
          partialCoveragePolicyDecision: partialCoveragePolicyDecision({
            limitations: [],
          }),
        },
      });

      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-partial-without-limitations",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: initialQuestionState(),
          technicalEvidenceReportId: "report-partial-without-limitations",
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: ASSESSMENT_ERROR_CODES.interviewPartialCoverageLimitationsRequired,
          },
        },
      });

      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordQuestionPersisted).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("does not invoke Interview for PARTIAL coverage without a policy decision", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-partial-without-policy",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
          coverageLimitations: ["static analyzer missed a dynamic import"],
        },
      });

      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-partial-without-policy",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: initialQuestionState(),
          technicalEvidenceReportId: "report-partial-without-policy",
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: ASSESSMENT_ERROR_CODES.interviewPartialCoverageLimitationsRequired,
          },
        },
      });

      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordQuestionPersisted).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("does not invoke Interview when PARTIAL coverage policy denies Interview", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-partial-denied-policy",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
          partialCoveragePolicyDecision: partialCoveragePolicyDecision({
            permittedForInterview: false,
          }),
        },
      });

      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-partial-denied-policy",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: initialQuestionState(),
          technicalEvidenceReportId: "report-partial-denied-policy",
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: {
            code: ASSESSMENT_ERROR_CODES.interviewPartialCoverageLimitationsRequired,
          },
        },
      });

      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordQuestionPersisted).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("atomically persists thread state and records question in transaction", async () => {
      const initialState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: "q-init-1",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "What is your cloud environment?",
          control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
          snippetRef: {
            snapshot_id: "snap-1",
            commit_sha: "sha-123456",
            file_path: "src/cloud.ts",
            start_line: 10,
            end_line: 12,
            evidence_hash: `sha256:${"a".repeat(64)}`,
            snippet_policy: "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
          },
          frontier: {
            owner: INTERVIEW_FRONTIER_OWNERS.customer,
            materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
            description: "Cloud environment configuration",
          },
        },
      };

      const result = await service.seedInitialQuestionForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-seed-1",
        workflowRunId: "10000000-0000-4000-8000-000000000001",
        state: initialState,
      });

      expect(result.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      );
      expect(result.activeQuestion?.snippetRef).toEqual(
        initialState.activeQuestion?.snippetRef,
      );
      expect(mockTx.assessmentInterviewThread.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            guidanceVersion: TEST_GUIDANCE_VERSION,
            privateContextJson: expect.objectContaining({
              workingStrategy: expect.objectContaining({
                terminologyMap: {},
              }),
            }),
          }),
        }),
      );
      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledTimes(
        1,
      );
      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          questionId: "q-init-1",
          questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          sessionId: "interview:assessment-1",
          sourceSnapshot: expect.objectContaining({
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
            technicalCoverageState: "READY",
          }),
        }),
        mockTx,
      );
    });

    it("rejects a nonzero initial expectedContextRevision before persistence", async () => {
      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-seed-nonzero-revision",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: {
            ...initialQuestionState(),
            expectedContextRevision: 1,
          } as AssessmentInterviewRuntimeState,
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_INITIAL_SEED_STALE" },
        },
      });

      expect(
        mockTx.assessmentInterviewThread.findUnique,
      ).not.toHaveBeenCalled();
      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordQuestionPersisted).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("treats retry-after-commit of the same initial seed as side-effect-free replay", async () => {
      const workflowRunId = "10000000-0000-4000-8000-000000000001";
      const initialState = {
        ...initialQuestionState(),
        expectedContextRevision: 0,
      } as AssessmentInterviewRuntimeState & {
        expectedContextRevision: number;
      };
      const persistedState: AssessmentInterviewRuntimeState = {
        ...initialState,
        threadId: "interview:assessment-1",
        contextRevision: 0,
        orchestrationRequested: false,
      };
      const persistedThread = {
        assessmentId: "assessment-1",
        contextRevision: 0,
        processedRevision: 0,
        activeQuestionId: initialState.activeQuestion?.id,
        stateJson: persistedState,
        privateContextJson: {
          revisions: [],
          workflowRunId,
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: TEST_GUIDANCE_VERSION,
      };
      mockTx.assessmentInterviewThread.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(persistedThread);

      const first = await service.seedInitialQuestionForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-seed-retry-1",
        workflowRunId,
        state: initialState,
      });
      const replay = await service.seedInitialQuestionForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-seed-retry-2",
        workflowRunId,
        state: initialState,
      });

      expect(replay).toEqual(persistedState);
      expect(first.activeQuestion?.id).toBe(initialState.activeQuestion?.id);
      expect(mockTx.assessmentInterviewThread.upsert).toHaveBeenCalledTimes(1);
      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledTimes(
        1,
      );
      expect(mockRuntimeEvents.recordToolWaitingInput).toHaveBeenCalledTimes(1);
    });

    it("rolls back the initial seed when waiting-event persistence fails and retry completes it once", async () => {
      const workflowRunId = "10000000-0000-4000-8000-000000000001";
      const initialState = {
        ...initialQuestionState(),
        expectedContextRevision: 0,
      } as AssessmentInterviewRuntimeState & {
        expectedContextRevision: number;
      };
      let committedTransactions = 0;
      let durableWaitingEvents = 0;
      mockTransaction.mockImplementation(
        async <T>(
          cb: (tx: MockPrismaDelegates) => Promise<T>,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          _options?: unknown,
        ): Promise<T> => {
          const result = await cb(mockTx);
          committedTransactions += 1;
          return result;
        },
      );
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue(null);
      mockRuntimeEvents.recordToolWaitingInput
        .mockRejectedValueOnce(new Error("runtime waiting event write failed"))
        .mockImplementationOnce((...args: unknown[]) => {
          expect(args[1]).toBe(mockTx);
          durableWaitingEvents += 1;
          return Promise.resolve();
        });

      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-seed-event-failure",
          workflowRunId,
          state: initialState,
        }),
      ).rejects.toThrow("runtime waiting event write failed");

      expect(committedTransactions).toBe(0);
      expect(durableWaitingEvents).toBe(0);

      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-seed-event-retry",
          workflowRunId,
          state: initialState,
        }),
      ).resolves.toMatchObject({
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 0,
      });

      expect(committedTransactions).toBe(1);
      expect(durableWaitingEvents).toBe(1);
      expect(mockRuntimeEvents.recordToolWaitingInput).toHaveBeenCalledTimes(2);
    });

    it("rejects a delayed initial seed after the interview revision has advanced", async () => {
      const workflowRunId = "10000000-0000-4000-8000-000000000001";
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-next",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 1,
          activeQuestion: {
            id: "q-next",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
            prompt: "What happens after the recommendation?",
            control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          },
          answerHistory: [
            {
              questionId: "q-init-coverage-gate",
              answeredAt: "2026-09-18T00:00:00.000Z",
              summary: "Customer answered the initial question.",
            },
          ],
        },
        privateContextJson: {
          revisions: [],
          workflowRunId,
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: TEST_GUIDANCE_VERSION,
      });

      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-stale-seed",
          workflowRunId,
          state: {
            ...initialQuestionState(),
            expectedContextRevision: 0,
          } as AssessmentInterviewRuntimeState,
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_INITIAL_SEED_STALE" },
        },
      });

      expect(mockTx.assessmentInterviewThread.upsert).not.toHaveBeenCalled();
      expect(mockInterviewAudit.recordQuestionPersisted).not.toHaveBeenCalled();
      expect(mockRuntimeEvents.recordToolWaitingInput).not.toHaveBeenCalled();
    });

    it("pins nested PGE PARTIAL coverage and limitations from the worker-selected report", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-pinned",
        schemaVersion: "v2",
        evidencePayload: {
          evidence_graph: {
            coverage_state: "LIMITED",
            coverage_notes: ["dynamic routing was not statically resolved"],
            partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
          },
        },
      });
      const initialState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: "q-partial-1",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "How is the recommendation used?",
          control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          frontier: {
            owner: INTERVIEW_FRONTIER_OWNERS.customer,
            materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
            description: "Recommendation usage pattern",
          },
        },
      };

      await service.seedInitialQuestionForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-partial-1",
        workflowRunId: "10000000-0000-4000-8000-000000000001",
        state: initialState,
        technicalEvidenceReportId: "report-pinned",
      });

      expect(
        mockTx.technicalEvidenceReport.findFirst as unknown as jest.Mock,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            assessmentId: "assessment-1",
            id: "report-pinned",
            status: "ACCEPTED",
          },
        }),
      );
      expect(mockTx.assessmentInterviewThread.upsert).toHaveBeenCalledTimes(1);
      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSnapshot: expect.objectContaining({
            pgeVersion: "report-pinned:v2",
            technicalCoverageState: "PARTIAL",
            coverageLimitations: [
              "dynamic routing was not statically resolved",
            ],
            partialCoveragePolicyDecision: {
              policyDecisionRef: "coverage-policy:assessment-1:report-pinned",
              policyVersion: "partial-coverage-policy-v1",
              permittedForInterview: true,
              limitations: ["dynamic routing was not statically resolved"],
            },
          }),
        }),
        mockTx,
      );
      expect(mockTx.assessmentInterviewThread.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            privateContextJson: expect.objectContaining({
              partialCoveragePolicyDecision: {
                policyDecisionRef: "coverage-policy:assessment-1:report-pinned",
                policyVersion: "partial-coverage-policy-v1",
                permittedForInterview: true,
                limitations: ["dynamic routing was not statically resolved"],
              },
            }),
          }),
        }),
      );
      expect(mockRuntimeEvents.recordToolWaitingInput).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "10000000-0000-4000-8000-000000000001",
          waitingReason: ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewStarted,
          outputSummary: expect.objectContaining({
            interviewWorkflowEvent:
              ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS.interviewStarted,
            orchestratorAction:
              ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS.waitForCustomer,
            assessmentInterview: expect.objectContaining({
              outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            }),
            partialCoveragePolicyDecision: {
              policyDecisionRef: "coverage-policy:assessment-1:report-pinned",
              policyVersion: "partial-coverage-policy-v1",
              permittedForInterview: true,
              limitations: ["dynamic routing was not statically resolved"],
            },
          }),
        }),
        mockTx,
      );
    });

    it("preserves permitted PARTIAL policy decision in worker Interview input", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 0,
        processedRevision: 0,
        activeQuestionId: "q-partial-policy",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 0,
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: TEST_GUIDANCE_VERSION,
      });
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
          partialCoveragePolicyDecision: partialCoveragePolicyDecision(),
        },
      });

      const workerContext = await service.getPrivateContextForWorker({
        assessmentId: "assessment-1",
        contextRevision: 0,
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      expect(workerContext.technicalCoverageState).toBe(
        INTERVIEW_TECHNICAL_COVERAGE_STATES.partial,
      );
      expect(workerContext.coverageLimitations).toEqual([
        "dynamic routing was not statically resolved",
      ]);
      expect(workerContext.partialCoveragePolicyDecision).toEqual({
        policyDecisionRef: "coverage-policy:assessment-1:report-pinned",
        policyVersion: "partial-coverage-policy-v1",
        permittedForInterview: true,
        limitations: ["dynamic routing was not statically resolved"],
      });
    });
  });

  describe("legacy guidance pinning", () => {
    it.each([2, 1])(
      "keeps confirmed context worker-only and pinned to requested revision %s",
      async (requestedRevision) => {
        const confirmedContext = confirmedStructuredContext({});
        mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
          assessmentId: "assessment-1",
          contextRevision: 2,
          processedRevision: 2,
          activeQuestionId: null,
          stateJson: {
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
            contextRevision: 2,
            confirmedContext,
          },
          privateContextJson: { revisions: [] },
          sourceVersion: "snap-1:sha-123456",
          pgeVersion: "report-1:v1",
          guidanceVersion: TEST_GUIDANCE_VERSION,
        });
        const context = await service.getPrivateContextForWorker({
          assessmentId: "assessment-1",
          contextRevision: requestedRevision,
          sourceVersion: "snap-1:sha-123456",
          pgeVersion: "report-1:v1",
        });
        expect(context.publicState).not.toHaveProperty("confirmedContext");
        expect(context.confirmedContext).toEqual(
          requestedRevision === 2 ? confirmedContext : undefined,
        );
      },
    );

    it("pins a materialized legacy thread once and keeps the pin after active guidance changes", async () => {
      mockInterviewGuidanceResolver.resolveActiveGuidanceVersion.mockReturnValue(
        "guidance-v3",
      );
      const legacyThread = {
        assessmentId: "assessment-1",
        contextRevision: 0,
        processedRevision: 0,
        activeQuestionId: "q-legacy",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          activeQuestion: {
            id: "q-legacy",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
            prompt: "What is the operating model?",
            control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
            frontier: {
              owner: INTERVIEW_FRONTIER_OWNERS.customer,
              materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
              description: "Operating model description",
            },
          },
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: null,
      };
      mockTx.assessmentInterviewThread.findUnique
        .mockResolvedValueOnce(legacyThread)
        .mockResolvedValueOnce({
          ...legacyThread,
          guidanceVersion: "guidance-v3",
        });

      await service.seedInitialQuestionForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-legacy-pin",
        workflowRunId: "10000000-0000-4000-8000-000000000001",
        state: legacyThread.stateJson,
      });

      expect(mockTx.assessmentInterviewThread.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ guidanceVersion: "guidance-v3" }),
        }),
      );
      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSnapshot: expect.objectContaining({
            guidanceVersion: "guidance-v3",
          }),
        }),
        mockTx,
      );

      mockInterviewGuidanceResolver.resolveActiveGuidanceVersion.mockReturnValue(
        "guidance-v4",
      );
      const workerContext = await service.getPrivateContextForWorker({
        assessmentId: "assessment-1",
        contextRevision: 0,
      });

      expect(workerContext.guidanceVersion).toBe("guidance-v3");
      expect(
        mockTx.assessmentInterviewThread.updateMany,
      ).not.toHaveBeenCalled();
    });

    it("does not overwrite a pin won by a concurrent legacy-thread materialization", async () => {
      mockInterviewGuidanceResolver.resolveActiveGuidanceVersion.mockReturnValue(
        "guidance-v4",
      );
      const legacyThread = {
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-legacy",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          activeQuestion: {
            id: "q-legacy",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
            prompt: "What is the operating model?",
            control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
          },
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: null,
      };
      mockTx.assessmentInterviewThread.findUnique
        .mockResolvedValueOnce(legacyThread)
        .mockResolvedValueOnce({
          ...legacyThread,
          guidanceVersion: "guidance-v3",
        });
      mockTx.assessmentInterviewThread.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      const workerContext = await service.getPrivateContextForWorker({
        assessmentId: "assessment-1",
        contextRevision: 1,
      });

      expect(workerContext.guidanceVersion).toBe("guidance-v3");
      expect(mockTx.assessmentInterviewThread.updateMany).toHaveBeenCalledWith({
        where: { assessmentId: "assessment-1", guidanceVersion: null },
        data: { guidanceVersion: "guidance-v4" },
      });
    });
  });

  describe("worker-only prior answer history", () => {
    function revisionFixture(overrides: {
      questionId: string;
      contextRevision: number;
      answer: Record<string, unknown>;
      questionControl?: string;
      questionIntent?: string;
    }): Record<string, unknown> {
      return {
        questionId: overrides.questionId,
        answer: { questionId: overrides.questionId, ...overrides.answer },
        actorId: "user-1",
        answeredAt: "2026-09-07T00:00:00.000Z",
        contextRevision: overrides.contextRevision,
        priorRevision: overrides.contextRevision - 1,
        authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
        questionIntent:
          overrides.questionIntent ?? ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        questionControl:
          overrides.questionControl ??
          ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        governedEvidenceRefs: [],
      };
    }

    it("exposes verbatim prior comment/free text to the worker, excluding the current revision", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 3,
        processedRevision: 0,
        activeQuestionId: "q-3",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 3,
        },
        privateContextJson: {
          revisions: [
            revisionFixture({
              questionId: "q-1",
              contextRevision: 1,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
              answer: {
                selectedChoiceIds: ["other"],
                comment:
                  "Hosted in a customer-managed region behind our own VPN.",
              },
            }),
            revisionFixture({
              questionId: "q-2",
              contextRevision: 2,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
              answer: {
                freeText: "Only the on-call engineer can override it.",
              },
            }),
            revisionFixture({
              questionId: "q-3",
              contextRevision: 3,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
              answer: { selectedChoiceIds: ["yes"] },
            }),
          ],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: TEST_GUIDANCE_VERSION,
      });

      const workerContext = await service.getPrivateContextForWorker({
        assessmentId: "assessment-1",
        contextRevision: 3,
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      expect(workerContext.priorAnswerHistory).toHaveLength(2);
      expect(workerContext.priorAnswerHistoryOmittedCount).toBe(0);
      expect(workerContext.priorAnswerHistory[0]).toMatchObject({
        questionId: "q-1",
        contextRevision: 1,
        selectedChoiceIds: ["other"],
        comment: "Hosted in a customer-managed region behind our own VPN.",
      });
      expect(workerContext.priorAnswerHistory[1]).toMatchObject({
        questionId: "q-2",
        contextRevision: 2,
        freeText: "Only the on-call engineer can override it.",
      });
      // The current revision (q-3) is already carried in full via privateRevision;
      // it must not be duplicated into priorAnswerHistory.
      expect(
        workerContext.priorAnswerHistory.some(
          (item) => item.contextRevision === 3,
        ),
      ).toBe(false);
    });

    it("truncates prior comment/free text over the length limit with a marker", async () => {
      const longComment = "x".repeat(600);
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 0,
        activeQuestionId: "q-2",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
        },
        privateContextJson: {
          revisions: [
            revisionFixture({
              questionId: "q-1",
              contextRevision: 1,
              answer: { selectedChoiceIds: ["other"], comment: longComment },
            }),
          ],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: TEST_GUIDANCE_VERSION,
      });

      const workerContext = await service.getPrivateContextForWorker({
        assessmentId: "assessment-1",
        contextRevision: 2,
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const comment = workerContext.priorAnswerHistory[0]?.comment ?? "";
      expect(comment.length).toBe(500 + "…[truncated]".length);
      expect(comment.startsWith("x".repeat(500))).toBe(true);
      expect(comment.endsWith("…[truncated]")).toBe(true);
    });

    it("keeps only the most recent entries and reports how many older ones were omitted", async () => {
      const revisions = Array.from({ length: 25 }, (_, index) =>
        revisionFixture({
          questionId: `q-${index + 1}`,
          contextRevision: index + 1,
          answer: { selectedChoiceIds: ["yes"] },
        }),
      );
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 26,
        processedRevision: 0,
        activeQuestionId: "q-26",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 26,
        },
        privateContextJson: {
          revisions,
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: TEST_GUIDANCE_VERSION,
      });

      const workerContext = await service.getPrivateContextForWorker({
        assessmentId: "assessment-1",
        contextRevision: 26,
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      expect(workerContext.priorAnswerHistory).toHaveLength(20);
      expect(workerContext.priorAnswerHistoryOmittedCount).toBe(5);
      // Most recent 20 kept: q-6 .. q-25.
      expect(workerContext.priorAnswerHistory[0]?.questionId).toBe("q-6");
      expect(workerContext.priorAnswerHistory[19]?.questionId).toBe("q-25");
    });

    it("never carries prior comment/free text into the sanitized public projection", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 0,
        activeQuestionId: "q-2",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
          answerHistory: [
            {
              questionId: "q-1",
              questionPrompt: "Where is this hosted?",
              actorId: "user-1",
              answeredAt: "2026-09-07T00:00:00.000Z",
              summary: "Customer selected 1 option(s).",
            },
          ],
        },
        privateContextJson: {
          revisions: [
            revisionFixture({
              questionId: "q-1",
              contextRevision: 1,
              answer: {
                selectedChoiceIds: ["other"],
                comment:
                  "Hosted in a customer-managed region behind our own VPN.",
              },
            }),
          ],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: TEST_GUIDANCE_VERSION,
      });

      const workerContext = await service.getPrivateContextForWorker({
        assessmentId: "assessment-1",
        contextRevision: 2,
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      expect(workerContext.priorAnswerHistory[0]?.comment).toBe(
        "Hosted in a customer-managed region behind our own VPN.",
      );
      const publicHistory = (
        workerContext.publicState as {
          answerHistory?: Record<string, unknown>[];
        }
      ).answerHistory;
      expect(publicHistory).toEqual([
        {
          questionId: "q-1",
          questionPrompt: "Where is this hosted?",
          answeredAt: "2026-09-07T00:00:00.000Z",
          summary: "Customer selected 1 option(s).",
        },
      ]);
      expect(publicHistory?.[0]).not.toHaveProperty("comment");
      expect(publicHistory?.[0]).not.toHaveProperty("selectedChoiceIds");
    });
  });

  describe("LCSP-285 Final Remediation: Persistence Frontier Validation, Evidence Ref Authorization & Public Projection", () => {
    const validFrontier = {
      owner: INTERVIEW_FRONTIER_OWNERS.customer,
      materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
      description: "Business rule requirements",
      evidenceRefs: ["evidence:symbol:valid_ref"],
    };

    it("rejects seedInitialQuestionForWorker when frontier is missing", async () => {
      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-no-frontier",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: {
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            activeQuestion: {
              id: "q-no-frontier",
              intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              prompt: "Question without frontier?",
              control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_QUESTION_FRONTIER_REQUIRED" },
        },
      });
    });

    it.each([
      [
        "TECHNICAL owner",
        { ...validFrontier, owner: INTERVIEW_FRONTIER_OWNERS.technical },
        "INTERVIEW_QUESTION_FRONTIER_NOT_CUSTOMER_OWNED",
      ],
      [
        "SYSTEM owner",
        { ...validFrontier, owner: INTERVIEW_FRONTIER_OWNERS.system },
        "INTERVIEW_QUESTION_FRONTIER_NOT_CUSTOMER_OWNED",
      ],
      [
        "NON_MATERIAL materiality",
        {
          ...validFrontier,
          materiality: INTERVIEW_FRONTIER_MATERIALITIES.nonMaterial,
        },
        "INTERVIEW_QUESTION_FRONTIER_NOT_MATERIAL",
      ],
      [
        "empty description",
        { ...validFrontier, description: "   " },
        "INTERVIEW_QUESTION_FRONTIER_DESCRIPTION_REQUIRED",
      ],
    ])(
      "rejects seedInitialQuestionForWorker with %s",
      async (_label, frontier, expectedCode) => {
        await expect(
          service.seedInitialQuestionForWorker({
            assessmentId: "assessment-1",
            correlationId: "corr-invalid-frontier",
            workflowRunId: "10000000-0000-4000-8000-000000000001",
            state: {
              outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
              activeQuestion: {
                id: "q-invalid-frontier",
                intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
                prompt: "Question with invalid frontier?",
                control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
                frontier: frontier as never,
              },
            },
          }),
        ).rejects.toMatchObject({
          response: {
            ok: false,
            problem: { code: expectedCode },
          },
        });
      },
    );

    it("rejects seedInitialQuestionForWorker with unauthorized whyEvidenceRefs", async () => {
      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-unauth-why-ref",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: {
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            activeQuestion: {
              id: "q-unauth-ref",
              intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              prompt: "Question with fake ref?",
              control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
              whyEvidenceRefs: ["evidence:symbol:fabricated_ref_123"],
              frontier: validFrontier,
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED" },
        },
      });
    });

    it("rejects seedInitialQuestionForWorker with unauthorized frontier.evidenceRefs", async () => {
      await expect(
        service.seedInitialQuestionForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-unauth-frontier-ref",
          workflowRunId: "10000000-0000-4000-8000-000000000001",
          state: {
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            activeQuestion: {
              id: "q-unauth-frontier-ref",
              intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              prompt: "Question with fake frontier ref?",
              control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
              frontier: {
                ...validFrontier,
                evidenceRefs: ["evidence:cross:assessment_fake_ref"],
              },
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED" },
        },
      });
    });

    it.each([
      ["missing frontier", undefined, "INTERVIEW_QUESTION_FRONTIER_REQUIRED"],
      [
        "TECHNICAL owner",
        { ...validFrontier, owner: INTERVIEW_FRONTIER_OWNERS.technical },
        "INTERVIEW_QUESTION_FRONTIER_NOT_CUSTOMER_OWNED",
      ],
      [
        "SYSTEM owner",
        { ...validFrontier, owner: INTERVIEW_FRONTIER_OWNERS.system },
        "INTERVIEW_QUESTION_FRONTIER_NOT_CUSTOMER_OWNED",
      ],
      [
        "NON_MATERIAL materiality",
        {
          ...validFrontier,
          materiality: INTERVIEW_FRONTIER_MATERIALITIES.nonMaterial,
        },
        "INTERVIEW_QUESTION_FRONTIER_NOT_MATERIAL",
      ],
    ])(
      "rejects recordAgentDecision with %s",
      async (_label, frontier, expectedCode) => {
        mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
          assessmentId: "assessment-1",
          contextRevision: 2,
          processedRevision: 1,
          activeQuestionId: "q-1",
          stateJson: {
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            contextRevision: 2,
          },
          privateContextJson: {
            revisions: [
              {
                questionId: "q-1",
                answer: { questionId: "q-1", confirmed: true },
                actorId: "user-1",
                answeredAt: new Date().toISOString(),
                contextRevision: 2,
                priorRevision: 1,
                authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
                sourceVersion: "snap-1:sha-123456",
                pgeVersion: "report-1:v1",
                governedEvidenceRefs: [],
              },
            ],
          },
          sourceVersion: "snap-1:sha-123456",
          pgeVersion: "report-1:v1",
        });

        await expect(
          service.recordAgentDecision({
            assessmentId: "assessment-1",
            correlationId: "corr-decision-frontier-test",
            decision: {
              expectedContextRevision: 2,
              mode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
              outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
              activeQuestion: {
                id: "q-decision-invalid",
                intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
                prompt: "Decision question?",
                control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
                frontier: frontier as never,
              },
            },
          }),
        ).rejects.toMatchObject({
          response: {
            ok: false,
            problem: { code: expectedCode },
          },
        });
      },
    );

    it("rejects recordAgentDecision with unauthorized evidence refs", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: "q-1",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
        },
        privateContextJson: {
          revisions: [
            {
              questionId: "q-1",
              answer: { questionId: "q-1", confirmed: true },
              actorId: "user-1",
              answeredAt: new Date().toISOString(),
              contextRevision: 2,
              priorRevision: 1,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              sourceVersion: "snap-1:sha-123456",
              pgeVersion: "report-1:v1",
              governedEvidenceRefs: [],
            },
          ],
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-decision-unauth-refs",
          decision: {
            expectedContextRevision: 2,
            mode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            activeQuestion: {
              id: "q-decision-unauth",
              intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
              prompt: "Decision question with fabricated ref?",
              control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
              whyEvidenceRefs: ["evidence:fabricated:unknown_ref"],
              frontier: validFrontier,
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED" },
        },
      });
    });

    it("public projection strips internal evidence refs and exposes hasSupportingEvidence and safe whyAreWeAsking", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-pub-1",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          activeQuestion: {
            id: "q-pub-1",
            needId: "need-storage",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
            control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
            prompt: "Is this storage multi-region?",
            whyAreWeAsking:
              "The available technical evidence does not establish whether multi-region is configured.",
            whyEvidenceRefs: [
              "evidence:symbol:storage_config",
              "repositorySnapshot:snap-1",
            ],
            snippetRef: {
              snapshot_id: "snap-1",
              commit_sha: "sha-123456",
              file_path: "src/storage.ts",
              start_line: 20,
              end_line: 24,
              evidence_hash: `sha256:${"b".repeat(64)}`,
              snippet_policy: "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
            },
            frontier: {
              owner: INTERVIEW_FRONTIER_OWNERS.customer,
              materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
              description: "Storage replication topology",
              evidenceRefs: ["evidence:symbol:storage_config"],
            },
          },
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
        guidanceVersion: "guidance-v1",
      });

      const actor = {
        userId: "user-1",
        role: AUTH_USER_ROLES.customer,
      };
      const publicOutput = await service.getState(
        "assessment-1",
        actor as never,
      );
      expect(publicOutput.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      );
      expect(publicOutput.activeQuestion).toBeDefined();

      const q = publicOutput.activeQuestion!;
      expect(q.id).toBe("q-pub-1");
      expect(q.needId).toBe("need-storage");
      expect(q.intent).toBe(ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify);
      expect(q.control).toBe(ASSESSMENT_INTERVIEW_CONTROLS.boolean);
      expect(q.prompt).toBe("Is this storage multi-region?");
      expect(q.whyAreWeAsking).toBe(
        "The available technical evidence does not establish whether multi-region is configured.",
      );
      expect(q.hasSupportingEvidence).toBe(true);
      expect(q.snippetRef).toEqual({
        snapshot_id: "snap-1",
        commit_sha: "sha-123456",
        file_path: "src/storage.ts",
        start_line: 20,
        end_line: 24,
        evidence_hash: `sha256:${"b".repeat(64)}`,
        snippet_policy: "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1",
      });

      // Verify internal refs are stripped from public projection
      expect(q.whyEvidenceRefs).toBeUndefined();
      expect(q.frontier?.evidenceRefs).toBeUndefined();
      expect(q.frontier?.owner).toBe(INTERVIEW_FRONTIER_OWNERS.customer);
      expect(q.frontier?.materiality).toBe(
        INTERVIEW_FRONTIER_MATERIALITIES.material,
      );
      expect(q.frontier?.description).toBe("Storage replication topology");
    });

    it("accepts recordAgentDecision with valid node and edge evidence refs extracted from pinned report graph", async () => {
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: "READY",
          coverageLimitations: [],
          programEvidenceGraph: {
            evidence_refs: ["evidence:graph:global"],
            nodes: [
              {
                id: "node-auth-1",
                evidence_refs: ["evidence:symbol:valid_node_func"],
              },
            ],
            edges: [
              {
                id: "edge-auth-1",
                evidence_refs: ["evidence:flow:valid_edge_flow"],
              },
            ],
          },
        },
      });

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 1,
        activeQuestionId: "q-1",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
        },
        privateContextJson: {
          revisions: [
            {
              questionId: "q-1",
              answer: { questionId: "q-1", confirmed: true },
              actorId: "user-1",
              answeredAt: new Date().toISOString(),
              contextRevision: 2,
              priorRevision: 1,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              sourceVersion: "snap-1:sha-123456",
              pgeVersion: "report-1:v1",
              governedEvidenceRefs: [],
            },
          ],
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const decisionResult = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-decision-node-edge-refs",
        decision: {
          expectedContextRevision: 2,
          mode: ASSESSMENT_INTERVIEW_MODES.initialInterview,
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          activeQuestion: {
            id: "q-decision-valid-refs",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
            prompt: "Is the node workflow active?",
            control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
            whyEvidenceRefs: [
              "evidence:symbol:valid_node_func",
              "evidence:flow:valid_edge_flow",
              "evidence:graph:global",
              "repositorySnapshot:snap-1",
              "technicalEvidenceReport:report-1",
            ],
            frontier: {
              owner: INTERVIEW_FRONTIER_OWNERS.customer,
              materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
              description: "Valid node and edge governance check",
              evidenceRefs: ["evidence:symbol:valid_node_func"],
            },
          },
        },
      });

      expect(decisionResult.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      );
      expect(mockInterviewAudit.recordQuestionPersisted).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: "q-decision-valid-refs",
          whyEvidenceRefs: expect.arrayContaining([
            "evidence:symbol:valid_node_func",
            "evidence:flow:valid_edge_flow",
          ]),
        }),
        mockTx,
      );
    });

    it("rejects recordAgentDecision when confirmedContext contains fabricated evidence refs", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce(
        targetedResolutionThreadFixture(),
      );

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-target-fake-statement-ref",
          decision: {
            expectedContextRevision: 2,
            mode: "INVESTIGATOR_RESOLUTION",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
            contextAuthority:
              ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
            confirmedContext: {
              version: "v1",
              assessmentId: "assessment-1",
              authority:
                CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
              confirmedAt: new Date().toISOString(),
              statements: [
                {
                  statementId: "stmt-1",
                  assessmentId: "assessment-1",
                  topic: "decision_authority",
                  statement: "Data is stored in eu-central-1.",
                  normalizedValue: "eu-central-1",
                  scope: { kind: "REGION" },
                  respondentRef: "actor:authenticated:user-1",
                  createdAt: new Date().toISOString(),
                  source: "CUSTOMER_CONFIRMED",
                  resolutionState: "CONFIRMED",
                  evidenceRefs: ["evidence:fabricated:attacker_ref_999"],
                },
              ],
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED" },
        },
      });
    });

    it("rejects TargetedNeed governedEvidenceRefs that are not in the pinned accepted PGE", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
          contextRevision: 2,
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });
      mockTx.technicalEvidenceReport.findFirst.mockResolvedValueOnce({
        id: "report-1",
        schemaVersion: "v1",
        evidencePayload: {
          technicalCoverageState: "READY",
          coverageLimitations: [],
          programEvidenceGraph: {
            coverage_state: "SUFFICIENT",
            coverage_notes: [],
            evidence_refs: ["evidence:symbol:legitimate_ref"],
            nodes: [],
            edges: [],
          },
        },
      });

      await expect(
        service.registerTargetedNeedForWorker({
          assessmentId: "assessment-1",
          correlationId: "corr-target-fabricated-ref",
          target: {
            actorId: "user-1",
            needId: "need-fabricated-ref",
            businessContextNeed: "Who approves this action?",
            resolutionCriteria: ["decision_authority"],
            governedEvidenceRefs: ["evidence:fabricated:cross_assessment_999"],
            originatingInvestigationReference:
              "investigator:exec-1:need-fabricated-ref",
            investigatorExecutionId: "exec-1",
            workflowRunId: "20000000-0000-4000-8000-000000000001",
            checkpointId: "cp-target-1",
            affectedRuleIds: ["ENG-1"],
            artifactVersions: {
              technicalEvidenceReportId: "report-1",
              repositorySnapshotId: "snap-1",
              legalRuleCatalogVersionId: "catalog-1",
              legalCorpusVersionId: "corpus-1",
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_EVIDENCE_REF_UNAUTHORIZED" },
        },
      });
    });

    it("materializes confirmed statement authority from the authenticated private revision instead of model fields", async () => {
      const thread = targetedResolutionThreadFixture();
      const privateContext = thread.privateContextJson as {
        revisions: Array<{ answeredAt: string }>;
      };
      const authoritativeAnsweredAt = privateContext.revisions[0].answeredAt;
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce(thread);

      const result = await service.recordAgentDecision({
        assessmentId: "assessment-1",
        correlationId: "corr-runtime-owned-confirmed-context",
        decision: {
          expectedContextRevision: 2,
          mode: "INVESTIGATOR_RESOLUTION",
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
          contextAuthority:
            ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
          confirmedContext: {
            authority:
              CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
            statements: [
              {
                statementId: "stmt-runtime-owned",
                assessmentId: "attacker-assessment",
                topic: "decision_authority",
                statement: "A human manager approves before action.",
                normalizedValue: "human_manager",
                scope: { needId: "need-1" },
                evidenceRefs: ["technicalEvidenceReport:report-1"],
                respondentRef: "actor:authenticated:attacker-user",
                createdAt: "1999-01-01T00:00:00.000Z",
                source: "CUSTOMER_STATED",
                resolutionState: "CONFIRMED",
              },
            ],
          },
        },
      });

      const confirmed = result.confirmedContext as {
        assessmentId: string;
        contextRevision: number;
        createdByActorRef: string;
        statements: Array<Record<string, unknown>>;
      };
      expect(confirmed.assessmentId).toBe("assessment-1");
      expect(confirmed.contextRevision).toBe(2);
      expect(confirmed.createdByActorRef).toBe("actor:authenticated:user-1");
      expect(confirmed.statements[0]).toMatchObject({
        assessmentId: "assessment-1",
        respondentRef: "actor:authenticated:user-1",
        createdAt: authoritativeAnsweredAt,
        source: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
        resolutionState: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
      });
      expect(confirmed.statements[0]?.respondentRef).not.toBe(
        "actor:authenticated:attacker-user",
      );
    });

    it("omits internal actorId from Customer-facing answer history", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
          contextRevision: 2,
          answerHistory: [
            {
              questionId: "q-history-1",
              answeredAt: "2026-09-05T00:00:00Z",
              actorId: "internal-user-id-should-not-leak",
              summary: "Customer supplied free-text Interview context.",
            },
          ],
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const output = await service.getState("assessment-1", {
        userId: "user-1",
        role: AUTH_USER_ROLES.customer,
      } as never);
      expect(output.answerHistory).toHaveLength(1);
      expect(output.answerHistory?.[0]?.summary).toContain("Customer supplied");
      expect(output.answerHistory?.[0]?.actorId).toBeUndefined();
    });

    it("sanitizes injected secrets and sensitive tokens from Customer-facing state projection", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-secret-leak",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          activeQuestion: {
            id: "q-secret-leak",
            needId: "need-auth",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
            control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
            prompt:
              "Check Bearer eyJhbGciOiJIUzI1NiJ9.secret in /Users/admin/app/secret.py",
            whyAreWeAsking:
              "Database is postgres://admin:secret123@db.internal:5432/app with token_abc1234567890def",
            whyEvidenceRefs: ["evidence:symbol:auth"],
            choices: [
              {
                id: "c-1",
                label: "Option with Bearer sec_tok_abcdef123456",
                description: "Path at /var/run/secrets/token",
              },
            ],
            priorAnswerSummary: "Prior answer had postgres://user:pwd@host/db",
            frontier: {
              owner: INTERVIEW_FRONTIER_OWNERS.customer,
              materiality: INTERVIEW_FRONTIER_MATERIALITIES.material,
              description: "Frontier for /etc/passwd and Bearer sec_1234567890",
            },
          },
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const actor = {
        userId: "user-1",
        role: AUTH_USER_ROLES.customer,
      };
      const publicOutput = await service.getState(
        "assessment-1",
        actor as never,
      );
      const q = publicOutput.activeQuestion!;

      // Verify secrets redacted
      expect(q.prompt).not.toContain("Bearer eyJhbGciOiJIUzI1NiJ9.secret");
      expect(q.prompt).not.toContain("/Users/admin/app/secret.py");
      expect(q.whyAreWeAsking).not.toContain(
        "postgres://admin:secret123@db.internal:5432/app",
      );
      expect(q.choices?.[0]?.label).not.toContain(
        "Bearer sec_tok_abcdef123456",
      );
      expect(q.choices?.[0]?.description).not.toContain(
        "/var/run/secrets/token",
      );
      expect(q.priorAnswerSummary).not.toContain("postgres://user:pwd@host/db");
      expect(q.frontier?.description).not.toContain("/etc/passwd");
      expect(q.frontier?.description).not.toContain("Bearer sec_1234567890");

      // Verify no audit or internal version leakage in public projection
      expect(
        (publicOutput as unknown as Record<string, unknown>).audit,
      ).toBeUndefined();
      expect(
        (publicOutput as unknown as Record<string, unknown>).sourceVersion,
      ).toBeUndefined();
      expect(
        (publicOutput as unknown as Record<string, unknown>).pgeVersion,
      ).toBeUndefined();
      expect(
        (publicOutput as unknown as Record<string, unknown>)
          .governedEvidenceRefs,
      ).toBeUndefined();
    });

    it("strips stored internal audit refs from public state and runtime event projections", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValueOnce({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-1",
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 1,
          activeQuestion: {
            id: "q-1",
            intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
            control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
            prompt: "Please explain the system purpose.",
          },
          audit: {
            authenticatedActorId: "actor-leak-internal-123",
            timestamp: "2026-09-07T00:00:00.000Z",
            assessmentId: "assessment-1",
            sourceVersion: "snap-1:sha-123456",
            pgeVersion: "report-1:v1",
            guidanceVersion: "guidance-v1",
            sessionId: "session-leak-internal-456",
            turnId: "turn-leak-internal-789",
            contextRevision: 1,
            governedEvidenceRefs: ["secret:governed:evidence:ref:1"],
          },
        },
        privateContextJson: {
          revisions: [],
          workflowRunId: "10000000-0000-4000-8000-000000000001",
        },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
      });

      const actor = {
        userId: "user-1",
        role: AUTH_USER_ROLES.customer,
      };
      const publicOutput = await service.getState(
        "assessment-1",
        actor as never,
      );

      expect(
        (publicOutput as unknown as Record<string, unknown>).audit,
      ).toBeUndefined();
      expect(JSON.stringify(publicOutput)).not.toContain(
        "actor-leak-internal-123",
      );
      expect(JSON.stringify(publicOutput)).not.toContain(
        "session-leak-internal-456",
      );
      expect(JSON.stringify(publicOutput)).not.toContain(
        "turn-leak-internal-789",
      );
      expect(JSON.stringify(publicOutput)).not.toContain(
        "secret:governed:evidence:ref:1",
      );
    });
  });
});
