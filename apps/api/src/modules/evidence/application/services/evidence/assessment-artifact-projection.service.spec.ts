import { jest } from "@jest/globals";
import {
  ASSESSMENT_ARTIFACT_STATUSES,
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  BUSINESS_CONTEXT_DIMENSION_STATUSES,
  BUSINESS_CONTEXT_SOURCES,
  BUSINESS_CONTEXT_RESOLUTION_STATES,
  CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES,
  INVESTIGATION_ASSESSMENT_OUTCOMES,
  INVESTIGATION_EVIDENCE_QUALITIES,
  INVESTIGATION_EXECUTION_STATUSES,
  INVESTIGATION_RULE_OUTCOMES,
  type AssessmentRuntimeActivityEvent,
  type AssessmentRuntimeEngineeringProgress,
  type ConfirmedStructuredBusinessContext,
} from "@lcsp/contracts/evidence";
import { ENGINEERING_RULE_EVALUATION_STATUSES } from "@lcsp/contracts/scan";

import { AssessmentArtifactProjectionService } from "./assessment-artifact-projection.service.js";

const ASSESSMENT_ID = "assessment-1";
const RUN_ID = "scan-1";
const PLANNER_AT = "2026-09-15T01:00:00.000Z";

function asyncUnknownMock() {
  return jest.fn<(...args: unknown[]) => Promise<unknown>>(() =>
    Promise.resolve(null),
  );
}

function buildService() {
  const prisma = {
    assessmentInterviewThread: {
      findUnique: asyncUnknownMock(),
    },
    repositoryScanJob: { findFirst: asyncUnknownMock() },
    technicalEvidenceReport: {
      findFirst: asyncUnknownMock(),
      findUnique: asyncUnknownMock(),
    },
    classificationResult: { findFirst: asyncUnknownMock() },
  };
  const runtimeEvents = {
    getLatestDurableEngineeringState: asyncUnknownMock(),
    getLatestAssessmentRunStart: asyncUnknownMock(),
  };
  const service = new AssessmentArtifactProjectionService(
    prisma as never,
    runtimeEvents as never,
  );
  return { service, prisma, runtimeEvents };
}

function confirmedContext(revision = 3): ConfirmedStructuredBusinessContext {
  return {
    assessmentId: ASSESSMENT_ID,
    contextRevision: revision,
    authority:
      CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly,
    statements: [
      {
        statementId: "statement-1",
        assessmentId: ASSESSMENT_ID,
        topic: "AI workflow and human review",
        statement:
          "The AI model supports a customer support workflow; staff review recommendations before action and the workflow uses customer records.",
        normalizedValue: { oversight: "manual review" },
        scope: {
          systemRefs: ["system-1"],
          workflowRefs: ["workflow-1"],
          actorGroupRefs: ["staff"],
        },
        respondentRef: "actor:customer",
        createdAt: "2026-09-15T00:00:00.000Z",
        source: BUSINESS_CONTEXT_SOURCES.customerConfirmed,
        resolutionState: BUSINESS_CONTEXT_RESOLUTION_STATES.confirmed,
        evidenceRefs: ["evidence-1"],
      },
    ],
  };
}

function plannerEvent(): AssessmentRuntimeActivityEvent {
  return {
    eventId: "planner-summary",
    sequence: 10,
    emittedAt: PLANNER_AT,
    assessmentId: ASSESSMENT_ID,
    runId: RUN_ID,
    correlationId: "corr-1",
    eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
    toolName: "engineering_rule_plan_summary",
    summary: "Planning summary",
    inputSummary: null,
    outputSummary: {
      planningBatchId: "batch-1",
      contextRevisionUsed: 3,
      candidateCount: 2,
      selectedCount: 2,
      skippedCount: 0,
      targeted: false,
    },
    errorSummary: null,
    startedAt: null,
    completedAt: PLANNER_AT,
    durationMs: null,
    attempt: null,
    waitingReason: null,
  };
}

function investigatorEvent(
  ruleId: string,
  sequence: number,
  eventType: AssessmentRuntimeActivityEvent["eventType"] = ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
  outputSummary: AssessmentRuntimeActivityEvent["outputSummary"] = null,
): AssessmentRuntimeActivityEvent {
  return {
    ...plannerEvent(),
    eventId: `event-${ruleId}-${sequence}`,
    sequence,
    emittedAt: `2026-09-15T01:${String(sequence).padStart(2, "0")}:00.000Z`,
    eventType,
    toolName: `engineering_rule_investigation:${ruleId}`,
    outputSummary,
  };
}

function progress(
  overrides: Partial<AssessmentRuntimeEngineeringProgress["investigator"]> = {},
): AssessmentRuntimeEngineeringProgress {
  return {
    assessmentId: ASSESSMENT_ID,
    runId: RUN_ID,
    planningBatchId: "batch-1",
    contextRevisionUsed: 3,
    targeted: false,
    approximate: false,
    planner: { candidateCount: 2, selectedCount: 2, skippedCount: 0 },
    investigator: {
      selectedCount: 2,
      completedCount: 2,
      domainLimitedCount: 0,
      limitedOrFailedCount: 0,
      waitingForInputCount: 0,
      runtimeFailedCount: 0,
      pendingCount: 0,
      ...overrides,
    },
  };
}

function primeInvestigation(
  fixture: ReturnType<typeof buildService>,
  options: {
    progress?: AssessmentRuntimeEngineeringProgress;
    events?: AssessmentRuntimeActivityEvent[];
    contextRevision?: number;
    classificationData?: unknown;
    latestRunId?: string;
    latestRunAt?: string;
  } = {},
) {
  const events = options.events ?? [
    investigatorEvent("rule-1", 11),
    investigatorEvent("rule-2", 12),
  ];
  fixture.runtimeEvents.getLatestDurableEngineeringState.mockResolvedValue({
    progress: options.progress ?? progress(),
    plannerEvent: plannerEvent(),
    investigationEvents: events,
  });
  fixture.runtimeEvents.getLatestAssessmentRunStart.mockResolvedValue({
    runId: options.latestRunId ?? RUN_ID,
    emittedAt: options.latestRunAt ?? "2026-09-15T00:59:00.000Z",
  });
  fixture.prisma.assessmentInterviewThread.findUnique.mockResolvedValue({
    contextRevision: options.contextRevision ?? 3,
  });
  fixture.prisma.repositoryScanJob.findFirst.mockResolvedValue({
    id: RUN_ID,
    updatedAt: new Date("2026-09-15T00:59:30.000Z"),
  });
  fixture.prisma.technicalEvidenceReport.findFirst.mockResolvedValue({
    id: "report-1",
    scanJobId: RUN_ID,
    createdAt: new Date("2026-09-15T00:59:45.000Z"),
  });
  fixture.prisma.technicalEvidenceReport.findUnique.mockResolvedValue({
    id: "report-1",
    snapshotId: "snapshot-1",
    createdAt: new Date("2026-09-15T00:59:45.000Z"),
  });
  fixture.prisma.classificationResult.findFirst.mockResolvedValue(
    options.classificationData === undefined
      ? null
      : {
          classificationData: options.classificationData,
          createdAt: new Date("2026-09-15T02:00:00.000Z"),
        },
  );
}

function evaluations(
  status1: string = ENGINEERING_RULE_EVALUATION_STATUSES.compliant,
) {
  return {
    evaluations: [
      {
        engineering_rule_id: "rule-1",
        concept: "Human oversight",
        status: status1,
        reason: "Validated evidence supports this outcome.",
        evidence_refs: ["evidence-1"],
        source_locators: ["graph-anchor-1"],
        limitations: [],
      },
      {
        engineering_rule_id: "rule-2",
        concept: "Decision control",
        status: ENGINEERING_RULE_EVALUATION_STATUSES.compliant,
        reason: "Validated evidence supports this outcome.",
        evidence_refs: ["evidence-2"],
        source_locators: ["graph-anchor-2"],
        limitations: [],
      },
    ],
  };
}

describe("AssessmentArtifactProjectionService", () => {
  it("does not mark Business Context READY when confirmed context does not exist", async () => {
    const fixture = buildService();
    fixture.prisma.assessmentInterviewThread.findUnique.mockResolvedValue(null);

    const artifact = await fixture.service.getBusinessContext(ASSESSMENT_ID);

    expect(artifact.status).toBe(ASSESSMENT_ARTIFACT_STATUSES.notAvailable);
    expect(artifact.content).toBeNull();
  });

  it("projects authoritative Business Context and preserves unknown rather than false", async () => {
    const fixture = buildService();
    const context = confirmedContext();
    context.statements[0].statement =
      "The AI model supports a customer support workflow with staff review.";
    fixture.prisma.assessmentInterviewThread.findUnique.mockResolvedValue({
      stateJson: { confirmedContext: context },
      contextRevision: 3,
      sourceVersion: "source-v3",
      pgeVersion: "pge-v2",
      updatedAt: new Date("2026-09-15T00:10:00.000Z"),
    });

    const artifact = await fixture.service.getBusinessContext(ASSESSMENT_ID);

    expect(artifact.status).toBe(ASSESSMENT_ARTIFACT_STATUSES.ready);
    expect(artifact.identity.contextRevision).toBe(3);
    expect(artifact.content?.confirmedStatements[0]?.scope).toContain(
      "1 systems",
    );
    expect(artifact.content?.dimensions).toContainEqual(
      expect.objectContaining({
        status: BUSINESS_CONTEXT_DIMENSION_STATUSES.unknown,
      }),
    );
    expect(JSON.stringify(artifact)).not.toContain('"UNKNOWN":false');
  });

  it("does not project an older Business Context revision as current READY", async () => {
    const fixture = buildService();
    fixture.prisma.assessmentInterviewThread.findUnique.mockResolvedValue({
      stateJson: { confirmedContext: confirmedContext(2) },
      contextRevision: 3,
      sourceVersion: "source-v3",
      pgeVersion: "pge-v2",
      updatedAt: new Date("2026-09-15T00:10:00.000Z"),
    });

    const artifact = await fixture.service.getBusinessContext(ASSESSMENT_ID);

    expect(artifact.status).toBe(ASSESSMENT_ARTIFACT_STATUSES.pending);
    expect(artifact.content).toBeNull();
  });

  it("does not mark Investigation Notes READY without durable investigation state", async () => {
    const fixture = buildService();
    fixture.runtimeEvents.getLatestDurableEngineeringState.mockResolvedValue(
      null,
    );

    const artifact = await fixture.service.getInvestigationNotes(ASSESSMENT_ID);

    expect(artifact.status).toBe(ASSESSMENT_ARTIFACT_STATUSES.notAvailable);
  });

  it("uses durable engineering progress for an in-progress Investigation Notes projection", async () => {
    const fixture = buildService();
    primeInvestigation(fixture, {
      progress: progress({ completedCount: 1, pendingCount: 1 }),
      events: [investigatorEvent("rule-1", 11)],
    });

    const artifact = await fixture.service.getInvestigationNotes(ASSESSMENT_ID);

    expect(artifact.status).toBe(ASSESSMENT_ARTIFACT_STATUSES.ready);
    expect(artifact.content?.summary).toMatchObject({
      selectedRules: 2,
      investigatedRules: 1,
      pendingRules: 1,
    });
    expect(artifact.content?.executionStatus).toBe(
      INVESTIGATION_EXECUTION_STATUSES.inProgress,
    );
  });

  it("keeps domain evidence limitation distinct from a runtime failure", async () => {
    const fixture = buildService();
    const events = [
      investigatorEvent(
        "rule-1",
        11,
        ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
        { failureKind: "DOMAIN_LIMITATION" },
      ),
      investigatorEvent(
        "rule-2",
        12,
        ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
        { failureKind: "RUNTIME_ERROR" },
      ),
    ];
    primeInvestigation(fixture, {
      progress: progress({
        completedCount: 0,
        domainLimitedCount: 1,
        runtimeFailedCount: 1,
        limitedOrFailedCount: 2,
      }),
      events,
    });

    const artifact = await fixture.service.getInvestigationNotes(ASSESSMENT_ID);

    expect(artifact.content?.rules[0]?.outcome).toBe(
      INVESTIGATION_RULE_OUTCOMES.unresolved,
    );
    expect(artifact.content?.rules[0]?.limitations).toContain(
      "UNRESOLVED_EVIDENCE",
    );
    expect(artifact.content?.rules[1]?.outcome).toBe(
      INVESTIGATION_RULE_OUTCOMES.runtimeError,
    );
    expect(artifact.content?.rules[1]?.limitations).toContain(
      "ENGINEERING_INVESTIGATION_RUNTIME_ERROR",
    );
    expect(artifact.content?.executionStatus).toBe(
      INVESTIGATION_EXECUTION_STATUSES.interrupted,
    );
  });

  it("keeps evidence-backed NOT_MET as non-compliant", async () => {
    const fixture = buildService();
    primeInvestigation(fixture, {
      classificationData: evaluations(
        ENGINEERING_RULE_EVALUATION_STATUSES.nonCompliant,
      ),
    });

    const artifact = await fixture.service.getInvestigationNotes(ASSESSMENT_ID);

    expect(artifact.content?.rules[0]?.outcome).toBe(
      INVESTIGATION_RULE_OUTCOMES.requirementNotMet,
    );
    expect(artifact.content?.assessmentOutcome).toBe(
      INVESTIGATION_ASSESSMENT_OUTCOMES.nonCompliant,
    );
    expect(artifact.content?.evidenceQuality).toBe(
      INVESTIGATION_EVIDENCE_QUALITIES.evidenceBacked,
    );
  });

  it("does not infer COMPLIANT from successful execution without validated evidence", async () => {
    const fixture = buildService();
    primeInvestigation(fixture);

    const artifact = await fixture.service.getInvestigationNotes(ASSESSMENT_ID);

    expect(artifact.content?.executionStatus).toBe(
      INVESTIGATION_EXECUTION_STATUSES.completed,
    );
    expect(artifact.content?.assessmentOutcome).toBe(
      INVESTIGATION_ASSESSMENT_OUTCOMES.unknown,
    );
    expect(artifact.content?.evidenceQuality).toBe(
      INVESTIGATION_EVIDENCE_QUALITIES.insufficientEvidence,
    );
  });

  it("does not show an old investigation artifact as READY after a new workflow run starts", async () => {
    const fixture = buildService();
    primeInvestigation(fixture, {
      latestRunId: "scan-2",
      latestRunAt: "2026-09-15T03:00:00.000Z",
    });

    const artifact = await fixture.service.getInvestigationNotes(ASSESSMENT_ID);

    expect(artifact.status).toBe(ASSESSMENT_ARTIFACT_STATUSES.pending);
    expect(artifact.content).toBeNull();
  });

  it("marks targeted customer context requested/resolved without leaking orchestration tokens", async () => {
    const fixture = buildService();
    const waiting = investigatorEvent(
      "rule-1",
      11,
      ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
    );
    const resumed = investigatorEvent("rule-1", 12);
    const unrelated = investigatorEvent("rule-2", 13);
    primeInvestigation(fixture, {
      events: [waiting, resumed, unrelated],
      classificationData: {
        evaluations: [
          {
            engineering_rule_id: "rule-1",
            concept: "CUSTOMER_CONFIRMED human review",
            status: ENGINEERING_RULE_EVALUATION_STATUSES.unknown,
            reason: "TARGETED_EXACT_RESUME_PIN resolutionCriteria needs review",
            evidence_refs: [],
          },
        ],
      },
    });

    const artifact = await fixture.service.getInvestigationNotes(ASSESSMENT_ID);
    const payload = JSON.stringify(artifact);

    expect(artifact.content?.rules[0]).toMatchObject({
      customerContextRequested: true,
      customerContextResolved: true,
    });
    for (const token of [
      "CUSTOMER_CONFIRMED",
      "CONTEXT_READY",
      "CONTEXT_RESOLVED",
      "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY",
      "INVESTIGATOR_RESOLUTION",
      "TARGETED_EXACT_RESUME_PIN",
      "resolutionCriteria",
    ]) {
      expect(payload).not.toContain(token);
    }
  });

  it("sanitizes public Business Context values and keys at the API projection boundary", async () => {
    const fixture = buildService();
    const context = confirmedContext();
    context.statements[0].normalizedValue = {
      resolutionCriteria: "CUSTOMER_CONFIRMED",
      safeField: "CONTEXT_READY customer-visible value",
    };
    context.statements[0].statement =
      "Customer context CUSTOMER_CONFIRMED is accepted after CONTEXT_READY.";
    fixture.prisma.assessmentInterviewThread.findUnique.mockResolvedValue({
      stateJson: { confirmedContext: context },
      contextRevision: 3,
      sourceVersion: "source-v3",
      pgeVersion: "pge-v2",
      updatedAt: new Date("2026-09-15T00:10:00.000Z"),
    });

    const artifact = await fixture.service.getBusinessContext(ASSESSMENT_ID);
    const payload = JSON.stringify(artifact);

    expect(payload).not.toContain("resolutionCriteria");
    expect(payload).not.toContain("CUSTOMER_CONFIRMED");
    expect(payload).not.toContain("CONTEXT_READY");
  });
});
