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
import { ProgramEvidenceGraphDetailService } from "../../application/services/evidence/program-evidence-graph-detail.service.js";
import { toPrismaEvidenceAcceptanceStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";

@Controller("assessments")
export class EvidenceController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly prisma: PrismaService,
    private readonly graphDetail: ProgramEvidenceGraphDetailService,
  ) {}

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
        evidencePayload: true,
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
      throw new NotFoundException("Technical evidence not found");
    }
    return resultEnvelope(
      await this.graphDetail.project({ report, snapshot: report.snapshot }),
    );
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
