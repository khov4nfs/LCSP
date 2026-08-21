import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
} from "@lcsp/contracts/evidence";

import { AssessmentRuntimeEventService } from "./assessment-runtime-event.service.js";

describe("AssessmentRuntimeEventService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds orchestration activity from scan jobs and evidence reports when runtime events are absent", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      },
      repositoryScanJob: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
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
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
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

    const snapshot = await service.buildWorkspaceSnapshot("org-1");

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
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      },
      repositoryScanJob: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
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
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot("org-1");

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

  it("records scanner-worker runtime events using scan-job tenant context", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create: jest.fn().mockImplementation(() => Promise.resolve({})),
    };
    const prisma = {
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            organizationId: "org-1",
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
        organizationId: "org-1",
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

  it("does not build synthetic scan activity when persisted worker activity exists", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
          {
            id: "evt-1",
            organizationId: "org-1",
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
      },
      repositoryScanJob: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
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
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot("org-1");

    expect(snapshot.recentActivity).toHaveLength(1);
    expect(snapshot.recentActivity[0]).toEqual(
      expect.objectContaining({
        eventId: "evt-1",
        toolName: "materialize_snapshot",
      }),
    );
  });
});
