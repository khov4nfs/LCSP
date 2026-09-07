import {
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  FINAL_ASSESSMENT_RESULT_STATUSES,
  isPostFindingRuntimePhase,
  isRemediationDecision,
  REMEDIATION_APPROVAL_STATUSES,
  VERIFICATION_RESULT_STATUSES,
  type AssessmentPostFindingActivity,
  type AssessmentPostFindingRuntimeState,
} from "@lcsp/contracts/evidence";

import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeActiveTool,
  type WorkspaceRuntimeContextValue,
  type WorkspaceRuntimeEvidenceReport,
  type WorkspaceRuntimeRepositorySnapshot,
  type WorkspaceRuntimeRun,
  type WorkspaceRuntimeScanJob,
  type WorkspaceRuntimeSummaryValue,
} from "../types/workspace-runtime.types.ts";

export function parseRuntimeEvent(
  data: string,
): WorkspaceRuntimeContextValue | null {
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
  const repositorySnapshots = Array.isArray(payload.repository_snapshots)
    ? payload.repository_snapshots
        .map(parseRepositorySnapshot)
        .filter(isDefined)
    : [];
  const scanJobs = Array.isArray(payload.scan_jobs)
    ? payload.scan_jobs.map(parseScanJob).filter(isDefined)
    : [];
  const evidenceReports = Array.isArray(payload.evidence_reports)
    ? payload.evidence_reports.map(parseEvidenceReport).filter(isDefined)
    : [];
  const postFindingStates = Array.isArray(payload.post_finding)
    ? payload.post_finding.map(parsePostFindingState).filter(isDefined)
    : [];

  const runsByAssessmentId = groupRunsByAssessmentId(runs);
  const recentActivityByAssessmentId =
    groupActivityByAssessmentId(recentActivity);
  const latestRunIdByAssessmentId = deriveLatestRunIds(runsByAssessmentId);
  const postFindingByAssessmentId = Object.fromEntries(
    postFindingStates.map((state) => [state.assessmentId, state]),
  );

  return {
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    emittedAt: payload.emitted_at as string,
    runs,
    recentActivity,
    repositorySnapshots,
    scanJobs,
    evidenceReports,
    postFindingStates,
    runsByAssessmentId,
    recentActivityByAssessmentId,
    latestRunIdByAssessmentId,
    postFindingByAssessmentId,
    getAssessmentRuntime: (assessmentId: string) => ({
      currentRun: runsByAssessmentId[assessmentId]?.[0] ?? null,
      recentActivity: recentActivityByAssessmentId[assessmentId] ?? [],
      latestRunId: latestRunIdByAssessmentId[assessmentId] ?? null,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      lastEmittedAt: payload.emitted_at as string,
      postFinding: postFindingByAssessmentId[assessmentId] ?? null,
    }),
  };
}

function parsePostFindingState(
  value: unknown,
): AssessmentPostFindingRuntimeState | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.assessment_id !== "string" ||
    !isPostFindingRuntimePhase(item.phase) ||
    !isApprovalStatus(item.approval_status)
  ) {
    return null;
  }

  return {
    assessmentId: item.assessment_id,
    phase: item.phase,
    codeReviewActivities: parsePostFindingActivities(item.code_review_activities),
    decisionAvailability: Array.isArray(item.decision_availability)
      ? item.decision_availability.filter(isRemediationDecision)
      : [],
    selectedDecision: isRemediationDecision(item.selected_decision)
      ? item.selected_decision
      : undefined,
    selectedDecisionAt:
      typeof item.selected_decision_at === "string"
        ? item.selected_decision_at
        : undefined,
    detectedPullRequest: parsePullRequest(item.detected_pull_request),
    createdPullRequest: parsePullRequest(item.created_pull_request),
    approvalStatus: item.approval_status,
    approvedPatchVersion:
      typeof item.approved_patch_version === "string"
        ? item.approved_patch_version
        : undefined,
    verificationActivities: parsePostFindingActivities(item.verification_activities),
    verificationStatus: isVerificationStatus(item.verification_status)
      ? item.verification_status
      : undefined,
    finalResult: isFinalResultStatus(item.final_result)
      ? item.final_result
      : undefined,
    canContinueRemediation:
      typeof item.can_continue_remediation === "boolean"
        ? item.can_continue_remediation
        : undefined,
    artifacts: parseArtifactRefs(item.artifacts),
  };
}

function parsePostFindingActivities(value: unknown): AssessmentPostFindingActivity[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const item = parseObject(entry);
    if (
      item === null ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      !isRunStatus(item.status)
    ) {
      return [];
    }
    return [{
      id: item.id,
      label: item.label,
      detail: typeof item.detail === "string" ? item.detail : undefined,
      status: item.status,
    }];
  });
}

function parsePullRequest(value: unknown) {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.number !== "number" ||
    typeof item.branch !== "string" ||
    typeof item.patch_version !== "string"
  ) {
    return undefined;
  }
  return {
    number: item.number,
    branch: item.branch,
    patchVersion: item.patch_version,
    url: typeof item.url === "string" ? item.url : undefined,
  };
}

function parseArtifactRefs(value: unknown) {
  const item = parseObject(value);
  if (item === null) {
    return undefined;
  }
  return {
    remediationPatchResourceId:
      typeof item.remediation_patch_resource_id === "string"
        ? item.remediation_patch_resource_id
        : undefined,
    verificationReportResourceId:
      typeof item.verification_report_resource_id === "string"
        ? item.verification_report_resource_id
        : undefined,
    finalReportResourceId:
      typeof item.final_report_resource_id === "string"
        ? item.final_report_resource_id
        : undefined,
  };
}

function isRunStatus(value: unknown): value is AssessmentPostFindingActivity["status"] {
  return (
    typeof value === "string" &&
    Object.values(ASSESSMENT_RUNTIME_RUN_STATUSES).includes(
      value as AssessmentPostFindingActivity["status"],
    )
  );
}

function isApprovalStatus(
  value: unknown,
): value is AssessmentPostFindingRuntimeState["approvalStatus"] {
  return (
    typeof value === "string" &&
    Object.values(REMEDIATION_APPROVAL_STATUSES).includes(
      value as AssessmentPostFindingRuntimeState["approvalStatus"],
    )
  );
}

function isVerificationStatus(
  value: unknown,
): value is NonNullable<AssessmentPostFindingRuntimeState["verificationStatus"]> {
  return (
    typeof value === "string" &&
    Object.values(VERIFICATION_RESULT_STATUSES).includes(
      value as NonNullable<AssessmentPostFindingRuntimeState["verificationStatus"]>,
    )
  );
}

function isFinalResultStatus(
  value: unknown,
): value is NonNullable<AssessmentPostFindingRuntimeState["finalResult"]> {
  return (
    typeof value === "string" &&
    Object.values(FINAL_ASSESSMENT_RESULT_STATUSES).includes(
      value as NonNullable<AssessmentPostFindingRuntimeState["finalResult"]>,
    )
  );
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

function parseActivityItem(
  value: unknown,
): WorkspaceRuntimeActivityItem | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.event_id !== "string" ||
    typeof item.sequence !== "number" ||
    typeof item.emitted_at !== "string" ||
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

function parseRepositorySnapshot(
  value: unknown,
): WorkspaceRuntimeRepositorySnapshot | null {
  const item = parseObject(value);
  if (
    item === null ||
    typeof item.id !== "string" ||
    typeof item.assessment_id !== "string" ||
    typeof item.commit_sha !== "string" ||
    typeof item.created_at !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    assessmentId: item.assessment_id,
    provider: typeof item.provider === "string" ? item.provider : null,
    repositoryFullName:
      typeof item.repository_full_name === "string"
        ? item.repository_full_name
        : null,
    branch: typeof item.branch === "string" ? item.branch : null,
    commitSha: item.commit_sha,
    createdAt: item.created_at,
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
      .filter(
        (entry): entry is [string, WorkspaceRuntimeSummaryValue] =>
          entry[1] !== null,
      ),
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

function deriveLatestRunIds(
  runsByAssessmentId: Record<string, WorkspaceRuntimeRun[]>,
) {
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
  repositorySnapshots: WorkspaceRuntimeRepositorySnapshot[];
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
      shouldFingerprintActivityEmittedAt(item) ? item.emittedAt : null,
      item.durationMs,
    ]),
    repositorySnapshots: runtime.repositorySnapshots.map((snapshot) => [
      snapshot.id,
      snapshot.assessmentId,
      snapshot.provider,
      snapshot.repositoryFullName,
      snapshot.commitSha,
      snapshot.createdAt,
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

function shouldFingerprintActivityEmittedAt(
  item: WorkspaceRuntimeActivityItem,
): boolean {
  return !(
    item.eventId.startsWith("scan-job:") &&
    item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running
  );
}

export function affectedAssessmentIds(runtime: {
  runs: WorkspaceRuntimeRun[];
  recentActivity: WorkspaceRuntimeActivityItem[];
  repositorySnapshots: WorkspaceRuntimeRepositorySnapshot[];
  scanJobs: WorkspaceRuntimeScanJob[];
  evidenceReports: WorkspaceRuntimeEvidenceReport[];
}) {
  return new Set([
    ...runtime.runs.map((run) => run.assessmentId),
    ...runtime.recentActivity.map((item) => item.assessmentId),
    ...runtime.repositorySnapshots.map((snapshot) => snapshot.assessmentId),
    ...runtime.scanJobs.map((scanJob) => scanJob.assessmentId),
    ...runtime.evidenceReports.map((report) => report.assessmentId),
  ]);
}
