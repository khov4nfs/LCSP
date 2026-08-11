import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
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
import {
  ARTIFACT_CHAIN_STAGES,
  type ArtifactChainStage,
} from "@lcsp/contracts/evidence";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { AcceptConflictCommand } from "../../application/commands/accept-conflict/accept-conflict.command.js";
import { AcceptVerifiedProfileCommand } from "../../application/commands/accept-verified-profile/accept-verified-profile.command.js";
import { ApproveVerifiedProfileCommand } from "../../application/commands/approve-verified-profile/approve-verified-profile.command.js";
import { ResolveConflictCommand } from "../../application/commands/resolve-conflict/resolve-conflict.command.js";
import type { ConflictDetectionCallbackRequest } from "../../application/contracts/reconciliation/conflict-detection-callback.contract.js";
import type { VerifiedProfileCallbackRequest } from "../../application/contracts/reconciliation/verified-profile-callback.contract.js";
import { ListConflictsQuery } from "../../application/queries/list-conflicts/list-conflicts.query.js";
import { GetVerifiedProfileByIdQuery } from "../../application/queries/get-verified-profile-by-id/get-verified-profile-by-id.query.js";
import { GetArtifactChainQuery } from "../../application/queries/get-artifact-chain/get-artifact-chain.query.js";
import { GetReconciliationContextQuery } from "../../application/queries/get-reconciliation-context/get-reconciliation-context.query.js";
import { ProposeMissingTargetsQuery } from "../../application/queries/propose-missing-targets/propose-missing-targets.query.js";
import {
  RECONCILIATION_CONTEXT_STATUSES,
  type ReconciliationContextStatus,
} from "../../application/contracts/reconciliation/reconciliation-context.contract.js";
import { TARGET_CANDIDATE_KINDS } from "../../application/contracts/missing-target-proposal.contract.js";

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

  @Get(":assessmentId/artifact-chain")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.assessmentRead)
  async getArtifactChain(
    @Param("assessmentId") assessmentId: string,
    @Query("required_stages") requiredStagesRaw: string | undefined,
    @Query("exact_versions") exactVersionsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;
    const requiredStages = parseArtifactChainStages(
      requiredStagesRaw,
      request.correlationId as string,
    );

    return resultEnvelope(
      await this.queryBus.execute(
        new GetArtifactChainQuery(
          assessmentId,
          pbacContext.organizationId,
          request.correlationId as string,
          requiredStages,
          exactVersionsRaw === "true",
        ),
      ),
    );
  }

  @Get(":assessmentId/reconciliation-context")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.conflictRead)
  async getReconciliationContext(
    @Param("assessmentId") assessmentId: string,
    @Query("flow_ref") flowRef: string | undefined,
    @Query("statuses") statusesRaw: string | undefined,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;
    const correlationId = request.correlationId as string;
    const flowId = parseFlowRef(flowRef, correlationId);
    const statuses = parseReconciliationStatuses(statusesRaw, correlationId);
    const maxResults = parseMaxResults(maxResultsRaw, correlationId);

    return resultEnvelope(
      await this.queryBus.execute(
        new GetReconciliationContextQuery(
          assessmentId,
          pbacContext.organizationId,
          correlationId,
          flowId,
          maxResults,
          statuses,
        ),
      ),
    );
  }

  @Get(":assessmentId/missing-targets")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.assessmentRead)
  async proposeMissingTargets(
    @Param("assessmentId") assessmentId: string,
    @Query("wizard_profile_id") wizardProfileId: string,
    @Query("evidence_report_id") evidenceReportId: string,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new ProposeMissingTargetsQuery(
          assessmentId,
          request.pbacContext.organizationId,
          wizardProfileId,
          evidenceReportId,
          [TARGET_CANDIDATE_KINDS.providerUsage],
          maxResultsRaw ? Number(maxResultsRaw) : 25,
          correlationId,
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

function parseArtifactChainStages(
  value: string | undefined,
  correlationId: string,
): ArtifactChainStage[] {
  if (!value) return [];

  const allowed = new Set(Object.values(ARTIFACT_CHAIN_STAGES));
  const stages = value
    .split(",")
    .map((stage) => stage.trim()) as ArtifactChainStage[];
  if (stages.some((stage) => !allowed.has(stage))) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      },
    );
  }

  return stages;
}

function parseFlowRef(
  value: string | undefined,
  correlationId: string,
): string {
  if (!value?.startsWith("flow:")) {
    throwInvalidRequest(correlationId);
  }
  return value.slice("flow:".length);
}

function parseReconciliationStatuses(
  value: string | undefined,
  correlationId: string,
): ReconciliationContextStatus[] {
  if (!value) return [];
  const allowed = new Set(Object.values(RECONCILIATION_CONTEXT_STATUSES));
  const statuses = value
    .split(",")
    .map((status) => status.trim()) as ReconciliationContextStatus[];
  if (statuses.some((status) => !allowed.has(status))) {
    throwInvalidRequest(correlationId);
  }
  return statuses;
}

function parseMaxResults(
  value: string | undefined,
  correlationId: string,
): number {
  const maxResults = Number(value);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
    throwInvalidRequest(correlationId);
  }
  return maxResults;
}

function throwInvalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
