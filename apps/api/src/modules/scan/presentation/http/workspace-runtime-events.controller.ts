import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type {
  AssessmentAgentStreamEvent,
  AssessmentDetectedPullRequest,
  AssessmentPostFindingRuntimeState,
} from "@lcsp/contracts/evidence";
import type { MessageEvent } from "@nestjs/common";
import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  EMPTY,
  catchError,
  defer,
  exhaustMap,
  interval,
  map,
  merge,
  startWith,
} from "rxjs";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";

/**
 * Streams orchestration runtime snapshots to authorized workspace clients over Server-Sent Events.
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
   * Emits an immediate workspace runtime snapshot and refreshes it every two seconds.
   *
   * @param request - Authenticated request containing the RBAC context.
   * @returns RxJS stream of `workspace.runtime` SSE messages.
   */
  @Sse()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  stream(
    @Req() request: AuthenticatedRequest,
    @Query("assessment_id") assessmentId?: string,
    @Query("agent_stream_only") agentStreamOnly?: string,
  ) {
    const rbacContext = request.rbacContext;
    const ownerId =
      rbacContext.role === AUTH_USER_ROLES.customer
        ? rbacContext.userId
        : `no-assessment-owner:${rbacContext.userId}`;
    const snapshots = interval(2_000).pipe(
      startWith(0),
      exhaustMap(() =>
        defer(() => this.runtimeEvents.buildWorkspaceSnapshot(ownerId)).pipe(
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
              engineering_progress: data.engineeringProgress.map(
                (progress) => ({
                  assessment_id: progress.assessmentId,
                  run_id: progress.runId,
                  planning_batch_id: progress.planningBatchId,
                  context_revision_used: progress.contextRevisionUsed,
                  targeted: progress.targeted,
                  approximate: progress.approximate,
                  planner: {
                    candidate_count: progress.planner.candidateCount,
                    selected_count: progress.planner.selectedCount,
                    skipped_count: progress.planner.skippedCount,
                  },
                  investigator: {
                    selected_count: progress.investigator.selectedCount,
                    completed_count: progress.investigator.completedCount,
                    domain_limited_count:
                      progress.investigator.domainLimitedCount,
                    limited_or_failed_count:
                      progress.investigator.limitedOrFailedCount,
                    waiting_for_input_count:
                      progress.investigator.waitingForInputCount,
                    runtime_failed_count:
                      progress.investigator.runtimeFailedCount,
                    pending_count: progress.investigator.pendingCount,
                  },
                }),
              ),
              repository_snapshots: data.repositorySnapshots.map(
                toLegacyRepositorySnapshotPayload,
              ),
              scan_jobs: data.scanJobs.map(toLegacyScanJobPayload),
              evidence_reports: data.evidenceReports.map(
                toLegacyEvidenceReportPayload,
              ),
              post_finding: data.postFindingStates.map(
                toPostFindingRuntimePayload,
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
    const agentStream =
      this.runtimeEvents
        .observeAgentStreamEvents?.(ownerId, {
          assessmentId: assessmentId?.trim() ? assessmentId : null,
        })
        .pipe(
          map((event): MessageEvent => ({
            id: event.eventId,
            type: "workspace.agent-stream",
            data: toAgentStreamPayload(event),
          })),
        ) ?? EMPTY;
    return agentStreamOnly === "1"
      ? agentStream
      : merge(snapshots, agentStream);
  }

  @Get("agent-stream-history")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async agentStreamHistory(
    @Req() request: AuthenticatedRequest,
    @Query("assessment_id") assessmentId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const rbacContext = request.rbacContext;
    const ownerId =
      rbacContext.role === AUTH_USER_ROLES.customer
        ? rbacContext.userId
        : `no-assessment-owner:${rbacContext.userId}`;
    const page = await this.runtimeEvents.getAgentStreamHistoryPage(
      ownerId,
      assessmentId?.trim() ?? "",
      {
        cursor: cursor?.trim() ? cursor.trim() : null,
        limit: limit === undefined ? null : Number(limit),
      },
    );
    return resultEnvelope({
      events: page.events.map(toAgentStreamPayload),
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
    });
  }
}

function toAgentStreamPayload(event: AssessmentAgentStreamEvent) {
  return {
    event_id: event.eventId,
    sequence: event.sequence,
    client_sequence: event.clientSequence,
    emitted_at: event.emittedAt,
    assessment_id: event.assessmentId,
    run_id: event.runId,
    correlation_id: event.correlationId,
    event_type: event.eventType,
    source: event.source,
    agent_name: event.agentName,
    subagent_name: event.subagentName,
    namespace: event.namespace,
    node_name: event.nodeName,
    message_id: event.messageId,
    tool_name: event.toolName,
    tool_call_id: event.toolCallId,
    status: event.status,
    text: event.text,
    data: event.data,
  };
}

function toPostFindingRuntimePayload(state: AssessmentPostFindingRuntimeState) {
  return {
    assessment_id: state.assessmentId,
    phase: state.phase,
    code_review_activities: state.codeReviewActivities,
    decision_availability: state.decisionAvailability,
    selected_decision: state.selectedDecision ?? null,
    selected_decision_at: state.selectedDecisionAt ?? null,
    detected_pull_request: toPostFindingPullRequestPayload(
      state.detectedPullRequest,
    ),
    created_pull_request: toPostFindingPullRequestPayload(
      state.createdPullRequest,
    ),
    approval_status: state.approvalStatus,
    approved_patch_version: state.approvedPatchVersion ?? null,
    verification_activities: state.verificationActivities,
    verification_status: state.verificationStatus ?? null,
    final_result: state.finalResult ?? null,
    can_continue_remediation: state.canContinueRemediation ?? false,
    artifacts: {
      remediation_patch_resource_id:
        state.artifacts?.remediationPatchResourceId ?? null,
      verification_report_resource_id:
        state.artifacts?.verificationReportResourceId ?? null,
      final_report_resource_id: state.artifacts?.finalReportResourceId ?? null,
    },
  };
}

function toPostFindingPullRequestPayload(
  pullRequest: AssessmentDetectedPullRequest | undefined,
) {
  if (!pullRequest) {
    return null;
  }
  return {
    number: pullRequest.number,
    url: pullRequest.url ?? null,
    branch: pullRequest.branch,
    patch_version: pullRequest.patchVersion,
  };
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
    provider: item.provider,
    repository_full_name: item.repositoryFullName,
    branch: item.branch ?? null,
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
