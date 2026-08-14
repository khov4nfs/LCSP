import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeActiveTool,
  type WorkspaceRuntimeContextValue,
  type WorkspaceRuntimeEvidenceReport,
  type WorkspaceRuntimeRun,
  type WorkspaceRuntimeScanJob,
  type WorkspaceRuntimeSummaryValue,
} from "../types/workspace-runtime.types.ts";

export function parseRuntimeEvent(data: string): WorkspaceRuntimeContextValue | null {
  const payload = parseObject(data);
  if (payload === null || typeof payload.emitted_at !== "string") {
    return null;
  }

  const runs = Array.isArray(payload.runs)
    ? payload.runs.map(parseRun).filter(isDefined)
    : [];
  const recentActivity = Array.isArray(payload.recent_activity)
    ? payload.recent_activity.map(parseActivityItem).filter(isDefined)
    : [];
  const scanJobs = Array.isArray(payload.scan_jobs)
    ? payload.scan_jobs.map(parseScanJob).filter(isDefined)
    : [];
  const evidenceReports = Array.isArray(payload.evidence_reports)
    ? payload.evidence_reports.map(parseEvidenceReport).filter(isDefined)
    : [];

  const runsByAssessmentId = groupRunsByAssessmentId(runs);
  const recentActivityByAssessmentId = groupActivityByAssessmentId(recentActivity);
  const latestRunIdByAssessmentId = deriveLatestRunIds(runsByAssessmentId);

  return {
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    emittedAt: payload.emitted_at as string,
    runs,
    recentActivity,
    scanJobs,
    evidenceReports,
    runsByAssessmentId,
    recentActivityByAssessmentId,
    latestRunIdByAssessmentId,
    getAssessmentRuntime: (assessmentId: string) => ({
      currentRun: runsByAssessmentId[assessmentId]?.[0] ?? null,
      recentActivity: recentActivityByAssessmentId[assessmentId] ?? [],
      latestRunId: latestRunIdByAssessmentId[assessmentId] ?? null,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: payload.emitted_at as string,
    }),
  };
}

function parseRun(value: unknown): WorkspaceRuntimeRun | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.assessment_id !== "string" ||
    typeof item.run_id !== "string" ||
    typeof item.stage !== "string" ||
    typeof item.status !== "string" ||
    typeof item.updated_at !== "string"
  ) {
    return null;
  }

  const activeTools = Array.isArray(item.active_tools)
    ? item.active_tools.map(parseActiveTool).filter(isDefined)
    : [];

  return {
    assessmentId: item.assessment_id,
    runId: item.run_id,
    stage: item.stage,
    status: item.status,
    activeTools,
    updatedAt: item.updated_at,
  };
}

function parseActiveTool(value: unknown): WorkspaceRuntimeActiveTool | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.tool_name !== "string" ||
    typeof item.status !== "string" ||
    typeof item.summary !== "string"
  ) {
    return null;
  }

  return {
    toolName: item.tool_name,
    status: item.status,
    summary: item.summary,
    startedAt: typeof item.started_at === "string" ? item.started_at : null,
    attempt: typeof item.attempt === "number" ? item.attempt : null,
  };
}

function parseActivityItem(value: unknown): WorkspaceRuntimeActivityItem | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.event_id !== "string" ||
    typeof item.sequence !== "number" ||
    typeof item.emitted_at !== "string" ||
    typeof item.organization_id !== "string" ||
    typeof item.assessment_id !== "string" ||
    typeof item.run_id !== "string" ||
    typeof item.correlation_id !== "string" ||
    typeof item.event_type !== "string" ||
    typeof item.run_status !== "string" ||
    typeof item.stage !== "string" ||
    typeof item.summary !== "string"
  ) {
    return null;
  }

  return {
    eventId: item.event_id,
    sequence: item.sequence,
    emittedAt: item.emitted_at,
    organizationId: item.organization_id,
    assessmentId: item.assessment_id,
    runId: item.run_id,
    correlationId: item.correlation_id,
    eventType: item.event_type,
    runStatus: item.run_status,
    stage: item.stage,
    toolName: typeof item.tool_name === "string" ? item.tool_name : null,
    summary: item.summary,
    inputSummary: parseSummaryValue(item.input_summary),
    outputSummary: parseSummaryValue(item.output_summary),
    errorSummary:
      typeof item.error_summary === "string" ? item.error_summary : null,
    startedAt: typeof item.started_at === "string" ? item.started_at : null,
    completedAt:
      typeof item.completed_at === "string" ? item.completed_at : null,
    durationMs: typeof item.duration_ms === "number" ? item.duration_ms : null,
    attempt: typeof item.attempt === "number" ? item.attempt : null,
    waitingReason:
      typeof item.waiting_reason === "string" ? item.waiting_reason : null,
  };
}

function parseScanJob(value: unknown): WorkspaceRuntimeScanJob | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.id !== "string" ||
    typeof item.assessment_id !== "string" ||
    typeof item.snapshot_id !== "string" ||
    typeof item.status !== "string" ||
    typeof item.attempt_count !== "number" ||
    typeof item.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    assessmentId: item.assessment_id,
    snapshotId: item.snapshot_id,
    status: item.status,
    attemptCount: item.attempt_count,
    blockedReason:
      typeof item.blocked_reason === "string" ? item.blocked_reason : null,
    updatedAt: item.updated_at,
  };
}

function parseEvidenceReport(
  value: unknown,
): WorkspaceRuntimeEvidenceReport | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.id !== "string" ||
    typeof item.assessment_id !== "string" ||
    typeof item.scan_job_id !== "string" ||
    typeof item.snapshot_id !== "string" ||
    typeof item.status !== "string" ||
    typeof item.created_at !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    assessmentId: item.assessment_id,
    scanJobId: item.scan_job_id,
    snapshotId: item.snapshot_id,
    status: item.status,
    rejectionReason:
      typeof item.rejection_reason === "string" ? item.rejection_reason : null,
    createdAt: item.created_at,
  };
}

function parseSummaryValue(
  value: unknown,
): WorkspaceRuntimeSummaryValue | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseSummaryValue(item) ?? null);
  }
  const item = parseObject(value);
  if (item === null) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(item)
      .map(([key, itemValue]) => [key, parseSummaryValue(itemValue)])
      .filter((entry): entry is [string, WorkspaceRuntimeSummaryValue] => entry[1] !== null),
  );
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function groupRunsByAssessmentId(runs: WorkspaceRuntimeRun[]) {
  const groups: Record<string, WorkspaceRuntimeRun[]> = {};
  for (const run of runs) {
    groups[run.assessmentId] ??= [];
    groups[run.assessmentId].push(run);
  }
  for (const assessmentId of Object.keys(groups)) {
    groups[assessmentId]?.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }
  return groups;
}

function groupActivityByAssessmentId(activity: WorkspaceRuntimeActivityItem[]) {
  const groups: Record<string, WorkspaceRuntimeActivityItem[]> = {};
  for (const item of activity) {
    groups[item.assessmentId] ??= [];
    groups[item.assessmentId].push(item);
  }
  for (const assessmentId of Object.keys(groups)) {
    groups[assessmentId]?.sort((left, right) =>
      right.emittedAt.localeCompare(left.emittedAt),
    );
  }
  return groups;
}

function deriveLatestRunIds(runsByAssessmentId: Record<string, WorkspaceRuntimeRun[]>) {
  return Object.fromEntries(
    Object.entries(runsByAssessmentId)
      .map(([assessmentId, runs]) =>
        runs[0] ? [assessmentId, runs[0].runId] : null,
      )
      .filter((entry): entry is [string, string] => entry !== null),
  );
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

export function runtimeFingerprint(runtime: {
  runs: WorkspaceRuntimeRun[];
  recentActivity: WorkspaceRuntimeActivityItem[];
  scanJobs: WorkspaceRuntimeScanJob[];
  evidenceReports: WorkspaceRuntimeEvidenceReport[];
}) {
  return JSON.stringify({
    runs: runtime.runs.map((run) => [
      run.assessmentId,
      run.runId,
      run.stage,
      run.status,
      run.updatedAt,
      run.activeTools.map((tool) => [
        tool.toolName,
        tool.status,
        tool.summary,
        tool.startedAt,
        tool.attempt,
      ]),
    ]),
    recentActivity: runtime.recentActivity.map((item) => [
      item.eventId,
      item.sequence,
      item.runId,
      item.eventType,
      item.runStatus,
      item.summary,
      item.emittedAt,
      item.durationMs,
    ]),
    scanJobs: runtime.scanJobs.map((scanJob) => [
      scanJob.id,
      scanJob.status,
      scanJob.attemptCount,
      scanJob.blockedReason,
      scanJob.updatedAt,
    ]),
    evidenceReports: runtime.evidenceReports.map((report) => [
      report.id,
      report.status,
      report.rejectionReason,
      report.createdAt,
    ]),
  });
}

export function affectedAssessmentIds(runtime: {
  runs: WorkspaceRuntimeRun[];
  recentActivity: WorkspaceRuntimeActivityItem[];
  scanJobs: WorkspaceRuntimeScanJob[];
  evidenceReports: WorkspaceRuntimeEvidenceReport[];
}) {
  return new Set([
    ...runtime.runs.map((run) => run.assessmentId),
    ...runtime.recentActivity.map((item) => item.assessmentId),
    ...runtime.scanJobs.map((scanJob) => scanJob.assessmentId),
    ...runtime.evidenceReports.map((report) => report.assessmentId),
  ]);
}

