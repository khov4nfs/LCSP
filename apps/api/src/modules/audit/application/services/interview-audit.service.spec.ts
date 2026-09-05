import { jest } from "@jest/globals";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_RESOURCE_TYPES,
  INTERVIEW_AUDIT_EVENT_TYPES,
  type AuditEventInput,
} from "@lcsp/contracts/audit";
import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_ANSWER_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
} from "@lcsp/contracts/evidence";

import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { InterviewAuditService } from "./interview-audit.service.js";

describe("InterviewAuditService", () => {
  let service: InterviewAuditService;
  let writeMock: jest.Mock<(event: AuditEventInput) => Promise<void>>;
  let writeInTxMock: jest.Mock<
    (event: AuditEventInput, tx: unknown) => Promise<void>
  >;

  beforeEach(() => {
    writeMock = jest
      .fn<(event: AuditEventInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    writeInTxMock = jest
      .fn<(event: AuditEventInput, tx: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const auditWriter = {
      write: writeMock,
      writeInTx: writeInTxMock,
    } as unknown as AuditWriterService;
    service = new InterviewAuditService(auditWriter);
  });

  describe("recordStatement", () => {
    it("persists a material context statement with trusted actor identity and full provenance", async () => {
      await service.recordStatement({
        assessmentId: "assessment-123",
        respondentRef: {
          id: "user-456",
          role: "CUSTOMER",
          name: "Alice Owner",
          authenticated: true,
        },
        interviewContextRevision: "rev-2",
        sessionId: "session-789",
        threadId: "thread-abc",
        turnId: 3,
        statementKey: "data_residency",
        statementValue: "EU_CENTRAL",
        questionId: "q-residency-1",
        questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        interpretation: "Customer confirmed data residency in EU Central.",
        evidenceRefs: ["ev-101", "ev-102"],
        sourceSnapshot: {
          snapshotId: "snap-001",
          commitSha: "abc123456",
          guidanceVersion: "v1.2",
          pgeVersion: "pge-v2",
          sourceVersion: "source-v7",
          technicalCoverageState: "READY",
          coverageLimitations: [],
        },
        runId: "run-statement-1",
        stage: "INITIAL_INTERVIEW",
        modelId: "model-1",
        correlationId: "corr-statement-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];

      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.statementRecorded,
      );
      expect(event.actorId).toBe("user-456");
      expect(event.actor).toEqual({
        id: "user-456",
        type: AUDIT_ACTOR_TYPES.user,
        role: "CUSTOMER",
        name: "Alice Owner",
        authenticated: true,
      });
      expect(event.resourceType).toBe(AUDIT_RESOURCE_TYPES.assessment);
      expect(event.resourceId).toBe("assessment-123");
      expect(event.correlationId).toBe("corr-statement-1");
      expect(event.sessionId).toBe("session-789");

      const payload = event.payload as Record<string, unknown>;
      expect(payload.statementKey).toBe("data_residency");
      expect(payload.statementValue).toBe("EU_CENTRAL");
      expect(payload.interviewContextRevision).toBe("rev-2");
      expect(payload.threadId).toBe("thread-abc");
      expect(payload.turnId).toBe(3);
      expect(payload.questionId).toBe("q-residency-1");
      expect(payload.questionIntent).toBe("CLARIFY");
      expect(payload.interpretation).toBe(
        "Customer confirmed data residency in EU Central.",
      );
      expect(payload.evidenceRefs).toEqual(["ev-101", "ev-102"]);
      expect(payload.sourceSnapshot).toEqual({
        snapshotId: "snap-001",
        commitSha: "abc123456",
        guidanceVersion: "v1.2",
        pgeVersion: "pge-v2",
        sourceVersion: "source-v7",
        technicalCoverageState: "READY",
        coverageLimitations: [],
      });
    });

    it("enforces authenticated actor identity from runtime context, rejecting unauthenticated actors", async () => {
      await expect(
        service.recordStatement({
          assessmentId: "assessment-123",
          respondentRef: {
            id: "user-456",
            // @ts-expect-error Testing runtime check against fake identity
            authenticated: false,
          },
          interviewContextRevision: "rev-1",
          sessionId: "session-1",
          threadId: "thread-1",
          turnId: 1,
          statementKey: "role",
          statementValue: "Product Owner",
          sourceSnapshot: {
            sourceVersion: "src-1",
            pgeVersion: "pge-1",
          },
          correlationId: "corr-fail",
        }),
      ).rejects.toThrow(
        "Interview audit respondent must come from authenticated runtime context",
      );
    });
  });

  describe("recordQuestionPersisted", () => {
    it("persists a question persisted event", async () => {
      await service.recordQuestionPersisted({
        assessmentId: "assessment-123",
        questionId: "q-1",
        questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        prompt: "Where is customer PII stored?",
        control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        choices: [],
        whyEvidenceRefs: ["ev-1"],
        threadId: "thread-1",
        turnId: 0,
        sourceSnapshot: {
          sourceVersion: "src-1",
          pgeVersion: "pge-1",
        },
        correlationId: "corr-q-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.questionPersisted,
      );
      expect(event.actor).toEqual({
        id: AUDIT_ACTOR_IDS.interviewAgent,
        type: AUDIT_ACTOR_TYPES.service,
        authenticated: false,
      });
      expect(event.payload).toMatchObject({
        questionId: "q-1",
        questionIntent: "ASK",
        prompt: "Where is customer PII stored?",
      });
    });
  });

  describe("recordCustomerAnswer", () => {
    it("persists customer answer recorded event", async () => {
      await service.recordCustomerAnswer({
        assessmentId: "assessment-123",
        respondentRef: {
          id: "user-456",
          role: "CUSTOMER",
          name: "Alice Owner",
          authenticated: true,
        },
        questionId: "q-1",
        questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        responseMode: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
        responseAction: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm,
        answerValue: "Stored in AWS RDS PostgreSQL with KMS encryption.",
        interviewContextRevision: "rev-1",
        threadId: "thread-1",
        turnId: 1,
        sourceSnapshot: {
          sourceVersion: "src-1",
          pgeVersion: "pge-1",
        },
        evidenceRefs: ["ev-1"],
        correlationId: "corr-ans-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.customerAnswerRecorded,
      );
      expect(event.actorId).toBe("user-456");
      expect(event.payload).toMatchObject({
        questionId: "q-1",
        questionIntent: "CLARIFY",
        responseAction: ASSESSMENT_INTERVIEW_ANSWER_ACTIONS.confirm,
        answerValue: "Stored in AWS RDS PostgreSQL with KMS encryption.",
      });
    });
  });

  describe("recordContextRevisionCreated", () => {
    it("persists context revision created event", async () => {
      await service.recordContextRevisionCreated({
        assessmentId: "assessment-123",
        respondentRef: {
          id: "user-456",
          role: "CUSTOMER",
          authenticated: true,
        },
        contextRevision: 2,
        priorRevision: 1,
        authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
        statementKey: "q-1",
        statementValue: "AWS RDS",
        threadId: "thread-1",
        turnId: 2,
        sourceSnapshot: {
          sourceVersion: "src-1",
          pgeVersion: "pge-1",
        },
        governedEvidenceRefs: ["ev-1"],
        correlationId: "corr-rev-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.contextRevisionCreated,
      );
      expect(event.payload).toMatchObject({
        contextRevision: "2",
        priorRevision: "1",
        authority: "CUSTOMER_STATED",
        statementKey: "q-1",
      });
    });
  });

  describe("recordInterviewOutcome", () => {
    it("persists interview outcome recorded event", async () => {
      await service.recordInterviewOutcome({
        assessmentId: "assessment-123",
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        summary: "Context is ready for reconciliation.",
        contextRevision: 3,
        threadId: "thread-1",
        guidanceVersion: "guidance-v3",
        correlationId: "corr-outcome-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.interviewOutcomeRecorded,
      );
      expect(event.payload).toMatchObject({
        outcome: "CONTEXT_READY",
        summary: "Context is ready for reconciliation.",
        contextRevision: "3",
        guidanceVersion: "guidance-v3",
      });
    });
  });

  describe("recordConfirmation", () => {
    it("records an explicit confirmation event with statement reference", async () => {
      await service.recordConfirmation({
        assessmentId: "assessment-123",
        respondentRef: {
          id: "user-456",
          role: "CUSTOMER",
          name: "Alice Owner",
          authenticated: true,
        },
        interviewContextRevision: "rev-3",
        sessionId: "session-789",
        threadId: "thread-abc",
        turnId: 4,
        statementKey: "data_retention_days",
        statementValue: 365,
        questionId: "q-retention",
        questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
        interpretation: "Customer confirmed 365 days retention period.",
        sourceSnapshot: {
          sourceVersion: "src-1",
          pgeVersion: "pge-1",
        },
        correlationId: "corr-confirm-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.statementConfirmed,
      );
      expect(event.actorId).toBe("user-456");
      const payload = event.payload as Record<string, unknown>;
      expect(payload.statementKey).toBe("data_retention_days");
      expect(payload.statementValue).toBe(365);
    });
  });

  describe("recordSupersession", () => {
    it("records an INTERVIEW_CONTEXT_SUPERSEDED event preserving prior and new values with revisions", async () => {
      await service.recordSupersession({
        assessmentId: "assessment-123",
        respondentRef: {
          id: "user-456",
          role: "CUSTOMER",
          authenticated: true,
        },
        priorRevision: "rev-2",
        newRevision: "rev-3",
        statementKey: "data_residency",
        priorValue: "EU_CENTRAL",
        newValue: "US_EAST",
        sessionId: "session-789",
        threadId: "thread-abc",
        turnId: 5,
        questionId: "q-residency-correction",
        questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
        sourceSnapshot: {
          sourceVersion: "src-1",
          pgeVersion: "pge-1",
        },
        correlationId: "corr-super-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.contextSuperseded,
      );

      const payload = event.payload as Record<string, unknown>;
      expect(payload.statementKey).toBe("data_residency");
      expect(payload.priorValue).toBe("EU_CENTRAL");
      expect(payload.priorRevision).toBe("rev-2");
      expect(payload.newValue).toBe("US_EAST");
      expect(payload.newRevision).toBe("rev-3");
    });
  });

  describe("recordCrossRespondentConflict", () => {
    it("records an INTERVIEW_CONTEXT_CONFLICT_RECORDED event preserving both conflicting respondents", async () => {
      await service.recordCrossRespondentConflict({
        assessmentId: "assessment-123",
        statementKey: "cloud_provider",
        firstRespondentRef: {
          id: "user-alice",
          role: "CUSTOMER",
          name: "Alice",
          authenticated: true,
        },
        firstStatementValue: "AWS",
        firstTurnId: 2,
        secondRespondentRef: {
          id: "user-bob",
          role: "CUSTOMER",
          name: "Bob",
          authenticated: true,
        },
        secondStatementValue: "GCP",
        secondTurnId: 4,
        interviewContextRevision: "rev-4",
        sessionId: "session-789",
        threadId: "thread-abc",
        correlationId: "corr-conflict-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.contextConflicted,
      );
      expect(event.actorId).toBe("user-bob");

      const payload = event.payload as Record<string, unknown>;
      expect(payload.statementKey).toBe("cloud_provider");
      expect(payload.conflict).toMatchObject({
        firstRespondent: {
          id: "user-alice",
          name: "Alice",
        },
        firstValue: "AWS",
        firstTurnId: 2,
        secondRespondent: {
          id: "user-bob",
          name: "Bob",
        },
        secondValue: "GCP",
        secondTurnId: 4,
      });
    });
  });

  describe("recordTargetedClarification", () => {
    it("records targeted clarification with originating investigation reference", async () => {
      await service.recordTargetedClarification({
        assessmentId: "assessment-123",
        originatingInvestigationReference: "inv-rule-9988",
        interviewContextRevision: "rev-4",
        sessionId: "session-789",
        threadId: "thread-abc",
        runId: "run-456",
        stage: "TARGETED_INVESTIGATION",
        guidanceVersion: "guidance-v2",
        modelId: "gpt-4o-mini",
        correlationId: "corr-target-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const event = writeMock.mock.calls[0][0];
      expect(event.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.targetedClarificationStarted,
      );
      expect(event.actor).toEqual(
        expect.objectContaining({
          id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
          type: AUDIT_ACTOR_TYPES.service,
          authenticated: false,
        }),
      );

      const payload = event.payload as Record<string, unknown>;
      expect(payload.originatingInvestigationReference).toBe("inv-rule-9988");
      expect(payload.stage).toBe("TARGETED_INVESTIGATION");
      expect(payload.runId).toBe("run-456");
    });
  });

  describe("recordDownstreamImpact and recordOrchestrationRerun", () => {
    it("distinguishes DOWNSTREAM_IMPACT emission by Interview from selective rerun by Orchestration", async () => {
      // 1. Interview agent emits DOWNSTREAM_IMPACT
      await service.recordDownstreamImpact({
        assessmentId: "assessment-123",
        interviewContextRevision: "rev-5",
        affectedActivities: ["reconciliation", "classification_review"],
        summary:
          "Context changed data residency from EU to US, requiring re-check.",
        sessionId: "session-789",
        threadId: "thread-abc",
        runId: "interview-run-1",
        correlationId: "corr-impact-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(1);
      const impactEvent = writeMock.mock.calls[0][0];
      expect(impactEvent.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.downstreamImpactEmitted,
      );
      expect(impactEvent.actor).toEqual(
        expect.objectContaining({
          id: AUDIT_ACTOR_IDS.interviewAgent,
          type: AUDIT_ACTOR_TYPES.service,
          authenticated: false,
        }),
      );
      expect(impactEvent.payload).toMatchObject({
        affectedActivities: ["reconciliation", "classification_review"],
      });

      // 2. Assessment Orchestration executes selective rerun
      await service.recordOrchestrationRerun({
        assessmentId: "assessment-123",
        actorId: "system-orchestrator",
        interviewContextRevision: "rev-5",
        rerunScope: ["reconciliation"],
        summary: "Selective rerun executed for reconciliation pipeline.",
        runId: "orchestrator-run-2",
        correlationId: "corr-rerun-1",
      });

      expect(writeMock).toHaveBeenCalledTimes(2);
      const rerunEvent = writeMock.mock.calls[1][0];
      expect(rerunEvent.eventType).toBe(
        INTERVIEW_AUDIT_EVENT_TYPES.orchestrationRerunTriggered,
      );
      expect(rerunEvent.actorId).toBe("system-orchestrator");
      expect(rerunEvent.actor).toEqual(
        expect.objectContaining({
          id: "system-orchestrator",
          type: AUDIT_ACTOR_TYPES.service,
          authenticated: false,
        }),
      );
      expect(rerunEvent.payload).toMatchObject({
        rerunScope: ["reconciliation"],
      });
    });
  });

  describe("transactional writes", () => {
    it("delegates to auditWriter.writeInTx when a transaction client is provided", async () => {
      const mockTx = { auditEvent: { create: jest.fn() } };
      await service.recordCustomerAnswer(
        {
          assessmentId: "assessment-123",
          respondentRef: {
            id: "user-456",
            role: "CUSTOMER",
            name: "Alice Owner",
            authenticated: true,
          },
          questionId: "q-1",
          questionIntent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
          responseMode: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          responseAction: "CONFIRM",
          answerValue: "TypeScript",
          interviewContextRevision: "1",
          sessionId: "thread-abc",
          threadId: "thread-abc",
          turnId: 1,
          sourceSnapshot: {
            sourceVersion: "v1",
            pgeVersion: "v1",
          },
          correlationId: "corr-tx-1",
        },
        mockTx as never,
      );

      expect(writeInTxMock).toHaveBeenCalledTimes(1);
      expect(writeMock).not.toHaveBeenCalled();
      expect(writeInTxMock.mock.calls[0][1]).toBe(mockTx);
      expect(writeInTxMock.mock.calls[0][0].sessionId).toBe("thread-abc");
    });
  });
});
