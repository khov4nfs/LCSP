import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_ORCHESTRATOR_ACTIONS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_INTERVIEW_WORKFLOW_EVENTS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES,
  INTERVIEW_FRONTIER_MATERIALITIES,
  INTERVIEW_FRONTIER_OWNERS,
  POST_FINDING_RUNTIME_PHASES,
  REMEDIATION_APPROVAL_STATUSES,
  REMEDIATION_DECISIONS,
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

const TEST_GUIDANCE_VERSION = "interview-context-test-v1";

function confirmedStructuredContext(input: {
  assessmentId?: string;
  contextRevision?: number;
  topic?: string;
  source?: string;
  resolutionState?: string;
  evidenceRefs?: string[];
}): Record<string, unknown> {
  const topic = input.topic ?? "decision_authority";
  return {
    assessmentId: input.assessmentId ?? "assessment-1",
    contextRevision: input.contextRevision ?? 2,
    authority:
      CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
    statements: [
      {
        statementId: `stmt-${topic}`,
        assessmentId: input.assessmentId ?? "assessment-1",
        topic,
        statement: "Human approval is required before action.",
        normalizedValue: "human_approval_required",
        scope: { needId: "need-1" },
        evidenceRefs: input.evidenceRefs ?? [
          "technicalEvidenceReport:report-1",
        ],
        respondentRef: "actor:authenticated:user-1",
        createdAt: "2026-09-05T00:00:00Z",
        source:
          input.source ??
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
        resolutionState:
          input.resolutionState ??
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
      },
    ],
    limitations: ["customer-confirmed current statements only"],
    sourceVersionRef: "snap-1:sha-123456",
    pgeVersion: "report-1:v1",
    guidanceVersion: "guidance-1",
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

type MockPrismaDelegates = {
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
  recordToolWaitingInput: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordToolCompleted: jest.Mock<(...args: unknown[]) => Promise<void>>;
  recordToolFailed: jest.Mock<(...args: unknown[]) => Promise<void>>;
  getLatestPostFindingState: jest.Mock<
    () => Promise<AssessmentPostFindingRuntimeState | null>
  >;
};

describe("AssessmentInterviewRuntimeService Audit & Provenance Emission", () => {
  let service: AssessmentInterviewRuntimeService;
  let mockTx: MockPrismaDelegates;
  let mockOutboxRepository: MockOutboxRepository;
  let mockInterviewAudit: MockInterviewAudit;
  let mockInterviewGuidanceResolver: {
    resolveActiveGuidanceVersion: jest.Mock<() => string>;
  };
  let mockRuntimeEvents: MockRuntimeEvents;

  beforeEach(() => {
    mockTx = {
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

    const mockPrisma = {
      ...mockTx,
      $transaction: jest.fn(
        async <T>(cb: (tx: MockPrismaDelegates) => Promise<T>): Promise<T> =>
          cb(mockTx),
      ),
    };

    mockOutboxRepository = {
      enqueue: jest
        .fn<(...args: unknown[]) => Promise<string>>()
        .mockResolvedValue("outbox-1"),
    };

    mockRuntimeEvents = {
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
        answer: {
          questionId: "q-1",
          confirmed: true,
        },
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
      const submit = (answer: Record<string, unknown>) =>
        service.submitAnswer({
          assessmentId: "assessment-1",
          actor: {
            userId: "user-1",
            sessionId: "session-1",
            role: AUTH_USER_ROLES.customer,
            scope: "assessment:assessment-1",
          },
          correlationId: "corr-submit-control",
          answer: answer as { questionId: string },
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
        submit({ questionId: "q-free-text", confirmed: true }),
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
        submit({ questionId: "q-confirm-adjust", adjusted: true }),
      ).rejects.toMatchObject({
        response: { code: "INTERVIEW_ANSWER_CONTROL_INVALID" },
      });

      const adjusted = await submit({
        questionId: "q-confirm-adjust",
        adjusted: true,
        freeText: "A senior manager approves before action.",
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
        answer: {
          questionId: "q-bool",
          selectedChoiceIds: ["yes"],
        },
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
        answer: {
          questionId: "q-multi",
          selectedChoiceIds: ["soc2", "iso27001"],
        },
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
              answer: { questionId: "q-1", freeText: "ans" },
              actorId: "user-1",
              answeredAt: "2026-09-07T00:00:00.000Z",
              contextRevision: 1,
              priorRevision: 0,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
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

    it("accepts targeted resolution criteria from confirmed structured context topics", async () => {
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
          confirmedContext: confirmedStructuredContext({}),
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
              resolutionState: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
            }),
          ],
        },
      });
    });

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
              answer: { questionId: "q-1", freeText: "Human approval" },
              actorId: "user-1",
              answeredAt: "2026-09-07T00:00:00.000Z",
              contextRevision: 1,
              priorRevision: 0,
              authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
              questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              questionControl: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
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
          contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed,
          confirmedContext: confirmedStructuredContext({
            contextRevision: 1,
          }),
        },
      });

      expect(result.outcome).toBe(ASSESSMENT_INTERVIEW_OUTCOMES.contextReady);
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

    it("rejects structured targeted resolution criteria from non-confirmed statements", async () => {
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
            confirmedContext: confirmedStructuredContext({
              resolutionState: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.uncertain,
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
