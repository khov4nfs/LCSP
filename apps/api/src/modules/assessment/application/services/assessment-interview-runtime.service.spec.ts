import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { InterviewAuditService } from "../../../audit/application/services/interview-audit.service.js";
import { AssessmentInterviewRuntimeService } from "./assessment-interview-runtime.service.js";

type MockPrismaDelegates = {
  assessment: {
    findUnique: jest.Mock<() => Promise<{ id: string; ownerId: string }>>;
  };
  assessmentInterviewThread: {
    findUnique: jest.Mock<() => Promise<unknown>>;
    updateMany: jest.Mock<() => Promise<{ count: number }>>;
    upsert: jest.Mock<() => Promise<Record<string, unknown>>>;
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
          technicalCoverageState: string;
          coverageLimitations: string[];
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

describe("AssessmentInterviewRuntimeService Audit & Provenance Emission", () => {
  let service: AssessmentInterviewRuntimeService;
  let mockTx: MockPrismaDelegates;
  let mockOutboxRepository: MockOutboxRepository;
  let mockInterviewAudit: MockInterviewAudit;

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
        findUnique: jest.fn<() => Promise<unknown>>(),
        updateMany: jest
          .fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
        upsert: jest
          .fn<() => Promise<Record<string, unknown>>>()
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

    const mockRuntimeEvents = {
      recordToolWaitingInput: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
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

    service = new AssessmentInterviewRuntimeService(
      mockPrisma as unknown as PrismaService,
      mockRuntimeEvents as unknown as AssessmentRuntimeEventService,
      mockOutboxRepository as unknown as OutboxRepository,
      mockInterviewAudit as unknown as InterviewAuditService,
    );
  });

  describe("submitAnswer", () => {
    it("atomically records customer answer and context revision audit events in the same transaction", async () => {
      const activeState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextRevision: 1,
        activeQuestion: {
          id: "q-1",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "What is your data residency?",
          control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
        },
      };

      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 1,
        processedRevision: 0,
        activeQuestionId: "q-1",
        stateJson: activeState,
        privateContextJson: { revisions: [] },
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
          questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
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
        privateContextJson: { revisions: [] },
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
        privateContextJson: { revisions: [] },
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
        privateContextJson: { revisions: [] },
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
        privateContextJson: { revisions: [] },
        sourceVersion: "snap-1:sha-123456",
        pgeVersion: "report-1:v1",
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
          workflowRunId: "run-10",
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
                workflowRunId: "run-10",
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
          runId: "run-10",
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
        privateContextJson: { revisions: [] },
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
            workflowRunId: "run-leak",
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
          },
          flags: ["DOWNSTREAM_IMPACT"],
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
            confirmedContext: { decision_authority: "human" },
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

    it("rejects targeted bootstrap questions that escape the registered need", async () => {
      mockTx.assessmentInterviewThread.findUnique.mockResolvedValue({
        assessmentId: "assessment-1",
        contextRevision: 2,
        processedRevision: 2,
        activeQuestionId: null,
        stateJson: {
          outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
          contextRevision: 2,
        },
        privateContextJson: {
          revisions: [],
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
            workflowRunId: "run-1",
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
      });

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-target-question",
          decision: {
            expectedContextRevision: 2,
            mode: "TARGETED_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
            activeQuestion: {
              id: "q-escape",
              needId: "need-other",
              intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
              control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
              prompt: "Who approves this action?",
            },
          },
        }),
      ).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { code: "INTERVIEW_TARGETED_QUESTION_NEED_MISMATCH" },
        },
      });
    });

    it("rejects targeted resolution without satisfied criteria", async () => {
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
            workflowRunId: "run-1",
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
      });

      await expect(
        service.recordAgentDecision({
          assessmentId: "assessment-1",
          correlationId: "corr-target-unsatisfied",
          decision: {
            expectedContextRevision: 2,
            mode: "TARGETED_INTERVIEW",
            outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
            contextAuthority:
              ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed,
            confirmedContext: { unrelated: "human" },
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
    it("atomically persists thread state and records question in transaction", async () => {
      const initialState: AssessmentInterviewRuntimeState = {
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: {
          id: "q-init-1",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          prompt: "What is your cloud environment?",
          control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
        },
      };

      const result = await service.seedInitialQuestionForWorker({
        assessmentId: "assessment-1",
        correlationId: "corr-seed-1",
        state: initialState,
      });

      expect(result.outcome).toBe(
        ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
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
  });
});
