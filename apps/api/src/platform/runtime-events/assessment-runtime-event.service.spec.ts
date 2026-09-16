import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  POST_FINDING_RUNTIME_PHASES,
  REMEDIATION_APPROVAL_STATUSES,
  REMEDIATION_DECISIONS,
} from "@lcsp/contracts/evidence";

import { AssessmentRuntimeEventService } from "./assessment-runtime-event.service.js";

const freshRuntimeEvent = () =>
  Promise.resolve({ createdAt: new Date("2099-01-01T00:00:00.000Z") });

const emptyRepositorySnapshots = () => ({
  findMany: jest
    .fn<(args?: unknown) => Promise<unknown[]>>()
    .mockResolvedValue([]),
});

const assessmentOwner = () => ({
  findUnique: jest
    .fn<(args?: unknown) => Promise<{ ownerId: string }>>()
    .mockResolvedValue({ ownerId: "user-1" }),
});

describe("AssessmentRuntimeEventService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("isolates live agent events by assessment owner", async () => {
    const prisma = {
      assessment: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === "assessment-a"
              ? { ownerId: "user-a" }
              : where.id === "assessment-b"
                ? { ownerId: "user-b" }
                : null,
          ),
        ),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);
    const ownerAEvents: string[] = [];
    const ownerBEvents: string[] = [];
    const ownerASubscription = service
      .observeAgentStreamEvents("user-a")
      .subscribe((event) => ownerAEvents.push(event.assessmentId));
    const ownerBSubscription = service
      .observeAgentStreamEvents("user-b")
      .subscribe((event) => ownerBEvents.push(event.assessmentId));

    await service.publishAgentStreamEvent({
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: "MODEL_CONTENT_DELTA",
      text: "A",
    });
    await service.publishAgentStreamEvent({
      assessmentId: "assessment-b",
      runId: "run-b",
      correlationId: "corr-b",
      eventType: "MODEL_CONTENT_DELTA",
      text: "B",
    });

    expect(ownerAEvents).toEqual(["assessment-a"]);
    expect(ownerBEvents).toEqual(["assessment-b"]);
    expect(prisma.assessment.findUnique).toHaveBeenCalledTimes(2);
    ownerASubscription.unsubscribe();
    ownerBSubscription.unsubscribe();
  });

  it("builds orchestration activity from scan jobs and evidence reports when runtime events are absent", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "scan-1",
              assessmentId: "assessment-1",
              snapshotId: "snapshot-1",
              status: "COMPLETED",
              attemptCount: 1,
              blockedReason: null,
              updatedAt: new Date("2026-08-14T08:00:00.000Z"),
            },
          ]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "report-1",
              assessmentId: "assessment-1",
              scanJobId: "scan-1",
              snapshotId: "snapshot-1",
              status: "ACCEPTED",
              rejectionReason: null,
              createdAt: new Date("2026-08-14T08:01:00.000Z"),
            },
          ]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot("user-1");

    expect(prisma.assessmentRuntimeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessment: { ownerId: "user-1" } } }),
    );
    expect(prisma.repositorySnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessment: { ownerId: "user-1" } } }),
    );
    expect(prisma.repositoryScanJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessment: { ownerId: "user-1" } } }),
    );
    expect(prisma.technicalEvidenceReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessment: { ownerId: "user-1" } } }),
    );

    expect(snapshot.recentActivity).toEqual([
      expect.objectContaining({
        eventId: "technical-evidence-report:report-1:ACCEPTED",
        assessmentId: "assessment-1",
        runId: "scan-1",
        eventType: "TOOL_COMPLETED",
        runStatus: "COMPLETED",
        stage: "TECHNICAL_EVIDENCE",
        toolName: "technical_evidence_report",
        summary: "Technical evidence report was accepted",
      }),
      expect.objectContaining({
        eventId: "scan-job:scan-1:COMPLETED",
        assessmentId: "assessment-1",
        runId: "scan-1",
        eventType: "TOOL_COMPLETED",
        runStatus: "COMPLETED",
        stage: "SCAN",
        toolName: "repository_scan",
        summary: "Repository scan completed",
      }),
    ]);
  });

  it("refreshes running synthetic scan activity on each workspace snapshot", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-14T08:02:00.000Z"));
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "scan-1",
              assessmentId: "assessment-1",
              snapshotId: "snapshot-1",
              status: "RUNNING",
              attemptCount: 1,
              blockedReason: null,
              updatedAt: new Date("2026-08-14T08:00:00.000Z"),
            },
          ]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.recentActivity).toEqual([
      expect.objectContaining({
        eventId: "scan-job:scan-1:RUNNING",
        emittedAt: "2026-08-14T08:02:00.000Z",
        outputSummary: {
          status: "RUNNING",
          observedAt: "2026-08-14T08:02:00.000Z",
        },
      }),
    ]);
  });

  it("projects canonical engineering progress independently of the recent activity cap", async () => {
    const events = [
      {
        id: "evt-plan-summary",
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: 1,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: "engineering_rule_plan_summary",
        summary: "ENGINEERING_RULE_PLANNER_DECISION",
        inputSummaryJson: null,
        outputSummaryJson: {
          planningBatchId: "scan-1:context:12",
          contextRevisionUsed: 12,
          candidateCount: 41,
          selectedCount: 19,
          skippedCount: 22,
          targeted: false,
        },
        errorSummary: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date("2026-08-14T08:00:00.000Z"),
      },
      ...Array.from({ length: 13 }, (_, index) => ({
        id: `evt-investigated-${index + 1}`,
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: index + 2,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: `engineering_rule_investigation:eng-${index + 1}`,
        summary: "ENGINEERING_RULE_INVESTIGATED",
        inputSummaryJson: null,
        outputSummaryJson: { evaluationStatus: "MET" },
        errorSummary: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date(
          `2026-08-14T08:00:${String(index + 1).padStart(2, "0")}.000Z`,
        ),
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `evt-limited-${index + 1}`,
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: index + 20,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: `engineering_rule_investigation:eng-${index + 14}`,
        summary: "ENGINEERING_RULE_INVESTIGATION_FAILED",
        inputSummaryJson: null,
        outputSummaryJson: {},
        errorSummary: "EvidenceUnavailable",
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date(`2026-08-14T08:01:0${index}.000Z`),
      })),
      ...Array.from({ length: 55 }, (_, index) => ({
        id: `evt-noise-${index + 1}`,
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: index + 100,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: `non_progress:${index + 1}`,
        summary: "Noise",
        inputSummaryJson: null,
        outputSummaryJson: null,
        errorSummary: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date(
          `2026-08-14T08:02:${String(index).padStart(2, "0")}.000Z`,
        ),
      })),
    ];
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue(events),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.recentActivity).toHaveLength(50);
    expect(snapshot.engineeringProgress).toEqual([
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-1",
        planningBatchId: "scan-1:context:12",
        approximate: false,
        planner: {
          candidateCount: 41,
          selectedCount: 19,
          skippedCount: 22,
        },
        investigator: expect.objectContaining({
          selectedCount: 19,
          completedCount: 13,
          domainLimitedCount: 3,
          runtimeFailedCount: 0,
          pendingCount: 3,
        }),
      }),
    ]);
  });

  it("derives the latest post-finding state from runtime event output summaries", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "evt-latest",
              assessmentId: "assessment-1",
              runId: "interview:assessment-1",
              correlationId: "corr-1",
              sequence: 2,
              eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
              runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
              stage: ASSESSMENT_RUNTIME_STAGE_CODES.remediation,
              toolName: "post_finding_remediation_decision",
              summary: "Customer remediation decision persisted",
              inputSummaryJson: null,
              outputSummaryJson: {
                postFinding: {
                  assessmentId: "assessment-1",
                  phase: POST_FINDING_RUNTIME_PHASES.createPr,
                  codeReviewActivities: [],
                  decisionAvailability: [
                    REMEDIATION_DECISIONS.createRemediationPr,
                  ],
                  selectedDecision: REMEDIATION_DECISIONS.createRemediationPr,
                  selectedDecisionAt: "2026-09-07T01:02:03.000Z",
                  approvalStatus: REMEDIATION_APPROVAL_STATUSES.pendingCustomer,
                  verificationActivities: [],
                },
              },
              errorSummary: null,
              startedAt: null,
              completedAt: null,
              durationMs: null,
              attempt: null,
              waitingReason: null,
              createdAt: new Date("2026-09-07T01:02:03.000Z"),
            },
          ]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.postFindingStates).toEqual([
      expect.objectContaining({
        assessmentId: "assessment-1",
        phase: POST_FINDING_RUNTIME_PHASES.createPr,
        selectedDecision: REMEDIATION_DECISIONS.createRemediationPr,
      }),
    ]);
  });

  it("records scanner-worker runtime events using scan-job tenant context", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create: jest.fn().mockImplementation(() => Promise.resolve({})),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "RUNNING",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "syft",
        summary: "syft completed with non-blocking failure",
        outputSummary: { outcome: "tool_failure" },
        errorSummary: "syft not available",
        startedAt: new Date("2026-08-14T08:00:00.000Z"),
        completedAt: new Date("2026-08-14T08:00:01.000Z"),
        durationMs: 1000,
      }),
    ).resolves.toEqual({ recorded: true });

    expect(assessmentRuntimeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: 1,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "syft",
        outputSummaryJson: { outcome: "tool_failure" },
        errorSummary: "syft not available",
        durationMs: 1000,
      }),
    });
  });

  it("retries scanner-worker runtime event sequence collisions", async () => {
    const sequenceCollision = Object.assign(
      new Error(
        'Unique constraint failed on the fields: ("runId", "sequence")',
      ),
      {
        code: "P2002",
        meta: { target: ["runId", "sequence"] },
      },
    );
    const assessmentRuntimeEvent = {
      findFirst: jest
        .fn<() => Promise<{ sequence: number } | null>>()
        .mockResolvedValueOnce({ sequence: 4 })
        .mockResolvedValueOnce({ sequence: 5 }),
      create: jest
        .fn<(args: unknown) => Promise<unknown>>()
        .mockRejectedValueOnce(sequenceCollision)
        .mockResolvedValueOnce({}),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "RUNNING",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "semgrep",
        summary: "Running semgrep analysis",
      }),
    ).resolves.toEqual({ recorded: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(assessmentRuntimeEvent.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        runId: "scan-1",
        sequence: 5,
      }),
    });
    expect(assessmentRuntimeEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        runId: "scan-1",
        sequence: 6,
      }),
    });
  });

  it("skips late scanner-worker start events after the scan job is terminal", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create: jest.fn().mockImplementation(() => Promise.resolve({})),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "COMPLETED",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "late_tool",
        summary: "Late tool started",
      }),
    ).resolves.toEqual({ recorded: false, reason: "terminal" });

    expect(assessmentRuntimeEvent.create).not.toHaveBeenCalled();
  });

  it("records scanner-worker terminal close events after the scan job is terminal", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create: jest.fn().mockImplementation(() => Promise.resolve({})),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "COMPLETED",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "repository_scan",
        summary: "Repository scan completed",
      }),
    ).resolves.toEqual({ recorded: true });

    expect(assessmentRuntimeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: 1,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "repository_scan",
      }),
    });
  });

  it("does not build synthetic scan activity when persisted worker activity exists", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "evt-1",
              assessmentId: "assessment-1",
              runId: "scan-1",
              correlationId: "corr-1",
              sequence: 1,
              eventType: "TOOL_STARTED",
              runStatus: "RUNNING",
              stage: "SCAN",
              toolName: "materialize_snapshot",
              summary: "Materializing repository snapshot",
              inputSummaryJson: null,
              outputSummaryJson: null,
              errorSummary: null,
              startedAt: null,
              completedAt: null,
              durationMs: null,
              attempt: null,
              waitingReason: null,
              createdAt: new Date("2026-08-14T08:00:00.000Z"),
            },
          ]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "scan-1",
              assessmentId: "assessment-1",
              snapshotId: "snapshot-1",
              status: "RUNNING",
              attemptCount: 1,
              blockedReason: null,
              updatedAt: new Date("2026-08-14T07:59:00.000Z"),
            },
          ]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.recentActivity).toHaveLength(1);
    expect(snapshot.recentActivity[0]).toEqual(
      expect.objectContaining({
        eventId: "evt-1",
        toolName: "materialize_snapshot",
      }),
    );
  });

  describe("durable engineering progress", () => {
    type MockRuntimeEventRow = Record<string, unknown> & {
      assessmentId: string;
      runId: string;
      sequence: number;
      toolName: string | null;
      createdAt: Date;
    };

    const baseTime = new Date("2026-09-14T08:00:00.000Z");

    const runtimeEventRow = (
      overrides: Partial<MockRuntimeEventRow> &
        Pick<MockRuntimeEventRow, "id" | "sequence" | "eventType" | "toolName">,
    ): MockRuntimeEventRow => ({
      assessmentId: "assessment-live",
      runId: "scan-live",
      correlationId: "corr-live",
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
      summary: "live scenario row",
      inputSummaryJson: null,
      outputSummaryJson: null,
      errorSummary: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      attempt: null,
      waitingReason: null,
      createdAt: new Date(baseTime.getTime() + overrides.sequence * 1_000),
      ...overrides,
    });

    const liveScenarioEvents = (): MockRuntimeEventRow[] => {
      const events: MockRuntimeEventRow[] = [
        runtimeEventRow({
          id: "evt-live-summary",
          sequence: 1,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:12",
            contextRevisionUsed: 12,
            candidateCount: 41,
            selectedCount: 19,
            skippedCount: 22,
            targeted: false,
          },
        }),
      ];
      for (let index = 1; index <= 41; index += 1) {
        events.push(
          runtimeEventRow({
            id: `evt-live-plan-${index}`,
            sequence: index + 1,
            eventType:
              index <= 19
                ? ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted
                : ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped,
            toolName: `engineering_rule_plan:eng-${index}`,
          }),
        );
      }
      for (let index = 1; index <= 13; index += 1) {
        events.push(
          runtimeEventRow({
            id: `evt-live-investigated-${index}`,
            sequence: index + 42,
            eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
            toolName: `engineering_rule_investigation:eng-${index}`,
          }),
        );
      }
      for (let index = 14; index <= 16; index += 1) {
        events.push(
          runtimeEventRow({
            id: `evt-live-limited-${index}`,
            sequence: index + 42,
            eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
            runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
            toolName: `engineering_rule_investigation:eng-${index}`,
            outputSummaryJson: {},
            errorSummary: "EvidenceUnavailable",
          }),
        );
      }
      return events;
    };

    const noiseEvent = (sequence: number): MockRuntimeEventRow =>
      runtimeEventRow({
        id: `evt-live-noise-${sequence}`,
        sequence,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        toolName: `non_progress:${sequence}`,
      });

    const buildFilteringPrisma = (
      allEvents: MockRuntimeEventRow[],
      windowRows: MockRuntimeEventRow[],
    ) => {
      const findMany = jest
        .fn<(args: Record<string, unknown>) => Promise<unknown[]>>()
        .mockImplementation((args) => {
          const where = (args.where ?? {}) as Record<string, unknown>;
          if (Object.keys(where).length === 0) {
            return Promise.resolve(
              [...windowRows].sort(
                (left, right) =>
                  right.createdAt.getTime() - left.createdAt.getTime() ||
                  right.sequence - left.sequence,
              ),
            );
          }
          let rows = allEvents;
          if (typeof where.runId === "string") {
            rows = rows.filter((row) => row.runId === where.runId);
          }
          const sequence = where.sequence as { gt?: number } | undefined;
          if (sequence && typeof sequence.gt === "number") {
            rows = rows.filter((row) => row.sequence > sequence.gt!);
          }
          const toolName = where.toolName;
          if (typeof toolName === "string") {
            rows = rows.filter((row) => row.toolName === toolName);
          } else if (
            toolName &&
            typeof toolName === "object" &&
            typeof (toolName as { startsWith?: unknown }).startsWith ===
              "string"
          ) {
            const prefix = (toolName as { startsWith: string }).startsWith;
            rows = rows.filter((row) => row.toolName?.startsWith(prefix));
          }
          if (typeof where.stage === "string") {
            rows = rows.filter((row) => row.stage === where.stage);
          }
          if (typeof where.assessmentId === "string") {
            rows = rows.filter(
              (row) => row.assessmentId === where.assessmentId,
            );
          }
          return Promise.resolve(
            [...rows].sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime() ||
                right.sequence - left.sequence,
            ),
          );
        });
      return {
        assessmentRuntimeEvent: {
          findMany,
          findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
        },
        repositorySnapshot: emptyRepositorySnapshots(),
        assessment: assessmentOwner(),
        repositoryScanJob: {
          findMany: jest
            .fn<(args?: unknown) => Promise<unknown[]>>()
            .mockResolvedValue([]),
        },
        technicalEvidenceReport: {
          findMany: jest
            .fn<(args?: unknown) => Promise<unknown[]>>()
            .mockResolvedValue([]),
        },
      };
    };

    it("keeps canonical planner and investigator totals when every planner event has been evicted from the recent-activity window", async () => {
      const events = liveScenarioEvents();
      const prisma = buildFilteringPrisma(
        events,
        Array.from({ length: 60 }, (_, index) => noiseEvent(index + 60)),
      );
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.recentActivity).toHaveLength(50);
      expect(
        snapshot.recentActivity.some((item) =>
          item.toolName?.startsWith("engineering_rule_plan"),
        ),
      ).toBe(false);

      expect(snapshot.engineeringProgress).toEqual([
        expect.objectContaining({
          assessmentId: "assessment-live",
          runId: "scan-live",
          planningBatchId: "scan-live:context:12",
          approximate: false,
          planner: {
            candidateCount: 41,
            selectedCount: 19,
            skippedCount: 22,
          },
          investigator: expect.objectContaining({
            selectedCount: 19,
            completedCount: 13,
            domainLimitedCount: 3,
            runtimeFailedCount: 0,
            waitingForInputCount: 0,
            pendingCount: 3,
          }),
        }),
      ]);
    });

    it("advances investigator progress without changing the planner denominator", async () => {
      const events = [
        ...liveScenarioEvents(),
        runtimeEventRow({
          id: "evt-live-investigated-14",
          sequence: 60,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_investigation:eng-17",
        }),
      ];
      const prisma = buildFilteringPrisma(
        events,
        Array.from({ length: 60 }, (_, index) => noiseEvent(index + 61)),
      );
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress[0]?.planner).toEqual({
        candidateCount: 41,
        selectedCount: 19,
        skippedCount: 22,
      });
      expect(snapshot.engineeringProgress[0]?.investigator).toEqual(
        expect.objectContaining({
          selectedCount: 19,
          completedCount: 14,
          domainLimitedCount: 3,
          runtimeFailedCount: 0,
          pendingCount: 2,
        }),
      );
    });

    it("separates runtime failures from domain limitations and counts waiting-for-input", async () => {
      const events = [
        runtimeEventRow({
          id: "evt-rt-summary",
          sequence: 1,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:2",
            candidateCount: 4,
            selectedCount: 4,
            skippedCount: 0,
          },
        }),
        runtimeEventRow({
          id: "evt-rt-ok",
          sequence: 2,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_investigation:eng-1",
        }),
        runtimeEventRow({
          id: "evt-rt-limited",
          sequence: 3,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
          runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
          toolName: "engineering_rule_investigation:eng-2",
          outputSummaryJson: {},
        }),
        runtimeEventRow({
          id: "evt-rt-runtime-failed",
          sequence: 4,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
          runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
          toolName: "engineering_rule_investigation:eng-3",
          outputSummaryJson: {
            failureKind: "RUNTIME_ERROR",
            executionFailure: "CALLBACK_ERROR",
          },
        }),
        runtimeEventRow({
          id: "evt-rt-waiting",
          sequence: 5,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
          toolName: "engineering_rule_investigation:eng-4",
          outputSummaryJson: { outcome: "NEEDS_INPUT" },
        }),
      ];
      const prisma = buildFilteringPrisma(events, []);
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress[0]?.investigator).toEqual({
        selectedCount: 4,
        completedCount: 1,
        domainLimitedCount: 1,
        limitedOrFailedCount: 2,
        waitingForInputCount: 1,
        runtimeFailedCount: 1,
        pendingCount: 0,
      });
    });

    it("prefers the newest planning batch for the run on targeted resume", async () => {
      const events = [
        ...liveScenarioEvents(),
        runtimeEventRow({
          id: "evt-targeted-summary",
          sequence: 200,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:13",
            contextRevisionUsed: 13,
            candidateCount: 19,
            selectedCount: 1,
            skippedCount: 18,
            targeted: true,
          },
        }),
        runtimeEventRow({
          id: "evt-targeted-investigated",
          sequence: 201,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_investigation:eng-3",
        }),
      ];
      const prisma = buildFilteringPrisma(events, []);
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress).toHaveLength(1);
      expect(snapshot.engineeringProgress[0]).toEqual(
        expect.objectContaining({
          planningBatchId: "scan-live:context:13",
          targeted: true,
          planner: {
            candidateCount: 19,
            selectedCount: 1,
            skippedCount: 18,
          },
          investigator: expect.objectContaining({
            selectedCount: 1,
            completedCount: 1,
            pendingCount: 0,
          }),
        }),
      );
    });

    it("keeps stale previous runs durable while newer runs sort first", async () => {
      const staleRun = liveScenarioEvents().map((row) => ({
        ...row,
        assessmentId: "assessment-stale",
        runId: "scan-stale",
      }));
      const currentRun = [
        runtimeEventRow({
          id: "evt-current-summary",
          sequence: 1,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:5",
            candidateCount: 10,
            selectedCount: 5,
            skippedCount: 5,
          },
        }),
      ];
      const prisma = buildFilteringPrisma([...staleRun, ...currentRun], []);
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress).toHaveLength(2);
      expect(snapshot.engineeringProgress[0]?.runId).toBe("scan-live");
      expect(snapshot.engineeringProgress[1]?.runId).toBe("scan-stale");
      expect(snapshot.engineeringProgress[1]?.planner).toEqual({
        candidateCount: 41,
        selectedCount: 19,
        skippedCount: 22,
      });
    });
  });
});
