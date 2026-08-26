import { randomUUID } from "node:crypto";

import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ARTIFACT_CHAIN_STAGES,
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  type ArtifactChainStage,
  type AssessmentContextAnswerField,
  type AssessmentContextInclude,
} from "@lcsp/contracts/evidence";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { AcceptConflictCommand } from "../../application/commands/accept-conflict/accept-conflict.command.js";
import { ResolveConflictCommand } from "../../application/commands/resolve-conflict/resolve-conflict.command.js";
import { TARGET_CANDIDATE_KINDS } from "../../application/contracts/missing-target-proposal.contract.js";
import type { ConflictDetectionCallbackRequest } from "../../application/contracts/reconciliation/conflict-detection-callback.contract.js";
import {
  RECONCILIATION_CONTEXT_STATUSES,
  type ReconciliationContextStatus,
} from "../../application/contracts/reconciliation/reconciliation-context.contract.js";
import { GetArtifactChainQuery } from "../../application/queries/get-artifact-chain/get-artifact-chain.query.js";
import { GetAssessmentContextQuery } from "../../application/queries/get-assessment-context/get-assessment-context.query.js";
import { GetReconciliationContextQuery } from "../../application/queries/get-reconciliation-context/get-reconciliation-context.query.js";
import { ListConflictsQuery } from "../../application/queries/list-conflicts/list-conflicts.query.js";
import { ProposeMissingTargetsQuery } from "../../application/queries/propose-missing-targets/propose-missing-targets.query.js";

type ResolveConflictRequest = {
  resolution?: unknown;
  resolution_note?: unknown;
};

@Controller("internal/reconciliation")
export class InternalReconciliationController {
  constructor(private readonly commandBus: CommandBus) {}

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
}

@Controller("assessments")
export class ReconciliationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(":assessmentId/conflicts")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async listConflicts(
    @Param("assessmentId") assessmentId: string,
    @Query("status") status: string | undefined,
    @Query("page") page: string | undefined,
    @Query("page_size") pageSize: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const rbacContext = request.rbacContext;

    return resultEnvelope(
      await this.queryBus.execute(
        new ListConflictsQuery(
          assessmentId,
          rbacContext.userId,
          rbacContext.role,
          page !== undefined ? Number(page) : undefined,
          pageSize !== undefined ? Number(pageSize) : undefined,
          status,
          request.correlationId as string,
        ),
      ),
    );
  }

  @Get(":assessmentId/artifact-chain")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getArtifactChain(
    @Param("assessmentId") assessmentId: string,
    @Query("artifact_ref") artifactRefRaw: string | undefined,
    @Query("required_stages") requiredStagesRaw: string | undefined,
    @Query("exact_versions") exactVersionsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const artifactRef = parseArtifactRefQuery(
      artifactRefRaw,
      request.correlationId as string,
    );
    const requiredStages = parseArtifactChainStages(
      requiredStagesRaw,
      request.correlationId as string,
    );

    return resultEnvelope(
      await this.queryBus.execute(
        new GetArtifactChainQuery(
          assessmentId,
          request.correlationId as string,
          artifactRef,
          requiredStages,
          exactVersionsRaw === "true",
        ),
      ),
    );
  }

  @Get(":assessmentId/reconciliation-context")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async getReconciliationContext(
    @Param("assessmentId") assessmentId: string,
    @Query("flow_ref") flowRef: string | undefined,
    @Query("conflict_ids") conflictIdsRaw: string | undefined,
    @Query("statuses") statusesRaw: string | undefined,
    @Query("cursor") cursorRaw: string | undefined,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    const flowId = parseOptionalFlowRef(flowRef, correlationId);
    const conflictIds = parseConflictIds(conflictIdsRaw, correlationId);
    if (!flowId && conflictIds.length === 0) {
      throwInvalidRequest(correlationId);
    }
    const statuses = parseReconciliationStatuses(statusesRaw, correlationId);
    const cursor = parseCursor(cursorRaw, correlationId);
    const maxResults = parseMaxResults(maxResultsRaw, correlationId);

    return resultEnvelope(
      await this.queryBus.execute(
        new GetReconciliationContextQuery(
          assessmentId,
          correlationId,
          flowId,
          conflictIds,
          cursor,
          maxResults,
          statuses,
        ),
      ),
    );
  }

  @Get(":assessmentId/missing-targets")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
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
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
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
          wizardProfileId,
          includes,
          answerFields,
          correlationId,
        ),
      ),
    );
  }

  @Patch(":assessmentId/conflicts/:conflictId/resolve")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async resolveConflict(
    @Param("assessmentId") assessmentId: string,
    @Param("conflictId") conflictId: string,
    @Body() body: ResolveConflictRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const rbacContext = request.rbacContext;

    return resultEnvelope(
      await this.commandBus.execute(
        new ResolveConflictCommand(
          assessmentId,
          conflictId,
          rbacContext.userId,
          body.resolution,
          body.resolution_note,
          request.correlationId as string,
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

function parseOptionalFlowRef(
  value: string | undefined,
  correlationId: string,
): string | null {
  if (!value) return null;
  return parseFlowRef(value, correlationId);
}

function parseArtifactRefQuery(
  value: string | undefined,
  correlationId: string,
): string | null {
  if (!value) return null;
  if (!/^(ter|flow|conflict|verified):[A-Za-z0-9_-]{1,160}$/u.test(value)) {
    throwInvalidRequest(correlationId);
  }
  return value;
}

function parseConflictIds(
  raw: string | undefined,
  correlationId: string,
): string[] {
  const values = splitCsv(raw);
  const allowedPattern = /^conflict:[A-Za-z0-9_-]{1,160}$/u;
  if (values.some((value) => !allowedPattern.test(value))) {
    throwInvalidRequest(correlationId);
  }
  return values.map((value) => value.slice("conflict:".length));
}

function parseCursor(
  raw: string | undefined,
  correlationId: string,
): string | null {
  if (!raw) return null;
  if (raw.length > 512) {
    throwInvalidRequest(correlationId);
  }
  return raw;
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
