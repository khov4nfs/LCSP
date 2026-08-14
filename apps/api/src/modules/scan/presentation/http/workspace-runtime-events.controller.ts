import { Controller, Req, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { interval, map, startWith, switchMap } from "rxjs";

import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import type { PbacRequestContext } from "../../../../platform/pbac/interfaces/pbac-request.interface.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";

interface WorkspaceRuntimeRequest {
  pbacContext: PbacRequestContext;
}

@Controller("workspace/runtime-events")
export class WorkspaceRuntimeEventsController {
  constructor(private readonly runtimeEvents: AssessmentRuntimeEventService) {}

  @Sse()
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.workspaceRead)
  stream(@Req() request: WorkspaceRuntimeRequest) {
    const organizationId = request.pbacContext.organizationId;

    return interval(2_000).pipe(
      startWith(0),
      switchMap(async () =>
        this.runtimeEvents.buildWorkspaceSnapshot(organizationId),
      ),
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
          scan_jobs: data.scanJobs.map(toLegacyScanJobPayload),
          evidence_reports: data.evidenceReports.map(
            toLegacyEvidenceReportPayload,
          ),
        },
      })),
    );
  }
}

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
