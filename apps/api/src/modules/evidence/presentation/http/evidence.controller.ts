import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { isRecord } from "../../../../common/utils/index.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { AcceptTechnicalProfileCommand } from "../../application/commands/accept-technical-profile/accept-technical-profile.command.js";
import type { TechnicalProfileCallbackRequest } from "../../application/contracts/evidence/technical-profile-callback.contract.js";
import { GetEvidenceQuery } from "../../application/queries/get-evidence/get-evidence.query.js";
import { AssessmentArtifactProjectionService } from "../../application/services/evidence/assessment-artifact-projection.service.js";
import { ProgramEvidenceGraphDetailService } from "../../application/services/evidence/program-evidence-graph-detail.service.js";
import {
  fromPrismaRepositoryScanJobStatus,
  toPrismaEvidenceAcceptanceStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";

const FAILED_EVIDENCE_GRAPH_SCAN_STATUSES = new Set<string>([
  REPOSITORY_SCAN_JOB_STATUSES.failed,
  REPOSITORY_SCAN_JOB_STATUSES.blocked,
  REPOSITORY_SCAN_JOB_STATUSES.blockedMapping,
]);

@Controller("assessments")
export class EvidenceController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly prisma: PrismaService,
    private readonly graphDetail: ProgramEvidenceGraphDetailService,
    private readonly artifacts: AssessmentArtifactProjectionService,
  ) {}

  @Get(":assessmentId/artifacts")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getArtifacts(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.assertAssessmentArtifactAccess(assessmentId, request);
    return resultEnvelope(await this.artifacts.getAvailability(assessmentId));
  }

  @Get(":assessmentId/artifacts/business-context")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getBusinessContextArtifact(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.assertAssessmentArtifactAccess(assessmentId, request);
    return resultEnvelope(
      await this.artifacts.getBusinessContext(assessmentId),
    );
  }

  @Get(":assessmentId/artifacts/investigation-notes")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getInvestigationNotesArtifact(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.assertAssessmentArtifactAccess(assessmentId, request);
    return resultEnvelope(
      await this.artifacts.getInvestigationNotes(assessmentId),
    );
  }

  /**
   * Return the persisted evidence/report view only.
   */
  @Get(":assessmentId/evidence")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getEvidence(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.rbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetEvidenceQuery(
          assessmentId,
          context.role,
          request.correlationId as string,
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-graph")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getEvidenceGraph(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.rbacContext;
    if (context.role !== AUTH_USER_ROLES.admin) {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { ownerId: true },
      });
      if (!assessment || assessment.ownerId !== context.userId) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          request.correlationId ?? randomUUID(),
          { status: HttpStatus.NOT_FOUND },
        );
      }
    }
    const report = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        assessmentId,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        ),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        assessmentId: true,
        scanJobId: true,
        snapshotId: true,
        createdAt: true,
        snapshot: {
          select: {
            repositoryFullName: true,
            branch: true,
            ref: true,
            commitSha: true,
            status: true,
          },
        },
      },
    });
    if (!report) {
      throw await this.unavailableEvidenceGraphProblem(
        assessmentId,
        request.correlationId ?? randomUUID(),
      );
    }
    return resultEnvelope(
      await this.graphDetail.projectAcceptedReport({
        report,
        snapshot: report.snapshot,
        loadEvidencePayload: async () =>
          (
            await this.prisma.technicalEvidenceReport.findUnique({
              where: { id: report.id },
              select: { evidencePayload: true },
            })
          )?.evidencePayload ?? null,
      }),
    );
  }

  @Get(":assessmentId/evidence-graph/overview")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getEvidenceGraphOverview(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.rbacContext;
    if (context.role !== AUTH_USER_ROLES.admin) {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: { ownerId: true },
      });
      if (!assessment || assessment.ownerId !== context.userId) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          request.correlationId ?? randomUUID(),
          { status: HttpStatus.NOT_FOUND },
        );
      }
    }
    const report = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        assessmentId,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        ),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { evidencePayload: true },
    });
    if (!report) {
      throw await this.unavailableEvidenceGraphProblem(
        assessmentId,
        request.correlationId ?? randomUUID(),
      );
    }
    return resultEnvelope(
      this.graphDetail.projectOverview(report.evidencePayload),
    );
  }

  /**
   * Distinguishes why no accepted graph exists: still building (NOT_READY), the
   * latest scan or its evidence report failed (BUILD_FAILED), or nothing was ever
   * started for this assessment (NOT_FOUND).
   */
  private async unavailableEvidenceGraphProblem(
    assessmentId: string,
    correlationId: string,
  ) {
    const latestScanJob = await this.prisma.repositoryScanJob.findFirst({
      where: { assessmentId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true },
    });
    if (!latestScanJob) {
      return problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    const scanStatus = fromPrismaRepositoryScanJobStatus(latestScanJob.status);
    const meta = { scanJobId: latestScanJob.id, scanStatus };
    if (FAILED_EVIDENCE_GRAPH_SCAN_STATUSES.has(scanStatus)) {
      return problemException(EVIDENCE_ERROR_CODES.buildFailed, correlationId, {
        status: HttpStatus.CONFLICT,
        meta,
      });
    }
    if (scanStatus === REPOSITORY_SCAN_JOB_STATUSES.completed) {
      const rejectedReport =
        await this.prisma.technicalEvidenceReport.findFirst({
          where: {
            scanJobId: latestScanJob.id,
            status: toPrismaEvidenceAcceptanceStatus(
              TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected,
            ),
          },
          select: { id: true },
        });
      if (rejectedReport) {
        return problemException(
          EVIDENCE_ERROR_CODES.buildFailed,
          correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta,
          },
        );
      }
    }
    // Active scans, and completed scans whose report acceptance is still pending.
    return problemException(EVIDENCE_ERROR_CODES.notReady, correlationId, {
      status: HttpStatus.ACCEPTED,
      meta,
    });
  }

  private async assertAssessmentArtifactAccess(
    assessmentId: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    const context = request.rbacContext;
    if (context.role === AUTH_USER_ROLES.admin) return;
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { ownerId: true },
    });
    if (!assessment || assessment.ownerId !== context.userId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        request.correlationId ?? randomUUID(),
        { status: HttpStatus.NOT_FOUND },
      );
    }
  }
}

@Controller("internal/evidence")
export class InternalEvidenceController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

  @Post("technical-profile-callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async acceptTechnicalProfile(
    @Body() payload: TechnicalProfileCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptTechnicalProfileCommand(
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }

  @Get("reports/:evidenceReportId")
  @UseGuards(WorkerApiKeyGuard)
  async getTechnicalEvidenceReport(
    @Param("evidenceReportId") evidenceReportId: string,
  ) {
    const report = await this.prisma.technicalEvidenceReport.findUnique({
      where: { id: evidenceReportId },
      select: {
        id: true,
        scanJobId: true,
        assessmentId: true,
        snapshotId: true,
        toolsVersion: true,
        configHash: true,
        evidencePayload: true,
        privacyFlags: true,
        schemaVersion: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
    if (!report) {
      throw new NotFoundException("TechnicalEvidenceReport not found");
    }
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: report.assessmentId },
      select: { ownerId: true },
    });
    if (!assessment) {
      throw new NotFoundException(
        "Assessment not found for TechnicalEvidenceReport",
      );
    }

    return {
      id: report.id,
      scan_job_id: report.scanJobId,
      assessment_id: report.assessmentId,
      user_id: assessment.ownerId,
      snapshot_id: report.snapshotId,
      tools_version: report.toolsVersion,
      config_hash: report.configHash,
      evidence_payload: report.evidencePayload,
      privacy_flags: report.privacyFlags,
      schema_version: report.schemaVersion,
      status: String(report.status).toLowerCase(),
      rejection_reason: report.rejectionReason,
      created_at: report.createdAt.toISOString(),
    };
  }

  @Get("technical-profiles/:technicalProfileId")
  @UseGuards(WorkerApiKeyGuard)
  async getTechnicalProfile(
    @Param("technicalProfileId") technicalProfileId: string,
  ) {
    const profile = await this.prisma.technicalProfile.findUnique({
      where: { id: technicalProfileId },
      select: {
        id: true,
        evidenceReportId: true,
        assessmentId: true,
        schemaVersion: true,
        providerVersion: true,
        profileData: true,
        privacyFlags: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
    if (!profile) {
      throw new NotFoundException("TechnicalProfile not found");
    }

    const profileData = isRecord(profile.profileData)
      ? profile.profileData
      : {};
    return {
      ...profileData,
      id: profile.id,
      technical_profile_id: profile.id,
      evidence_report_id: profile.evidenceReportId,
      assessment_id: profile.assessmentId,
      schema_version: profile.schemaVersion,
      provider_version: profile.providerVersion,
      privacy_flags: profile.privacyFlags,
      status: String(profile.status).toLowerCase(),
      rejection_reason: profile.rejectionReason,
      created_at: profile.createdAt.toISOString(),
    };
  }
}
