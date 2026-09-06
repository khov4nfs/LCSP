import { describe, expect, it, jest } from "@jest/globals";
import { firstValueFrom } from "rxjs";

import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { WorkspaceRuntimeEventsController } from "./workspace-runtime-events.controller.js";

describe("WorkspaceRuntimeEventsController", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes workspace runtime metadata", async () => {
    const buildWorkspaceSnapshot = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({
        emittedAt: "2026-08-09T14:05:00.000Z",
        runs: [
          {
            assessmentId: "assessment-1",
            runId: "run-1",
            stage: "TECHNICAL_EVIDENCE",
            status: "RUNNING",
            activeTools: [
              {
                toolName: "get_scan_coverage",
                status: "RUNNING",
                summary: "Starting get_scan_coverage",
                startedAt: "2026-08-09T14:00:00.000Z",
                attempt: 1,
              },
            ],
            updatedAt: "2026-08-09T14:04:00.000Z",
          },
        ],
        recentActivity: [
          {
            eventId: "evt-1",
            sequence: 1,
            emittedAt: "2026-08-09T14:05:00.000Z",
            assessmentId: "assessment-1",
            runId: "run-1",
            correlationId: "corr-1",
            eventType: "TOOL_STARTED",
            runStatus: "RUNNING",
            stage: "TECHNICAL_EVIDENCE",
            toolName: "get_scan_coverage",
            summary: "Starting get_scan_coverage",
            inputSummary: { maxResults: 25 },
            outputSummary: null,
            errorSummary: null,
            startedAt: "2026-08-09T14:00:00.000Z",
            completedAt: null,
            durationMs: null,
            attempt: 1,
            waitingReason: null,
          },
        ],
        repositorySnapshots: [
          {
            id: "snapshot-1",
            assessmentId: "assessment-1",
            branch: "main",
            commitSha: "abc123",
            createdAt: "2026-08-09T13:58:00.000Z",
          },
        ],
        scanJobs: [
          {
            id: "scan-job-1",
            assessmentId: "assessment-1",
            snapshotId: "snapshot-1",
            status: "RUNNING",
            attemptCount: 2,
            blockedReason: null,
            updatedAt: new Date("2026-08-09T14:00:00.000Z"),
          },
        ],
        evidenceReports: [],
      });
    const controller = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot,
    } as unknown as AssessmentRuntimeEventService);

    const event = await firstValueFrom(controller.stream());

    expect(buildWorkspaceSnapshot).toHaveBeenCalledWith();
    expect(event.type).toBe("workspace.runtime");
    expect(event.data).toMatchObject({
      emitted_at: "2026-08-09T14:05:00.000Z",
      runs: [
        {
          assessment_id: "assessment-1",
          run_id: "run-1",
          stage: "TECHNICAL_EVIDENCE",
          status: "RUNNING",
          active_tools: [
            {
              tool_name: "get_scan_coverage",
              status: "RUNNING",
              summary: "Starting get_scan_coverage",
              started_at: "2026-08-09T14:00:00.000Z",
              attempt: 1,
            },
          ],
          updated_at: "2026-08-09T14:04:00.000Z",
        },
      ],
      recent_activity: [
        {
          event_id: "evt-1",
          assessment_id: "assessment-1",
          run_id: "run-1",
          event_type: "TOOL_STARTED",
          summary: "Starting get_scan_coverage",
        },
      ],
      repository_snapshots: [
        {
          id: "snapshot-1",
          assessment_id: "assessment-1",
          branch: "main",
          commit_sha: "abc123",
          created_at: "2026-08-09T13:58:00.000Z",
        },
      ],
      scan_jobs: [
        {
          id: "scan-job-1",
          assessment_id: "assessment-1",
          snapshot_id: "snapshot-1",
          status: "RUNNING",
          attempt_count: 2,
          blocked_reason: null,
          updated_at: "2026-08-09T14:00:00.000Z",
        },
      ],
      evidence_reports: [],
    });
  });

  it("does not cancel an in-flight runtime snapshot when the polling interval ticks again", async () => {
    jest.useFakeTimers();
    let resolveSnapshot: (value: unknown) => void = () => {};
    const buildWorkspaceSnapshot = jest
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSnapshot = resolve;
          }),
      );
    const controller = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot,
    } as unknown as AssessmentRuntimeEventService);
    const events: unknown[] = [];

    const subscription = controller.stream().subscribe((event) => {
      events.push(event);
    });

    expect(buildWorkspaceSnapshot).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2_000);

    expect(buildWorkspaceSnapshot).toHaveBeenCalledTimes(1);

    resolveSnapshot({
      emittedAt: "2026-08-09T14:05:00.000Z",
      runs: [],
      recentActivity: [],
      repositorySnapshots: [],
      scanJobs: [],
      evidenceReports: [],
    });
    await Promise.resolve();

    expect(events).toEqual([
      expect.objectContaining({
        type: "workspace.runtime",
        data: expect.objectContaining({
          emitted_at: "2026-08-09T14:05:00.000Z",
        }),
      }),
    ]);

    subscription.unsubscribe();
  });
});
