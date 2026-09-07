/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  INTERVIEW_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/audit";
import { HttpException, HttpStatus } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { GetInterviewAuditTrailHandler } from "./get-interview-audit-trail.handler.js";
import { GetInterviewAuditTrailQuery } from "./get-interview-audit-trail.query.js";

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
    throw new Error("expected promise to reject");
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
}

describe("GetInterviewAuditTrailHandler", () => {
  let handler: GetInterviewAuditTrailHandler;
  let findUniqueAssessmentMock: any;
  let findManyAuditEventsMock: any;
  let countAuditEventsMock: any;
  let redactor: AuditRedactorService;

  beforeEach(() => {
    findUniqueAssessmentMock = jest.fn();
    findManyAuditEventsMock = jest.fn();
    countAuditEventsMock = jest.fn();
    redactor = new AuditRedactorService();

    const prisma = {
      assessment: {
        findUnique: findUniqueAssessmentMock,
      },
      auditEvent: {
        findMany: findManyAuditEventsMock,
        count: countAuditEventsMock,
      },
    } as unknown as PrismaService;

    handler = new GetInterviewAuditTrailHandler(prisma, redactor);
  });

  it("successfully returns normalized interview audit trail for assessment owner with pagination", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "user-owner",
    });

    countAuditEventsMock.mockResolvedValue(2);
    findManyAuditEventsMock.mockResolvedValue([
      {
        id: "evt-1",
        eventType: INTERVIEW_AUDIT_EVENT_TYPES.statementConfirmed,
        actorId: "user-owner",
        correlationId: "corr-evt-1",
        sessionId: "session-1",
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
        payload: {
          actor: {
            id: "user-owner",
            type: AUDIT_ACTOR_TYPES.user,
            role: "CUSTOMER",
            name: "Alice Owner",
            authenticated: true,
          },
          statementKey: "primary_language",
          statementValue: "TypeScript",
          interviewContextRevision: "1",
          threadId: "thread-1",
          turnId: 2,
          runId: "run-1",
          guidanceVersion: "guidance-v1",
          modelId: "model-1",
          stage: "INITIAL_INTERVIEW",
          questionId: "q-lang",
          questionIntent: "CLARIFY",
          interpretation:
            "Customer confirmed TypeScript is the primary language.",
          evidenceRefs: ["ev-ts-1"],
          sourceSnapshot: {
            snapshotId: "snapshot-1",
            commitSha: "abc123",
            pgeVersion: "pge-v1",
            technicalCoverageState: "READY",
          },
          respondentRef: {
            id: "user-owner",
            role: "CUSTOMER",
            name: "Alice Owner",
            authenticated: true,
          },
        },
      },
      {
        id: "evt-2",
        eventType: INTERVIEW_AUDIT_EVENT_TYPES.contextSuperseded,
        actorId: "user-owner",
        correlationId: "corr-evt-2",
        sessionId: "session-1",
        createdAt: new Date("2026-09-01T10:30:00.000Z"),
        payload: {
          actor: {
            id: "user-owner",
            type: AUDIT_ACTOR_TYPES.user,
            role: "CUSTOMER",
            name: "Alice Owner",
            authenticated: true,
          },
          statementKey: "primary_language",
          priorValue: "TypeScript",
          priorRevision: "1",
          newValue: "TypeScript + Python",
          newRevision: "2",
          respondentRef: {
            id: "user-owner",
            role: "CUSTOMER",
            name: "Alice Owner",
            authenticated: true,
          },
        },
      },
    ]);

    const result = await handler.execute(
      new GetInterviewAuditTrailQuery(
        "assessment-1",
        "user-owner",
        AUTH_USER_ROLES.customer,
        undefined,
        "corr-trail-1",
        10,
        0,
      ),
    );

    expect(result.assessmentId).toBe("assessment-1");
    expect(result.total).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
    expect(result.events).toHaveLength(2);

    expect(result.events[0]).toEqual({
      id: "evt-1",
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.statementConfirmed,
      actorId: "user-owner",
      actorType: AUDIT_ACTOR_TYPES.user,
      actorRole: "CUSTOMER",
      actorName: "Alice Owner",
      respondentRef: {
        id: "user-owner",
        role: "CUSTOMER",
        name: "Alice Owner",
        authenticated: true,
      },
      assessmentId: "assessment-1",
      interviewContextRevision: "1",
      correlationId: "corr-evt-1",
      sessionId: "session-1",
      threadId: "thread-1",
      turnId: 2,
      runId: "run-1",
      guidanceVersion: "guidance-v1",
      modelId: "model-1",
      currentStage: "INITIAL_INTERVIEW",
      sourceSnapshot: {
        snapshotId: "snapshot-1",
        commitSha: "abc123",
        guidanceVersion: undefined,
        pgeVersion: "pge-v1",
        sourceVersion: undefined,
        technicalCoverageState: "READY",
        coverageLimitations: [],
      },
      statementKey: "primary_language",
      statementValue: "TypeScript",
      priorValue: undefined,
      priorRevision: undefined,
      isConflict: false,
      conflict: undefined,
      questionId: "q-lang",
      questionIntent: "CLARIFY",
      responseMode: undefined,
      responseAction: undefined,
      outcome: undefined,
      interpretation: "Customer confirmed TypeScript is the primary language.",
      evidenceRefs: ["ev-ts-1"],
      originatingInvestigationReference: undefined,
      downstreamImpact: false,
      affectedActivities: [],
      rerunScope: [],
      occurredAt: "2026-09-01T10:00:00.000Z",
    });

    expect(result.events[1]).toEqual({
      id: "evt-2",
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.contextSuperseded,
      actorId: "user-owner",
      actorType: AUDIT_ACTOR_TYPES.user,
      actorRole: "CUSTOMER",
      actorName: "Alice Owner",
      respondentRef: {
        id: "user-owner",
        role: "CUSTOMER",
        name: "Alice Owner",
        authenticated: true,
      },
      assessmentId: "assessment-1",
      interviewContextRevision: "2",
      correlationId: "corr-evt-2",
      sessionId: "session-1",
      threadId: undefined,
      turnId: undefined,
      runId: undefined,
      guidanceVersion: undefined,
      modelId: undefined,
      currentStage: undefined,
      sourceSnapshot: undefined,
      statementKey: "primary_language",
      statementValue: "TypeScript + Python",
      priorValue: "TypeScript",
      priorRevision: "1",
      isConflict: false,
      conflict: undefined,
      questionId: undefined,
      questionIntent: undefined,
      responseMode: undefined,
      responseAction: undefined,
      outcome: undefined,
      interpretation: undefined,
      evidenceRefs: [],
      originatingInvestigationReference: undefined,
      downstreamImpact: false,
      affectedActivities: [],
      rerunScope: [],
      occurredAt: "2026-09-01T10:30:00.000Z",
    });
  });

  it("throws 404 when assessment does not exist", async () => {
    findUniqueAssessmentMock.mockResolvedValue(null);

    const error = await captureError(
      handler.execute(
        new GetInterviewAuditTrailQuery(
          "non-existent",
          "user-1",
          AUTH_USER_ROLES.customer,
          undefined,
          "corr-404",
        ),
      ),
    );

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it("throws 404 when CUSTOMER user attempts to read another user's assessment (tenant isolation)", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "other-user",
    });

    const error = await captureError(
      handler.execute(
        new GetInterviewAuditTrailQuery(
          "assessment-1",
          "unauthorized-customer",
          AUTH_USER_ROLES.customer,
          undefined,
          "corr-tenant-isolation",
        ),
      ),
    );

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it("allows ADMIN user to retrieve interview audit trail across assessments", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "customer-1",
    });
    countAuditEventsMock.mockResolvedValue(0);
    findManyAuditEventsMock.mockResolvedValue([]);

    const result = await handler.execute(
      new GetInterviewAuditTrailQuery(
        "assessment-1",
        "admin-user",
        AUTH_USER_ROLES.admin,
        undefined,
        "corr-admin-read",
      ),
    );

    expect(result.assessmentId).toBe("assessment-1");
    expect(result.events).toEqual([]);
  });

  it("throws 404 if scope does not match assessment ID (tenant/assessment isolation)", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "user-owner",
    });

    const error = await captureError(
      handler.execute(
        new GetInterviewAuditTrailQuery(
          "assessment-1",
          "user-owner",
          AUTH_USER_ROLES.customer,
          "assessment:wrong-assessment",
          "corr-scope-mismatch",
        ),
      ),
    );

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it("applies secret redaction to audit event payload before returning", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "user-owner",
    });

    countAuditEventsMock.mockResolvedValue(1);
    findManyAuditEventsMock.mockResolvedValue([
      {
        id: "evt-redacted",
        eventType: INTERVIEW_AUDIT_EVENT_TYPES.statementRecorded,
        actorId: "user-owner",
        correlationId: "corr-redact",
        sessionId: "session-1",
        createdAt: new Date("2026-09-01T11:00:00.000Z"),
        payload: {
          statementKey: "api_key",
          statementValue: "secret-token-value",
          interviewContextRevision: "3",
          secretData: "must-be-redacted",
          passwordHash: "hash-to-remove",
        },
      },
    ]);

    const result = await handler.execute(
      new GetInterviewAuditTrailQuery(
        "assessment-1",
        "user-owner",
        AUTH_USER_ROLES.customer,
        undefined,
        "corr-redaction-test",
      ),
    );

    expect(result.events[0]?.statementValue).toBe("secret-token-value");
    expect(
      (result.events[0] as unknown as Record<string, unknown>).passwordHash,
    ).toBeUndefined();
  });

  it("correctly surfaces originatingInvestigationReference and downstreamImpact", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "user-owner",
    });

    countAuditEventsMock.mockResolvedValue(2);
    findManyAuditEventsMock.mockResolvedValue([
      {
        id: "evt-target",
        eventType: INTERVIEW_AUDIT_EVENT_TYPES.targetedClarificationStarted,
        actorId: null,
        correlationId: "corr-target",
        sessionId: "session-1",
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        payload: {
          originatingInvestigationReference: "inv-target-42",
          stage: "TARGETED_INVESTIGATION",
          interviewContextRevision: "4",
        },
      },
      {
        id: "evt-impact",
        eventType: INTERVIEW_AUDIT_EVENT_TYPES.downstreamImpactEmitted,
        actorId: null,
        correlationId: "corr-impact",
        sessionId: "session-1",
        createdAt: new Date("2026-09-01T12:05:00.000Z"),
        payload: {
          interviewContextRevision: "5",
          affectedActivities: ["reconciliation", "classification_review"],
        },
      },
    ]);

    const result = await handler.execute(
      new GetInterviewAuditTrailQuery(
        "assessment-1",
        "user-owner",
        AUTH_USER_ROLES.customer,
        undefined,
        "corr-investigation-test",
      ),
    );

    expect(result.events[0]?.originatingInvestigationReference).toBe(
      "inv-target-42",
    );
    expect(result.events[0]?.downstreamImpact).toBe(false);

    expect(result.events[1]?.downstreamImpact).toBe(true);
    expect(result.events[1]?.affectedActivities).toEqual([
      "reconciliation",
      "classification_review",
    ]);
  });

  it("surfaces orchestration rerun provenance and actor distinction", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "user-owner",
    });

    countAuditEventsMock.mockResolvedValue(1);
    findManyAuditEventsMock.mockResolvedValue([
      {
        id: "evt-rerun",
        eventType: INTERVIEW_AUDIT_EVENT_TYPES.orchestrationRerunTriggered,
        actorId: AUDIT_ACTOR_IDS.assessmentOrchestrator,
        correlationId: "corr-rerun",
        sessionId: "session-1",
        createdAt: new Date("2026-09-01T12:10:00.000Z"),
        payload: {
          actor: {
            id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
            type: AUDIT_ACTOR_TYPES.service,
            authenticated: false,
          },
          respondentRef: {
            id: "user-owner",
            role: "CUSTOMER",
            name: "Alice Owner",
            authenticated: true,
          },
          interviewContextRevision: "rev-7",
          threadId: "thread-7",
          runId: "orchestrator-run-7",
          guidanceVersion: "guidance-v7",
          modelId: "model-v7",
          stage: "RE_SCOPE",
          rerunScope: ["reconciliation", "classification_review"],
          sourceSnapshot: {
            snapshotId: "snapshot-7",
            pgeVersion: "pge-v7",
            technicalCoverageState: "PARTIAL",
            coverageLimitations: ["worker repository unavailable"],
          },
        },
      },
    ]);

    const result = await handler.execute(
      new GetInterviewAuditTrailQuery(
        "assessment-1",
        "user-owner",
        AUTH_USER_ROLES.customer,
        undefined,
        "corr-read-rerun",
      ),
    );

    expect(result.events[0]).toMatchObject({
      actorId: AUDIT_ACTOR_IDS.assessmentOrchestrator,
      actorType: AUDIT_ACTOR_TYPES.service,
      actorRole: null,
      actorName: null,
      respondentRef: {
        id: "user-owner",
        role: "CUSTOMER",
        name: "Alice Owner",
        authenticated: true,
      },
      interviewContextRevision: "rev-7",
      correlationId: "corr-rerun",
      sessionId: "session-1",
      threadId: "thread-7",
      runId: "orchestrator-run-7",
      guidanceVersion: "guidance-v7",
      modelId: "model-v7",
      currentStage: "RE_SCOPE",
      rerunScope: ["reconciliation", "classification_review"],
      sourceSnapshot: {
        snapshotId: "snapshot-7",
        pgeVersion: "pge-v7",
        technicalCoverageState: "PARTIAL",
        coverageLimitations: ["worker repository unavailable"],
      },
    });
  });

  it("returns preserved cross-respondent conflict detail and does not fabricate missing revision", async () => {
    findUniqueAssessmentMock.mockResolvedValue({
      id: "assessment-1",
      ownerId: "user-owner",
    });
    countAuditEventsMock.mockResolvedValue(1);
    findManyAuditEventsMock.mockResolvedValue([
      {
        id: "evt-conflict",
        eventType: INTERVIEW_AUDIT_EVENT_TYPES.contextConflicted,
        actorId: "user-bob",
        correlationId: "corr-conflict",
        sessionId: "session-1",
        createdAt: new Date("2026-09-01T12:15:00.000Z"),
        payload: {
          actor: {
            id: "user-bob",
            type: AUDIT_ACTOR_TYPES.user,
            role: "CUSTOMER",
            name: "Bob",
            authenticated: true,
          },
          respondentRef: {
            id: "user-bob",
            role: "CUSTOMER",
            name: "Bob",
            authenticated: true,
          },
          statementKey: "cloud_provider",
          conflict: {
            firstRespondent: {
              id: "user-alice",
              role: "CUSTOMER",
              name: "Alice",
              authenticated: true,
            },
            firstValue: "AWS",
            firstTurnId: 2,
            secondRespondent: {
              id: "user-bob",
              role: "CUSTOMER",
              name: "Bob",
              authenticated: true,
            },
            secondValue: "GCP",
            secondTurnId: 4,
          },
        },
      },
    ]);

    const result = await handler.execute(
      new GetInterviewAuditTrailQuery(
        "assessment-1",
        "user-owner",
        AUTH_USER_ROLES.customer,
        undefined,
        "corr-conflict-query",
      ),
    );

    expect(result.events[0]).toMatchObject({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.contextConflicted,
      isConflict: true,
      interviewContextRevision: null,
      statementKey: "cloud_provider",
      conflict: {
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
      },
    });
  });
});
