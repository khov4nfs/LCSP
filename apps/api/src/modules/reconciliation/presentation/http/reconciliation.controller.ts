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
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  VERIFIED_PROFILE_REQUIRED_FOR,
  type ArtifactChainStage,
  type AssessmentContextAnswerField,
  type AssessmentContextInclude,
  type VerifiedProfileRequiredFor,
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
import { ReconcileProfileToVerifiedProfileCommand } from "../../application/commands/reconcile-profile-to-verified-profile/reconcile-profile-to-verified-profile.command.js";
import type { ConflictDetectionCallbackRequest } from "../../application/contracts/reconciliation/conflict-detection-callback.contract.js";
import type { VerifiedProfileCallbackRequest } from "../../application/contracts/reconciliation/verified-profile-callback.contract.js";
import { ListConflictsQuery } from "../../application/queries/list-conflicts/list-conflicts.query.js";
import { GetVerifiedProfileByIdQuery } from "../../application/queries/get-verified-profile-by-id/get-verified-profile-by-id.query.js";
import { GetVerifiedProfileQuery } from "../../application/queries/get-verified-profile/get-verified-profile.query.js";
import { GetArtifactChainQuery } from "../../application/queries/get-artifact-chain/get-artifact-chain.query.js";
import { GetAssessmentContextQuery } from "../../application/queries/get-assessment-context/get-assessment-context.query.js";
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
    const resolvedCorrelationId = correlationId?.trim() || randomUUID();
    if (isAgenticReconciliationCallback(payload)) {
      return resultEnvelope(
        await this.commandBus.execute(
          new ReconcileProfileToVerifiedProfileCommand(
            {
              assessmentId: payload.assessment_id,
              wizardProfileId: payload.wizard_profile_id,
              technicalEvidenceReportId: payload.technical_evidence_report_id,
              aiUsageFlowId: payload.ai_usage_flow_id,
              reconciliationDecisionRefs: payload.reconciliation_decision_refs,
              idempotencyKey: payload.idempotency_key,
            },
            payload.organization_id,
            resolvedCorrelationId,
          ),
        ),
      );
    }
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptVerifiedProfileCommand(payload, resolvedCorrelationId),
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
        technicalProfileId: true,
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

    const [conflicts, wizardProfile, technicalProfile] = await Promise.all([
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
      this.prisma.technicalProfile.findFirst({
        where: {
          id: aiUsageFlow.technicalProfileId,
          assessmentId,
          organizationId: aiUsageFlow.organizationId,
        },
        select: { evidenceReportId: true },
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
      technical_evidence_report_id: technicalProfile?.evidenceReportId ?? null,
    });
  }
}

function isAgenticReconciliationCallback(
  payload: VerifiedProfileCallbackRequest,
): payload is VerifiedProfileCallbackRequest & {
  wizard_profile_id: string;
  technical_evidence_report_id: string;
  reconciliation_decision_refs: string[];
  idempotency_key: string;
  organization_id: string;
} {
  return (
    typeof payload.wizard_profile_id === "string" &&
    typeof payload.technical_evidence_report_id === "string" &&
    Array.isArray(payload.reconciliation_decision_refs) &&
    typeof payload.idempotency_key === "string" &&
    typeof payload.organization_id === "string"
  );
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
    @Query("candidate_kinds") candidateKindsRaw: string | undefined,
    @Query("seed_refs") seedRefsRaw: string | undefined,
    @Query("exclude_target_ids") excludeTargetIdsRaw: string | undefined,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    const candidateKinds = parseTargetCandidateKinds(
      candidateKindsRaw,
      correlationId,
    );
    const seedRefs = parseSeedRefs(seedRefsRaw, correlationId);
    const excludeTargetIds = parseTargetIds(excludeTargetIdsRaw, correlationId);
    const maxResults = parseProposalMaxResults(maxResultsRaw, correlationId);

    return resultEnvelope(
      await this.queryBus.execute(
        new ProposeMissingTargetsQuery(
          assessmentId,
          request.pbacContext.organizationId,
          wizardProfileId,
          evidenceReportId,
          candidateKinds,
          seedRefs,
          excludeTargetIds,
          maxResults,
          correlationId,
        ),
      ),
    );
  }

  @Get(":assessmentId/assessment-context")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.assessmentRead)
  async getAssessmentContext(
    @Param("assessmentId") assessmentId: string,
    @Query("wizard_profile_id") wizardProfileId: string,
    @Query("include") includeRaw: string | undefined,
    @Query("answer_fields") answerFieldsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    const includes = parseAssessmentContextIncludes(includeRaw, correlationId);
    const answerFields = parseAssessmentContextAnswerFields(
      answerFieldsRaw,
      correlationId,
    );

    return resultEnvelope(
      await this.queryBus.execute(
        new GetAssessmentContextQuery(
          assessmentId,
          request.pbacContext.organizationId,
          wizardProfileId,
          includes,
          answerFields,
          correlationId,
        ),
      ),
    );
  }

  @Get(":assessmentId/verified-profiles/:verifiedProfileId")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.verifiedProfileRead)
  async getVerifiedProfile(
    @Param("assessmentId") assessmentId: string,
    @Param("verifiedProfileId") verifiedProfileId: string,
    @Query("expected_version") expectedVersion: string | undefined,
    @Query("required_for") requiredForRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    const requiredFor = parseVerifiedProfileRequiredFor(
      requiredForRaw,
      correlationId,
    );
    const version = parseVerifiedProfileVersion(expectedVersion, correlationId);

    return resultEnvelope(
      await this.queryBus.execute(
        new GetVerifiedProfileQuery(
          assessmentId,
          request.pbacContext.organizationId,
          verifiedProfileId,
          version,
          requiredFor,
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

function parseVerifiedProfileVersion(
  value: string | undefined,
  correlationId: string,
): string {
  if (value && /^[1-9][0-9]{0,9}$/.test(value)) return value;
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

function parseVerifiedProfileRequiredFor(
  value: string | undefined,
  correlationId: string,
): VerifiedProfileRequiredFor {
  if (
    value === VERIFIED_PROFILE_REQUIRED_FOR.legalMatching ||
    value === VERIFIED_PROFILE_REQUIRED_FOR.classification ||
    value === VERIFIED_PROFILE_REQUIRED_FOR.gapAnalysis
  )
    return value;
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
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

function parseAssessmentContextIncludes(
  raw: string | undefined,
  correlationId: string,
): AssessmentContextInclude[] {
  const values = splitCsv(raw);
  if (values.length === 0) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  }
  const allowed = new Set(Object.values(ASSESSMENT_CONTEXT_INCLUDES));
  if (values.some((value) => !allowed.has(value as AssessmentContextInclude))) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  }
  return values as AssessmentContextInclude[];
}

function parseAssessmentContextAnswerFields(
  raw: string | undefined,
  correlationId: string,
): AssessmentContextAnswerField[] {
  const values = splitCsv(raw);
  const allowed = new Set(Object.values(ASSESSMENT_CONTEXT_ANSWER_FIELDS));
  if (
    values.some((value) => !allowed.has(value as AssessmentContextAnswerField))
  ) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  }
  return values as AssessmentContextAnswerField[];
}

function splitCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseTargetCandidateKinds(
  raw: string | undefined,
  correlationId: string,
): Array<(typeof TARGET_CANDIDATE_KINDS)[keyof typeof TARGET_CANDIDATE_KINDS]> {
  const values = splitCsv(raw);
  if (values.length === 0) {
    throwInvalidRequest(correlationId);
  }
  const allowed = new Set(Object.values(TARGET_CANDIDATE_KINDS));
  if (values.some((value) => !allowed.has(value as never))) {
    throwInvalidRequest(correlationId);
  }
  return values as Array<
    (typeof TARGET_CANDIDATE_KINDS)[keyof typeof TARGET_CANDIDATE_KINDS]
  >;
}

function parseSeedRefs(
  raw: string | undefined,
  correlationId: string,
): string[] {
  const values = splitCsv(raw);
  const allowedPattern =
    /^(finding|symbol|node|invocation):[A-Za-z0-9_-]{1,120}$/;
  if (values.some((value) => !allowedPattern.test(value))) {
    throwInvalidRequest(correlationId);
  }
  return values;
}

function parseTargetIds(
  raw: string | undefined,
  correlationId: string,
): string[] {
  const values = splitCsv(raw);
  const allowedPattern = /^target:[A-Za-z0-9_-]{1,120}$/;
  if (values.some((value) => !allowedPattern.test(value))) {
    throwInvalidRequest(correlationId);
  }
  return values;
}

function parseProposalMaxResults(
  raw: string | undefined,
  correlationId: string,
): number {
  if (!raw) return 25;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) {
    throwInvalidRequest(correlationId);
  }
  return parsed;
}

function throwInvalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
