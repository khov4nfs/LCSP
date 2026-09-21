import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

import {
  parseAgentStreamEvent,
  parseRuntimeEvent,
  runtimeFingerprint,
} from "../src/features/workspace/utils/workspace-runtime-parser.ts";
import type {
  WorkspaceRuntimeActivityItem,
  WorkspaceRuntimeAgentStreamHistoryState,
} from "../src/features/workspace/types/workspace-runtime.types.ts";
import {
  buildRuntimeConsoleModel,
  selectRuntimeConsoleActivity,
} from "../src/features/evidence/utils/runtime-console.ts";
import {
  agentStreamRetentionLimit,
  mergeAgentStreamEvents,
  retainInitialAgentStreamHistoryRequest,
  subscribeScopedAssessmentRuntimeStream,
  workspaceRuntimeHistoryUrl,
  workspaceRuntimeEventsUrl,
  type ScopedAgentStreamEntry,
} from "../src/features/workspace/components/organisms/workspace-runtime-provider.tsx";

test("workspace runtime provider builds scoped semantic replay stream URLs", () => {
  assert.equal(workspaceRuntimeEventsUrl(), "/api/workspace/runtime-events");
  assert.equal(
    workspaceRuntimeEventsUrl("assessment-101", true),
    "/api/workspace/runtime-events?assessment_id=assessment-101&agent_stream_only=1",
  );
  assert.equal(
    workspaceRuntimeHistoryUrl("assessment-101", null, 5000),
    "/api/workspace/runtime-events/history?assessment_id=assessment-101&limit=5000",
  );
  assert.equal(
    workspaceRuntimeHistoryUrl("assessment-101", "cursor-1", 25),
    "/api/workspace/runtime-events/history?assessment_id=assessment-101&limit=25&cursor=cursor-1",
  );
});

test("agent stream history merge can page back beyond the initial 5000-event replay window", () => {
  const newestWindow = Array.from({ length: 5_000 }, (_, index) =>
    agentStreamEvent(index + 1_002),
  );
  const olderPage = Array.from({ length: 1_001 }, (_, index) =>
    agentStreamEvent(index + 1),
  );

  const merged = mergeAgentStreamEvents(newestWindow, olderPage, {
    limit: null,
  });

  assert.equal(merged.length, 6_001);
  assert.equal(merged.at(0)?.eventId, "agent-event-1");
  assert.equal(merged.at(-1)?.eventId, "agent-event-6001");
});

test("agent stream history keeps the cursor boundary while live tail advances", () => {
  const liveTail = Array.from({ length: 5_000 }, (_, index) =>
    agentStreamEvent(index + 1_003),
  );
  const initialHistoryPage = Array.from({ length: 5_000 }, (_, index) =>
    agentStreamEvent(index + 1_002),
  );
  const olderPage = Array.from({ length: 1_001 }, (_, index) =>
    agentStreamEvent(index + 1),
  );

  const afterInitialHistory = mergeAgentStreamEvents(
    liveTail,
    initialHistoryPage,
    {
      limit: agentStreamRetentionLimit(
        agentStreamHistoryState({ hasMore: true, nextCursor: "cursor-1002" }),
      ),
    },
  );
  const reconstructed = mergeAgentStreamEvents(
    afterInitialHistory,
    olderPage,
    {
      limit: agentStreamRetentionLimit(
        agentStreamHistoryState({ hasLoadedOlderHistory: true }),
      ),
    },
  );

  assert.equal(afterInitialHistory.length, 5_001);
  assert.equal(afterInitialHistory.at(0)?.eventId, "agent-event-1002");
  assert.equal(afterInitialHistory.at(-1)?.eventId, "agent-event-6002");
  assert.equal(reconstructed.length, 6_002);
  assert.deepEqual(
    reconstructed.map((event) => event.sequence),
    Array.from({ length: 6_002 }, (_, index) => index + 1),
  );
});

test("agent stream live merge remains bounded until older history is explicitly loaded", () => {
  const previous = Array.from({ length: 5_000 }, (_, index) =>
    agentStreamEvent(index + 1),
  );

  const merged = mergeAgentStreamEvents(previous, [agentStreamEvent(5_001)], {
    limit: 5_000,
  });

  assert.equal(merged.length, 5_000);
  assert.equal(merged.at(0)?.eventId, "agent-event-2");
  assert.equal(merged.at(-1)?.eventId, "agent-event-5001");
});

test("complete selected assessment history keeps visible rows after crossing 5000 live events", () => {
  const completeInitialHistory = Array.from({ length: 5_000 }, (_, index) =>
    agentStreamEvent(index + 1),
  );
  const liveEvents = Array.from({ length: 250 }, (_, index) =>
    agentStreamEvent(index + 5_001),
  );

  const afterLiveAppend = mergeAgentStreamEvents(
    completeInitialHistory,
    liveEvents,
    {
      limit: agentStreamRetentionLimit(
        agentStreamHistoryState({ hasHydratedCompleteHistory: true }),
      ),
    },
  );

  assert.equal(afterLiveAppend.length, 5_250);
  assert.equal(afterLiveAppend.at(0)?.eventId, "agent-event-1");
  assert.equal(afterLiveAppend.at(-1)?.eventId, "agent-event-5250");
});

test("initial agent stream history failures release the retry gate", () => {
  const initialHistoryRequests = new Set(["assessment-101"]);

  retainInitialAgentStreamHistoryRequest(
    initialHistoryRequests,
    "assessment-101",
    false,
  );
  assert.equal(initialHistoryRequests.has("assessment-101"), false);

  retainInitialAgentStreamHistoryRequest(
    initialHistoryRequests,
    "assessment-101",
    true,
  );
  assert.equal(initialHistoryRequests.has("assessment-101"), true);
});

test("workspace runtime provider opens and cleans up scoped semantic replay streams", () => {
  class FakeEventSource {
    closeCount = 0;
    readonly listeners = new Map<
      string,
      Array<(event: MessageEvent<string>) => void>
    >();

    constructor(readonly url: string) {}

    addEventListener(
      type: "workspace.agent-stream",
      listener: (event: MessageEvent<string>) => void,
    ) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    removeEventListener(
      type: "workspace.agent-stream",
      listener: (event: MessageEvent<string>) => void,
    ) {
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter((item) => item !== listener),
      );
    }

    close() {
      this.closeCount += 1;
    }
  }
  const opened: FakeEventSource[] = [];
  const scopedAgentStreams = new Map<string, ScopedAgentStreamEntry>();
  const subscribe = (assessmentId: string) =>
    subscribeScopedAssessmentRuntimeStream({
      assessmentId,
      appendAgentStreamEvent: () => true,
      scopedAgentStreams,
      createEventSource: (url) => {
        const source = new FakeEventSource(url);
        opened.push(source);
        return source;
      },
    });

  const unsubscribeFirst = subscribe("assessment-101");
  const unsubscribeSecond = subscribe("assessment-101");

  assert.equal(opened.length, 1);
  assert.equal(
    opened[0]?.url,
    "/api/workspace/runtime-events?assessment_id=assessment-101&agent_stream_only=1",
  );
  unsubscribeFirst();
  assert.equal(opened[0]?.closeCount, 0);
  unsubscribeSecond();
  assert.equal(opened[0]?.closeCount, 1);
  assert.equal(scopedAgentStreams.size, 0);

  const unsubscribeThird = subscribe("assessment-202");
  assert.equal(
    opened[1]?.url,
    "/api/workspace/runtime-events?assessment_id=assessment-202&agent_stream_only=1",
  );
  unsubscribeThird();
  assert.equal(opened[1]?.closeCount, 1);
});

test("agent stream parser preserves streamed whitespace and structured metadata", () => {
  const parsed = parseAgentStreamEvent(
    JSON.stringify({
      event_id: "agent-event-1",
      sequence: 7,
      client_sequence: 3,
      emitted_at: "2026-09-16T00:00:00.000Z",
      assessment_id: "assessment-1",
      run_id: "run-1",
      correlation_id: "corr-1",
      event_type: "MODEL_CONTENT_DELTA",
      source: "engineering",
      agent_name: "planner",
      namespace: ["task:planner"],
      node_name: "model",
      message_id: "message-1",
      tool_name: null,
      tool_call_id: null,
      status: "RUNNING",
      text: " hello \n",
      data: { provider: "openai" },
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed?.text, " hello \n");
  assert.equal(parsed?.agentName, "planner");
  assert.deepEqual(parsed?.namespace, ["task:planner"]);
  assert.deepEqual(parsed?.data, { provider: "openai" });
});

test("agent stream parser preserves semantic runtime payloads", () => {
  const parsed = parseAgentStreamEvent(
    JSON.stringify({
      event_id: "agent-event-2",
      sequence: 8,
      client_sequence: 4,
      emitted_at: "2026-09-16T00:00:01.000Z",
      assessment_id: "assessment-1",
      run_id: "run-1",
      correlation_id: "corr-1",
      event_type: "SEMANTIC_TOOL_CALL",
      source: "engineering",
      agent_name: "investigator",
      namespace: ["task:investigator"],
      node_name: "model",
      message_id: "message-2",
      tool_name: "search_nodes",
      tool_call_id: "call-2",
      status: "RUNNING",
      text: "tool call started",
      data: {
        schemaVersion: "AGENT_STREAM_SEMANTIC_V1",
        kind: "TOOL_CALL",
        durability: "DURABLE",
        toolName: "search_nodes",
        toolCallId: "call-2",
        parameters: {
          nodeType: "AI_MODEL_INVOCATION",
          api_key: "[REDACTED]",
        },
        evidenceRefs: ["evidence:ai:1"],
      },
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed?.eventType, "SEMANTIC_TOOL_CALL");
  assert.deepEqual(parsed?.data, {
    schemaVersion: "AGENT_STREAM_SEMANTIC_V1",
    kind: "TOOL_CALL",
    durability: "DURABLE",
    toolName: "search_nodes",
    toolCallId: "call-2",
    parameters: {
      nodeType: "AI_MODEL_INVOCATION",
      api_key: "[REDACTED]",
    },
    evidenceRefs: ["evidence:ai:1"],
  });
});

test("workspace runtime parser groups runs and activity by assessment", () => {
  const parsed = parseRuntimeEvent(
    JSON.stringify({
      emitted_at: "2026-08-13T11:00:00.000Z",
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
              started_at: "2026-08-13T10:59:00.000Z",
              attempt: 1,
            },
          ],
          updated_at: "2026-08-13T11:00:00.000Z",
        },
      ],
      recent_activity: [
        {
          event_id: "evt-1",
          sequence: 2,
          emitted_at: "2026-08-13T11:00:00.000Z",
          organization_id: "org-1",
          assessment_id: "assessment-1",
          run_id: "run-1",
          correlation_id: "corr-1",
          event_type: "TOOL_COMPLETED",
          run_status: "RUNNING",
          stage: "TECHNICAL_EVIDENCE",
          tool_name: "get_scan_coverage",
          summary: "Completed get_scan_coverage with 2 items",
          input_summary: { maxResults: 25 },
          output_summary: { itemCount: 2 },
          error_summary: null,
          started_at: "2026-08-13T10:59:00.000Z",
          completed_at: "2026-08-13T11:00:00.000Z",
          duration_ms: 1000,
          attempt: 1,
          waiting_reason: null,
        },
      ],
      repository_snapshots: [
        {
          id: "snapshot-1",
          assessment_id: "assessment-1",
          branch: "main",
          commit_sha: "abc123",
          created_at: "2026-08-13T10:58:00.000Z",
        },
      ],
      scan_jobs: [],
      evidence_reports: [],
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed?.runs.length, 1);
  assert.equal(parsed?.recentActivity.length, 1);
  assert.equal(parsed?.repositorySnapshots[0]?.id, "snapshot-1");
  assert.equal(parsed?.repositorySnapshots[0]?.branch, "main");
  assert.equal(parsed?.latestRunIdByAssessmentId["assessment-1"], "run-1");

  const assessmentRuntime = parsed?.getAssessmentRuntime("assessment-1");
  assert.equal(assessmentRuntime?.currentRun?.runId, "run-1");
  assert.equal(
    assessmentRuntime?.recentActivity[0]?.toolName,
    "get_scan_coverage",
  );
});

test("workspace runtime fingerprint ignores running scan heartbeat timestamps", () => {
  const first = parseRuntimeEvent(
    JSON.stringify({
      emitted_at: "2026-08-13T11:00:00.000Z",
      runs: [],
      recent_activity: [
        {
          event_id: "scan-job:scan-1:RUNNING",
          sequence: 0,
          emitted_at: "2026-08-13T11:00:00.000Z",
          organization_id: "org-1",
          assessment_id: "assessment-1",
          run_id: "scan-1",
          correlation_id: "scan-1",
          event_type: "TOOL_STARTED",
          run_status: "RUNNING",
          stage: "SCAN",
          tool_name: "repository_scan",
          summary: "Repository scan is running",
          input_summary: { snapshotId: "snapshot-1" },
          output_summary: {
            status: "RUNNING",
            observedAt: "2026-08-13T11:00:00.000Z",
          },
          error_summary: null,
          started_at: null,
          completed_at: null,
          duration_ms: null,
          attempt: 1,
          waiting_reason: null,
        },
      ],
      repository_snapshots: [],
      scan_jobs: [],
      evidence_reports: [],
    }),
  );
  const next = parseRuntimeEvent(
    JSON.stringify({
      emitted_at: "2026-08-13T11:00:02.000Z",
      runs: [],
      recent_activity: [
        {
          event_id: "scan-job:scan-1:RUNNING",
          sequence: 0,
          emitted_at: "2026-08-13T11:00:02.000Z",
          organization_id: "org-1",
          assessment_id: "assessment-1",
          run_id: "scan-1",
          correlation_id: "scan-1",
          event_type: "TOOL_STARTED",
          run_status: "RUNNING",
          stage: "SCAN",
          tool_name: "repository_scan",
          summary: "Repository scan is running",
          input_summary: { snapshotId: "snapshot-1" },
          output_summary: {
            status: "RUNNING",
            observedAt: "2026-08-13T11:00:02.000Z",
          },
          error_summary: null,
          started_at: null,
          completed_at: null,
          duration_ms: null,
          attempt: 1,
          waiting_reason: null,
        },
      ],
      repository_snapshots: [],
      scan_jobs: [],
      evidence_reports: [],
    }),
  );

  assert.ok(first);
  assert.ok(next);
  assert.equal(runtimeFingerprint(first), runtimeFingerprint(next));
});

test("runtime console model sorts scan steps and expands active or failed steps", () => {
  const model = buildRuntimeConsoleModel([
    runtimeActivity({
      eventId: "tool-completed",
      eventType: "TOOL_COMPLETED",
      runStatus: "RUNNING",
      sequence: 2,
      toolName: "syft",
      summary: "Completed syft",
    }),
    runtimeActivity({
      eventId: "tool-started",
      eventType: "TOOL_STARTED",
      runStatus: "RUNNING",
      sequence: 1,
      toolName: "materialize_snapshot",
      summary: "Materializing snapshot",
    }),
    runtimeActivity({
      eventId: "tool-failed",
      eventType: "TOOL_FAILED",
      runStatus: "RUNNING",
      sequence: 3,
      toolName: "deptry",
      summary: "deptry completed with a non-blocking failure",
    }),
  ]);

  assert.deepEqual(
    model.steps.map((step) => step.id),
    ["tool-started", "tool-completed", "tool-failed"],
  );
  assert.equal(model.runningCount, 1);
  assert.equal(model.waitingCount, 0);
  assert.equal(model.completedCount, 1);
  assert.equal(model.failedCount, 1);
  assert.equal(model.activeStep?.id, "tool-started");
  assert.equal(model.steps[0]?.defaultExpanded, true);
  assert.equal(model.steps[1]?.defaultExpanded, false);
  assert.equal(model.steps[2]?.defaultExpanded, true);
});

test("runtime console model keeps waiting steps out of completed fallback", () => {
  const model = buildRuntimeConsoleModel([
    runtimeActivity({
      eventId: "scan-waiting",
      eventType: "TOOL_COMPLETED",
      runStatus: "WAITING",
      sequence: 1,
      toolName: "repository_scan",
      summary: "Repository scan is waiting",
      waitingReason: "Nhấn để xem chi tiết",
    }),
  ]);

  assert.equal(model.runningCount, 0);
  assert.equal(model.waitingCount, 1);
  assert.equal(model.completedCount, 0);
  assert.equal(model.activeStep?.id, "scan-waiting");
  assert.equal(model.steps[0]?.defaultExpanded, true);
});

test("runtime console model closes orphaned tool starts after the run completes", () => {
  const model = buildRuntimeConsoleModel([
    runtimeActivity({
      eventId: "semgrep-started",
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      sequence: 1,
      toolName: "semgrep",
      summary: "Running semgrep analysis",
    }),
    runtimeActivity({
      eventId: "run-completed",
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
      sequence: 2,
      toolName: "repository_scan",
      summary: "Repository scan completed",
    }),
  ]);

  assert.equal(model.runningCount, 0);
  assert.equal(model.completedCount, 2);
  assert.equal(model.activeStep, null);
  assert.equal(model.steps[0]?.isActive, false);
  assert.equal(
    model.steps[0]?.item.runStatus,
    ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
  );
  assert.deepEqual(model.steps[0]?.item.outputSummary, {
    status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
    completedBy: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
  });
});

test("runtime console model closes orphaned tool starts from terminal scan job status", () => {
  const model = buildRuntimeConsoleModel(
    [
      runtimeActivity({
        eventId: "python-started",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        sequence: 1,
        toolName: "python_semantic_analysis",
        summary: "Running Python semantic analysis",
      }),
    ],
    { runStatusOverride: REPOSITORY_SCAN_JOB_STATUSES.completed },
  );

  assert.equal(model.runningCount, 0);
  assert.equal(model.completedCount, 1);
  assert.equal(model.activeStep, null);
  assert.deepEqual(model.steps[0]?.item.outputSummary, {
    status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
    completedBy: "REPOSITORY_SCAN_JOB_STATUS",
  });
});

test("runtime console activity keeps only the latest scan run", () => {
  const selected = selectRuntimeConsoleActivity({
    activity: [
      runtimeActivity({
        eventId: "old-scan",
        runId: "scan-old",
        emittedAt: "2026-08-13T10:00:00.000Z",
      }),
      runtimeActivity({
        eventId: "new-scan",
        runId: "scan-new",
        emittedAt: "2026-08-13T11:00:00.000Z",
      }),
      runtimeActivity({
        eventId: "old-report",
        runId: "scan-old",
        eventType: "RUN_COMPLETED",
        runStatus: "COMPLETED",
      }),
    ],
    latestScanJobId: "scan-new",
    activeRunId: "scan-old",
    latestRunId: "scan-old",
  });

  assert.deepEqual(
    selected.map((item) => item.eventId),
    ["new-scan"],
  );
});

function runtimeActivity(
  override: Partial<WorkspaceRuntimeActivityItem>,
): WorkspaceRuntimeActivityItem {
  return {
    eventId: "event-1",
    sequence: 1,
    emittedAt: "2026-08-13T11:00:00.000Z",
    assessmentId: "assessment-1",
    runId: "scan-1",
    correlationId: "corr-1",
    eventType: "TOOL_STARTED",
    runStatus: "RUNNING",
    stage: "SCAN",
    toolName: "repository_scan",
    summary: "Repository scan is running",
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempt: 1,
    waitingReason: null,
    ...override,
  };
}

function agentStreamEvent(sequence: number): AssessmentAgentStreamEvent {
  return {
    eventId: `agent-event-${sequence}`,
    sequence,
    clientSequence: null,
    emittedAt: `2026-09-16T00:${String(
      Math.floor(sequence / 60),
    ).padStart(2, "0")}:${String(sequence % 60).padStart(2, "0")}.000Z`,
    assessmentId: "assessment-101",
    runId: "run-101",
    correlationId: "corr-101",
    eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
    source: "engineering",
    agentName: "investigator",
    subagentName: null,
    namespace: [],
    nodeName: "model",
    messageId: "message-101",
    toolName: null,
    toolCallId: null,
    status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    text: `delta-${sequence}`,
    data: null,
  };
}

function agentStreamHistoryState(
  override: Partial<WorkspaceRuntimeAgentStreamHistoryState>,
): WorkspaceRuntimeAgentStreamHistoryState {
  return {
    hasMore: false,
    nextCursor: null,
    isLoading: false,
    error: null,
    hasLoadedOlderHistory: false,
    hasHydratedCompleteHistory: false,
    ...override,
  };
}
