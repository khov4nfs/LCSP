import { describe, expect, it, jest } from "@jest/globals";

import { AssessmentRuntimeEventService } from "./assessment-runtime-event.service.js";

describe("AssessmentRuntimeEventService", () => {
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
});
