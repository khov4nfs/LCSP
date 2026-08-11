import { Controller, Req, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { interval, map, startWith, switchMap } from "rxjs";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import type { PbacRequestContext } from "../../../../platform/pbac/interfaces/pbac-request.interface.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";

interface WorkspaceRuntimeRequest {
  pbacContext: PbacRequestContext;
}

@Controller("workspace/runtime-events")
export class WorkspaceRuntimeEventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Sse()
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.workspaceRead)
  stream(@Req() request: WorkspaceRuntimeRequest) {
    const organizationId = request.pbacContext.organizationId;

    return interval(2_000).pipe(
      startWith(0),
      switchMap(async () => {
        const [scanJobs, evidenceReports] = await Promise.all([
          this.prisma.repositoryScanJob.findMany({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            take: 50,
            select: {
              id: true,
              assessmentId: true,
              snapshotId: true,
              status: true,
              attemptCount: true,
              blockedReason: true,
              updatedAt: true,
            },
          }),
          this.prisma.technicalEvidenceReport.findMany({
            where: { organizationId },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
              id: true,
              assessmentId: true,
              scanJobId: true,
              snapshotId: true,
              status: true,
              rejectionReason: true,
              createdAt: true,
            },
          }),
        ]);

        return {
          emitted_at: new Date().toISOString(),
          scan_jobs: scanJobs.map((scanJob) => ({
            id: scanJob.id,
            assessment_id: scanJob.assessmentId,
            snapshot_id: scanJob.snapshotId,
            status: scanJob.status,
            attempt_count: scanJob.attemptCount,
            blocked_reason: scanJob.blockedReason,
            updated_at: scanJob.updatedAt.toISOString(),
          })),
          evidence_reports: evidenceReports.map((report) => ({
            id: report.id,
            assessment_id: report.assessmentId,
            scan_job_id: report.scanJobId,
            snapshot_id: report.snapshotId,
            status: report.status,
            rejection_reason: report.rejectionReason,
            created_at: report.createdAt.toISOString(),
          })),
        };
      }),
      map((data): MessageEvent => ({
        type: "workspace.runtime",
        data,
      })),
    );
  }
}
