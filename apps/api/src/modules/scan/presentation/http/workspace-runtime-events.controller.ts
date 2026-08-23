import { Controller, Logger, Req, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import {
  EMPTY,
  catchError,
  defer,
  exhaustMap,
  interval,
  map,
  startWith,
} from "rxjs";

import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import type { PbacRequestContext } from "../../../../platform/pbac/interfaces/pbac-request.interface.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";

interface WorkspaceRuntimeRequest {
  pbacContext: PbacRequestContext;
}

/**
 * Streams organization-scoped orchestration runtime snapshots to authorized workspace clients over Server-Sent Events.
 */
@Controller("workspace/runtime-events")
export class WorkspaceRuntimeEventsController {
  private readonly logger = new Logger(WorkspaceRuntimeEventsController.name);

  /**
   * Creates the SSE controller with the runtime snapshot aggregation service.
   *
   * @param runtimeEvents - Service that builds current workspace run/tool/activity snapshots.
   */
  constructor(private readonly runtimeEvents: AssessmentRuntimeEventService) {}

  /**
   * Emits an immediate workspace runtime snapshot and refreshes it every two seconds for the caller's organization.
   *
   * @param request - Authenticated request containing the organization-scoped PBAC context.
   * @returns RxJS stream of `workspace.runtime` SSE messages.
   */
  @Sse()
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.workspaceRead)
  stream(@Req() request: WorkspaceRuntimeRequest) {
    const organizationId = request.pbacContext.organizationId;

    return interval(2_000).pipe(
      startWith(0),
      exhaustMap(() =>
        defer(() =>
          this.runtimeEvents.buildWorkspaceSnapshot(organizationId),
        ).pipe(
          map((data): MessageEvent => ({
            type: "workspace.runtime",
            data: {
              emitted_at: data.emittedAt,
              runs: data.runs.map((run) => ({
                assessment_id: run.assessmentId,
                run_id: run.runId,
                stage: run.stage,
                status: run.status,
                active_tools: run.activeTools.map((tool) => ({
                  tool_name: tool.toolName,
                  status: tool.status,
                  summary: tool.summary,
                  started_at: tool.startedAt,
                  attempt: tool.attempt,
                })),
                updated_at: run.updatedAt,
              })),
              recent_activity: data.recentActivity.map((event) => ({
                event_id: event.eventId,
                sequence: event.sequence,
                emitted_at: event.emittedAt,
                organization_id: event.organizationId,
                assessment_id: event.assessmentId,
                run_id: event.runId,
                correlation_id: event.correlationId,
                event_type: event.eventType,
                run_status: event.runStatus,
                stage: event.stage,
                tool_name: event.toolName,
                summary: event.summary,
                input_summary: event.inputSummary,
                output_summary: event.outputSummary,
                error_summary: event.errorSummary,
                started_at: event.startedAt,
                completed_at: event.completedAt,
                duration_ms: event.durationMs,
                attempt: event.attempt,
                waiting_reason: event.waitingReason,
              })),
              repository_snapshots: data.repositorySnapshots.map(
                toLegacyRepositorySnapshotPayload,
              ),
              scan_jobs: data.scanJobs.map(toLegacyScanJobPayload),
              evidence_reports: data.evidenceReports.map(
                toLegacyEvidenceReportPayload,
              ),
            },
          })),
          catchError((error) => {
            this.logger.warn(
              `Workspace runtime snapshot failed; keeping SSE stream open: ${snapshotFailureReason(error)}`,
            );
            return EMPTY;
          }),
        ),
      ),
    );
  }
}

function snapshotFailureReason(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "unknown runtime snapshot error";
}

/**
 * Projects a repository snapshot into the legacy SSE payload shape retained for workspace clients.
 *
 * @param snapshot - Runtime repository-snapshot record to serialize.
 * @returns Legacy snake_case repository-snapshot payload.
 */
function toLegacyRepositorySnapshotPayload(snapshot: unknown) {
  const item = snapshot as Record<string, unknown>;
  return {
    id: item.id,
    assessment_id: item.assessmentId,
    commit_sha: item.commitSha,
    created_at:
      item.createdAt instanceof Date
        ? item.createdAt.toISOString()
        : item.createdAt,
  };
}

/**
 * Projects the current scan-job record into the legacy SSE payload shape retained for workspace clients.
 *
 * @param scanJob - Runtime scan-job record to serialize.
 * @returns Legacy snake_case scan-job payload.
 */
function toLegacyScanJobPayload(scanJob: unknown) {
  const item = scanJob as Record<string, unknown>;
  return {
    id: item.id,
    assessment_id: item.assessmentId,
    snapshot_id: item.snapshotId,
    status: item.status,
    attempt_count: item.attemptCount,
    blocked_reason: item.blockedReason ?? null,
    updated_at:
      item.updatedAt instanceof Date
        ? item.updatedAt.toISOString()
        : item.updatedAt,
  };
}

/**
 * Projects a technical evidence report into the legacy SSE payload shape retained for workspace clients.
 *
 * @param report - Runtime evidence-report record to serialize.
 * @returns Legacy snake_case evidence-report payload.
 */
function toLegacyEvidenceReportPayload(report: unknown) {
  const item = report as Record<string, unknown>;
  return {
    id: item.id,
    assessment_id: item.assessmentId,
    scan_job_id: item.scanJobId,
    snapshot_id: item.snapshotId,
    status: item.status,
    rejection_reason: item.rejectionReason ?? null,
    created_at:
      item.createdAt instanceof Date
        ? item.createdAt.toISOString()
        : item.createdAt,
  };
}
