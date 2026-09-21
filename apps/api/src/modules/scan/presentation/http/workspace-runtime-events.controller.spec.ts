import { describe, expect, it, jest } from "@jest/globals";
import { Subject, firstValueFrom } from "rxjs";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";

import type { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { WorkspaceRuntimeEventsController } from "./workspace-runtime-events.controller.js";

const customerRequest = {
  rbacContext: {
    userId: "user-1",
    sessionId: "session-1",
    role: AUTH_USER_ROLES.customer,
    scope: "workspace/runtime-events",
  },
  correlationId: "corr-user-1",
} as never;

describe("WorkspaceRuntimeEventsController", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes workspace runtime metadata", async () => {
    const buildWorkspaceSnapshot = jest
      .fn<(ownerId?: string) => Promise<unknown>>()
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
        engineeringProgress: [],
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
        postFindingStates: [
          {
            assessmentId: "assessment-1",
            phase: "EXISTING_PR",
            codeReviewActivities: [],
            decisionAvailability: ["CONTINUE_DETECTED_PR"],
            selectedDecision: "CONTINUE_DETECTED_PR",
            selectedDecisionAt: "2026-09-07T01:02:03.000Z",
            detectedPullRequest: {
              number: 276,
              branch: "fix/lcsp-276",
              patchVersion: "patch-v1",
            },
            approvalStatus: "PENDING_CUSTOMER",
            verificationActivities: [],
          },
        ],
      });
    const controller = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot,
    } as unknown as AssessmentRuntimeEventService);

    const event = await firstValueFrom(controller.stream(customerRequest));

    expect(buildWorkspaceSnapshot).toHaveBeenCalledWith("user-1");
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
      engineering_progress: [],
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
      post_finding: [
        {
          assessment_id: "assessment-1",
          phase: "EXISTING_PR",
          decision_availability: ["CONTINUE_DETECTED_PR"],
          selected_decision: "CONTINUE_DETECTED_PR",
          detected_pull_request: {
            number: 276,
            branch: "fix/lcsp-276",
            patch_version: "patch-v1",
          },
        },
      ],
    });
  });

  it("forwards only the owner-scoped live agent stream", () => {
    const live = new Subject<Record<string, unknown>>();
    const observeAgentStreamEvents = jest.fn<
      (
        _ownerId: string,
        _options?: { assessmentId?: string | null },
      ) => ReturnType<typeof live.asObservable>
    >(() => live.asObservable());
    const controller = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot: () =>
        Promise.resolve({
          emittedAt: "2026-09-16T00:00:00.000Z",
          runs: [],
          recentActivity: [],
          engineeringProgress: [],
          repositorySnapshots: [],
          scanJobs: [],
          evidenceReports: [],
          postFindingStates: [],
        }),
      observeAgentStreamEvents,
    } as unknown as AssessmentRuntimeEventService);
    const events: Array<{ type?: string; data?: unknown }> = [];
    const subscription = controller
      .stream(customerRequest)
      .subscribe((event) => events.push(event));

    try {
      expect(observeAgentStreamEvents).toHaveBeenCalledWith("user-1", {
        assessmentId: null,
      });

      live.next({
        eventId: "agent-event-1",
        sequence: 4,
        clientSequence: 2,
        emittedAt: "2026-09-16T00:00:01.000Z",
        assessmentId: "assessment-1",
        runId: "run-1",
        correlationId: "corr-1",
        eventType: "TOOL_RESULT",
        source: "engineering",
        agentName: "investigator",
        subagentName: null,
        namespace: [],
        nodeName: "tools",
        messageId: "message-1",
        toolName: "lookup_rule",
        toolCallId: "call-1",
        status: "COMPLETED",
        text: "tool output",
        data: { count: 1 },
      });

      expect(events.at(-1)).toMatchObject({
        type: "workspace.agent-stream",
        data: {
          event_id: "agent-event-1",
          event_type: "TOOL_RESULT",
          text: "tool output",
        },
      });
    } finally {
      subscription.unsubscribe();
    }
  });

  it("supports assessment-scoped agent-stream-only subscriptions", () => {
    const live = new Subject<Record<string, unknown>>();
    const observeAgentStreamEvents = jest.fn<
      (
        _ownerId: string,
        _options?: { assessmentId?: string | null },
      ) => ReturnType<typeof live.asObservable>
    >(() => live.asObservable());
    const buildWorkspaceSnapshot = jest.fn<() => Promise<unknown>>();
    const controller = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot,
      observeAgentStreamEvents,
    } as unknown as AssessmentRuntimeEventService);
    const events: Array<{ type?: string; data?: unknown }> = [];
    const subscription = controller
      .stream(customerRequest, " assessment-101 ", "1")
      .subscribe((event) => events.push(event));

    try {
      expect(observeAgentStreamEvents).toHaveBeenCalledWith("user-1", {
        assessmentId: " assessment-101 ",
      });
      expect(buildWorkspaceSnapshot).not.toHaveBeenCalled();

      live.next({
        eventId: "agent-event-101",
        sequence: 5,
        clientSequence: null,
        emittedAt: "2026-09-16T00:00:02.000Z",
        assessmentId: "assessment-101",
        runId: "run-101",
        correlationId: "corr-101",
        eventType: "SEMANTIC_TOOL_CALL",
        source: "engineering",
        agentName: "investigator",
        subagentName: null,
        namespace: [],
        nodeName: "tools",
        messageId: "message-101",
        toolName: "search_nodes",
        toolCallId: "call-101",
        status: "RUNNING",
        text: "tool call started",
        data: { kind: "TOOL_CALL" },
      });

      expect(events).toEqual([
        expect.objectContaining({
          type: "workspace.agent-stream",
          data: expect.objectContaining({
            assessment_id: "assessment-101",
            event_id: "agent-event-101",
            event_type: "SEMANTIC_TOOL_CALL",
          }),
        }),
      ]);
    } finally {
      subscription.unsubscribe();
    }
  });

  it("returns paginated assessment-scoped agent stream history", async () => {
    const getAgentStreamHistoryPage = jest.fn<
      (
        ownerId: string,
        assessmentId: string,
        options?: { cursor?: string | null; limit?: number | null },
      ) => Promise<{
        events: AssessmentAgentStreamEvent[];
        hasMore: boolean;
        nextCursor: string | null;
      }>
    >(() =>
      Promise.resolve({
        events: [
          {
            eventId: "agent-history-1",
            sequence: 42,
            clientSequence: null,
            emittedAt: "2026-09-16T00:00:03.000Z",
            assessmentId: "assessment-101",
            runId: "run-101",
            correlationId: "corr-101",
            eventType: "MODEL_CONTENT_DELTA",
            source: "engineering",
            agentName: "investigator",
            subagentName: null,
            namespace: [],
            nodeName: "model",
            messageId: "message-101",
            toolName: null,
            toolCallId: null,
            status: "RUNNING",
            text: "visible output",
            data: null,
          },
        ],
        hasMore: true,
        nextCursor: "cursor-2",
      }),
    );
    const controller = new WorkspaceRuntimeEventsController({
      getAgentStreamHistoryPage,
    } as unknown as AssessmentRuntimeEventService);

    const response = await controller.agentStreamHistory(
      customerRequest,
      " assessment-101 ",
      " cursor-1 ",
      "25",
    );

    expect(getAgentStreamHistoryPage).toHaveBeenCalledWith(
      "user-1",
      "assessment-101",
      { cursor: "cursor-1", limit: 25 },
    );
    expect(response).toEqual({
      ok: true,
      data: {
        events: [
          expect.objectContaining({
            event_id: "agent-history-1",
            assessment_id: "assessment-101",
            event_type: "MODEL_CONTENT_DELTA",
            text: "visible output",
          }),
        ],
        has_more: true,
        next_cursor: "cursor-2",
      },
    });
  });

  it("does not cancel an in-flight runtime snapshot when the polling interval ticks again", async () => {
    jest.useFakeTimers();
    let resolveSnapshot: (value: unknown) => void = () => {};
    const buildWorkspaceSnapshot = jest
      .fn<(ownerId?: string) => Promise<unknown>>()
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

    const subscription = controller
      .stream(customerRequest)
      .subscribe((event) => {
        events.push(event);
      });

    try {
      expect(buildWorkspaceSnapshot).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2_000);

      expect(buildWorkspaceSnapshot).toHaveBeenCalledTimes(1);

      resolveSnapshot({
        emittedAt: "2026-08-09T14:05:00.000Z",
        runs: [],
        recentActivity: [],
        engineeringProgress: [],
        repositorySnapshots: [],
        scanJobs: [],
        evidenceReports: [],
        postFindingStates: [],
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
    } finally {
      subscription.unsubscribe();
    }
  });
});
