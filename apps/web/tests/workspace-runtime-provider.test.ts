import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

import {
  parseRuntimeEvent,
  runtimeFingerprint,
} from "../src/features/workspace/utils/workspace-runtime-parser.ts";
import type { WorkspaceRuntimeActivityItem } from "../src/features/workspace/types/workspace-runtime.types.ts";
import {
  buildRuntimeConsoleModel,
  selectRuntimeConsoleActivity,
} from "../src/features/evidence/utils/runtime-console.ts";

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
