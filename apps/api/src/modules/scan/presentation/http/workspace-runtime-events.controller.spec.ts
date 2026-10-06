import { describe, expect, it, jest } from "@jest/globals";
import { SseStream } from "@nestjs/core/router/sse-stream.js";
import type { OutgoingHttpHeaders } from "node:http";
import { PassThrough } from "node:stream";
import { Subject, firstValueFrom } from "rxjs";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
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
const canonicalAssessmentId = "11111111-1111-4111-8111-111111111111";
const canonicalEventId = "22222222-2222-4222-8222-222222222222";
const canonicalThreadId = "33333333-3333-4333-8333-333333333333";

type TestSseResponse = PassThrough & {
  writeHead: {
    (
      statusCode: number,
      reasonPhrase?: string,
      headers?: OutgoingHttpHeaders,
    ): void;
    (statusCode: number, headers?: OutgoingHttpHeaders): void;
  };
  flushHeaders: () => void;
};

async function serializeSse(
  controller: WorkspaceRuntimeEventsController,
): Promise<string> {
  const response = new PassThrough() as TestSseResponse;
  response.writeHead = jest.fn();
  response.flushHeaders = jest.fn();
  const chunks: Buffer[] = [];
  const output = new Promise<string>((resolve, reject) => {
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", reject);
  });
  const sse = new SseStream();
  sse.pipe(response);
  controller.stream(customerRequest).subscribe({
    next: (event) =>
      sse.writeMessage(event, (error) => {
        if (error) response.destroy(error);
      }),
    error: (error: unknown) =>
      response.destroy(
        error instanceof Error ? error : new Error("stream failed"),
      ),
    complete: () => sse.end(),
  });
  return output;
}

function parseSseData(output: string): unknown {
  const line = output
    .split("\n")
    .find((candidate) => candidate.startsWith("data: "));
  if (!line) throw new Error("SSE data line missing");
  return JSON.parse(line.slice("data: ".length));
}

describe("WorkspaceRuntimeEventsController", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes workspace runtime metadata", async () => {
    const buildWorkspaceSnapshot = jest
      .fn<(ownerId?: string, correlationId?: string) => Promise<unknown>>()
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
        canonicalAssessments: [
          {
            assessmentId: canonicalAssessmentId,
            lifecycle: {
              state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
              assessmentRevision: 3,
            },
            runtime: {
              threadId: canonicalThreadId,
              rootAgentVersion: "assessment-root-v2",
              checkpointNamespace: canonicalAssessmentId,
              checkpointId: "44444444-4444-4444-8444-444444444444",
              currentExecutionId: "55555555-5555-4555-8555-555555555555",
              executionState: AGENT_EXECUTION_STATES.RUNNING,
              eventSequence: 4,
              startedAt: "2026-08-09T14:00:00.000Z",
              lastResumedAt: null,
              updatedAt: "2026-08-09T14:05:00.000Z",
            },
          },
        ],
        canonicalEvents: [
          {
            eventId: canonicalEventId,
            assessmentId: canonicalAssessmentId,
            threadId: canonicalThreadId,
            sequence: 4,
            timestamp: "2026-08-09T14:05:00.000Z",
            eventType:
              AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
            actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
            payload: {
              fromState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
              toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
              assessmentRevision: 3,
            },
          },
        ],
      });
    const controller = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot,
    } as unknown as AssessmentRuntimeEventService);

    const event = await firstValueFrom(controller.stream(customerRequest));

    expect(buildWorkspaceSnapshot).toHaveBeenCalledWith(
      "user-1",
      "corr-user-1",
    );
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
      canonical_assessments: [
        {
          assessmentId: canonicalAssessmentId,
          lifecycle: {
            state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
            assessmentRevision: 3,
          },
          runtime: {
            threadId: canonicalThreadId,
            rootAgentVersion: "assessment-root-v2",
            checkpointNamespace: canonicalAssessmentId,
            checkpointId: "44444444-4444-4444-8444-444444444444",
            currentExecutionId: "55555555-5555-4555-8555-555555555555",
            executionState: AGENT_EXECUTION_STATES.RUNNING,
            eventSequence: 4,
            startedAt: "2026-08-09T14:00:00.000Z",
            lastResumedAt: null,
            updatedAt: "2026-08-09T14:05:00.000Z",
          },
        },
      ],
      canonical_events: [
        {
          eventId: canonicalEventId,
          assessmentId: canonicalAssessmentId,
          threadId: canonicalThreadId,
          sequence: 4,
          timestamp: "2026-08-09T14:05:00.000Z",
          eventType:
            AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
          actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
          payload: {
            fromState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
            toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
            assessmentRevision: 3,
          },
        },
      ],
    });
  });

  it("serializes canonical failures as terminal shared-problem SSE events", async () => {
    const databaseFailure = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot: jest
        .fn<(ownerId?: string, correlationId?: string) => Promise<unknown>>()
        .mockRejectedValue(new Error("raw-provider-database-secret")),
    } as unknown as AssessmentRuntimeEventService);
    const databaseOutput = await serializeSse(databaseFailure);
    const databaseData = parseSseData(databaseOutput);

    expect(databaseOutput).toContain("event: error");
    expect(databaseOutput).not.toContain("raw-provider-database-secret");
    expect(databaseData).toMatchObject({
      ok: false,
      problem: { status: 500, correlationId: "corr-user-1" },
    });

    const canonicalFailure = new WorkspaceRuntimeEventsController({
      buildWorkspaceSnapshot: jest
        .fn<(ownerId?: string, correlationId?: string) => Promise<unknown>>()
        .mockRejectedValue(
          problemException(
            ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
            "canonical-correlation",
            { status: 409 },
          ),
        ),
    } as unknown as AssessmentRuntimeEventService);
    const canonicalOutput = await serializeSse(canonicalFailure);

    expect(parseSseData(canonicalOutput)).toMatchObject({
      ok: false,
      problem: {
        code: ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        status: 409,
        correlationId: "canonical-correlation",
      },
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
            stage: null,
            engineeringRuleId: null,
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
