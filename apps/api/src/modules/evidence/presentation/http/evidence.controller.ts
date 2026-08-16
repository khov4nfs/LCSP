import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RequireAnyAction } from "../../../../platform/pbac/decorators/require-any-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { AcceptTechnicalProfileCommand } from "../../application/commands/accept-technical-profile/accept-technical-profile.command.js";
import type { TechnicalProfileCallbackRequest } from "../../application/contracts/evidence/technical-profile-callback.contract.js";
import { GetEvidenceQuery } from "../../application/queries/get-evidence/get-evidence.query.js";

@Controller("assessments")
export class EvidenceController {
  constructor(private readonly queryBus: QueryBus) {}

  /**
   * Return the persisted evidence/report view only.
   *
   * Technical graph search, traversal, provider discovery, decision/data-path
   * inspection and remediation processing are Python-worker capabilities. The old
   * NestJS HTTP/CQRS analysis surface was removed so there is one processing owner.
   */
  @Get(":assessmentId/evidence")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async getEvidence(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.pbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetEvidenceQuery(
          assessmentId,
          context.organizationId,
          context.scope,
          context.selectedAction,
          request.correlationId as string,
        ),
      ),
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
        organizationId: true,
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

    return {
      id: report.id,
      scan_job_id: report.scanJobId,
      assessment_id: report.assessmentId,
      organization_id: report.organizationId,
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
        organizationId: true,
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
      organization_id: profile.organizationId,
      schema_version: profile.schemaVersion,
      provider_version: profile.providerVersion,
      privacy_flags: profile.privacyFlags,
      status: String(profile.status).toLowerCase(),
      rejection_reason: profile.rejectionReason,
      created_at: profile.createdAt.toISOString(),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
