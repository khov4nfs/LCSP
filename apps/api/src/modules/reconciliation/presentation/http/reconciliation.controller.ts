import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { AI_USAGE_FLOW_STATUSES } from "@lcsp/contracts/scan";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { AcceptConflictCommand } from "../../application/commands/accept-conflict/accept-conflict.command.js";
import { AcceptVerifiedProfileCommand } from "../../application/commands/accept-verified-profile/accept-verified-profile.command.js";
import { ApproveVerifiedProfileCommand } from "../../application/commands/approve-verified-profile/approve-verified-profile.command.js";
import { ResolveConflictCommand } from "../../application/commands/resolve-conflict/resolve-conflict.command.js";
import type { ConflictDetectionCallbackRequest } from "../../application/contracts/reconciliation/conflict-detection-callback.contract.js";
import type { VerifiedProfileCallbackRequest } from "../../application/contracts/reconciliation/verified-profile-callback.contract.js";
import { ListConflictsQuery } from "../../application/queries/list-conflicts/list-conflicts.query.js";
import { GetVerifiedProfileByIdQuery } from "../../application/queries/get-verified-profile-by-id/get-verified-profile-by-id.query.js";

type ResolveConflictRequest = {
  resolution?: unknown;
  resolution_note?: unknown;
};

@Controller("internal/reconciliation")
export class InternalReconciliationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly prisma: PrismaService,
  ) {}

  @Post("conflict-callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async acceptConflictDetection(
    @Body() payload: ConflictDetectionCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptConflictCommand(
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }

  @Post("verified-profile-callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async acceptVerifiedProfile(
    @Body() payload: VerifiedProfileCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptVerifiedProfileCommand(
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }

  @Get("verified-profiles/:verifiedProfileId")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async getVerifiedProfileById(
    @Param("verifiedProfileId") verifiedProfileId: string,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetVerifiedProfileByIdQuery(verifiedProfileId),
      ),
    );
  }

  @Get("verified-profile-context/:assessmentId")
  @UseGuards(WorkerApiKeyGuard)
  async getVerifiedProfileContext(
    @Param("assessmentId") assessmentId: string,
    @Query("ai_usage_flow_id") aiUsageFlowId?: string,
  ) {
    const aiUsageFlow = await this.prisma.aIUsageFlow.findFirst({
      where: {
        assessmentId,
        ...(aiUsageFlowId ? { id: aiUsageFlowId } : {}),
        status: AI_USAGE_FLOW_STATUSES.accepted,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
        schemaVersion: true,
        providerVersion: true,
        claims: true,
        unknownUsages: true,
        privacyFlags: true,
        status: true,
        createdAt: true,
      },
    });

    if (!aiUsageFlow) {
      throw new NotFoundException("Accepted AI usage flow not found");
    }

    const [conflicts, wizardProfile] = await Promise.all([
      this.prisma.conflictRecord.findMany({
        where: { aiUsageFlowId: aiUsageFlow.id, assessmentId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          conflictType: true,
          status: true,
          resolvedAt: true,
          evidenceRefs: true,
        },
      }),
      this.prisma.wizardProfile.findUnique({
        where: { assessmentId },
        select: { id: true, assessmentId: true, version: true, answers: true },
      }),
    ]);

    return resultEnvelope({
      ai_usage_flow: {
        id: aiUsageFlow.id,
        ai_usage_flow_id: aiUsageFlow.id,
        assessment_id: aiUsageFlow.assessmentId,
        organization_id: aiUsageFlow.organizationId,
        schema_version: aiUsageFlow.schemaVersion,
        provider_version: aiUsageFlow.providerVersion,
        claims: aiUsageFlow.claims,
        unknown_usages: aiUsageFlow.unknownUsages,
        privacy_flags: aiUsageFlow.privacyFlags,
        status: AI_USAGE_FLOW_STATUSES.accepted.toLowerCase(),
        created_at: aiUsageFlow.createdAt.toISOString(),
      },
      conflicts: conflicts.map((conflict) => ({
        conflict_id: conflict.id,
        conflict_type: conflict.conflictType,
        status: conflict.status,
        resolved_at: conflict.resolvedAt?.toISOString() ?? null,
        evidence_refs: conflict.evidenceRefs,
      })),
      wizard_profile: wizardProfile
        ? {
            id: wizardProfile.id,
            assessment_id: wizardProfile.assessmentId,
            version: wizardProfile.version,
            answers: wizardProfile.answers,
          }
        : null,
    });
  }
}

@Controller("assessments")
export class ReconciliationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(":assessmentId/conflicts")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.conflictRead)
  async listConflicts(
    @Param("assessmentId") assessmentId: string,
    @Query("status") status: string | undefined,
    @Query("page") page: string | undefined,
    @Query("page_size") pageSize: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;

    return resultEnvelope(
      await this.queryBus.execute(
        new ListConflictsQuery(
          assessmentId,
          pbacContext.organizationId,
          pbacContext.userId,
          pbacContext.subjectRole,
          page !== undefined ? Number(page) : undefined,
          pageSize !== undefined ? Number(pageSize) : undefined,
          status,
          request.correlationId as string,
        ),
      ),
    );
  }

  @Patch(":assessmentId/conflicts/:conflictId/resolve")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.conflictResolve)
  async resolveConflict(
    @Param("assessmentId") assessmentId: string,
    @Param("conflictId") conflictId: string,
    @Body() body: ResolveConflictRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;

    return resultEnvelope(
      await this.commandBus.execute(
        new ResolveConflictCommand(
          assessmentId,
          conflictId,
          pbacContext.organizationId,
          pbacContext.userId,
          pbacContext.subjectRole,
          body.resolution,
          body.resolution_note,
          request.correlationId as string,
          {
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
        ),
      ),
    );
  }

  @Post(":assessmentId/verified-profiles/:verifiedProfileId/approve")
  @HttpCode(200)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.verifiedProfileApprove)
  async approveVerifiedProfile(
    @Param("assessmentId") assessmentId: string,
    @Param("verifiedProfileId") verifiedProfileId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;

    return resultEnvelope(
      await this.commandBus.execute(
        new ApproveVerifiedProfileCommand(
          assessmentId,
          verifiedProfileId,
          pbacContext.organizationId,
          pbacContext.userId,
          pbacContext.subjectRole,
          request.correlationId as string,
          {
            selectedAction: pbacContext.selectedAction,
            policyId: pbacContext.policyId,
            policyVersion: pbacContext.policyVersion,
          },
        ),
      ),
    );
  }
}
