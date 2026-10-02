import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import {
  ManageRepositoryRelationCommand,
  REPOSITORY_RELATION_MUTATIONS,
} from "../../application/commands/manage-repository-relation/manage-repository-relation.command.js";
import { RemoveAssessmentRepositoryCommand } from "../../application/commands/remove-assessment-repository/remove-assessment-repository.command.js";
import {
  ASSESSMENT_REPOSITORY_RELATION_TYPES,
  type AssessmentRepositoryRelationType,
} from "@lcsp/contracts/assessment";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { CompleteRepositorySetupCommand } from "../../application/commands/complete-repository-setup/complete-repository-setup.command.js";
import { CreateAssessmentCommand } from "../../application/commands/create-assessment/create-assessment.command.js";
import { DeleteAssessmentCommand } from "../../application/commands/delete-assessment/delete-assessment.command.js";
import { MarkAiNotDetectedCommand } from "../../application/commands/mark-ai-not-detected/mark-ai-not-detected.command.js";
import { PutRuleAssessmentCommand } from "../../application/commands/put-rule-assessment/put-rule-assessment.command.js";
import { RenameAssessmentCommand } from "../../application/commands/rename-assessment/rename-assessment.command.js";
import { GetAssessmentReadinessQuery } from "../../application/queries/get-assessment-readiness/get-assessment-readiness.query.js";
import { GetAssessmentQuery } from "../../application/queries/get-assessment/get-assessment.query.js";
import { ListAssessmentsQuery } from "../../application/queries/list-assessments/list-assessments.query.js";
import { ListRuleAssessmentsQuery } from "../../application/queries/list-rule-assessments/list-rule-assessments.query.js";
import { AssessmentInterviewRuntimeService } from "../../application/services/assessment-interview-runtime.service.js";
import { AssessmentInterviewSnippetService } from "../../application/services/assessment-interview-snippet.service.js";
import { AssessmentPipelineContinuationService } from "../../application/services/assessment-pipeline-continuation.service.js";
import { CreateAssessmentRequest } from "./dto/create-assessment.request.js";

/**
 * Exposes RBAC-protected assessment creation, listing, and detail endpoints through CQRS handlers.
 */
@Controller("assessments")
export class AssessmentController {
  /**
   * Creates the controller with command and query dispatchers.
   *
   * @param commandBus - CQRS command bus used for assessment mutations.
   * @param queryBus - CQRS query bus used for assessment reads.
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly interviewRuntime: AssessmentInterviewRuntimeService,
    private readonly interviewSnippet: AssessmentInterviewSnippetService,
    private readonly pipelineContinuation: AssessmentPipelineContinuationService,
  ) {}

  /**
   * Creates a manager-owned assessment using the RBAC context attached by the guard.
   *
   * @param body - Assessment creation request containing name and optional description.
   * @param request - Authenticated request containing RBAC and correlation context.
   * @returns The standard result envelope containing the created assessment DTO.
   */
  @Post()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async createAssessment(
    @Body() body: CreateAssessmentRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const rbacContext = request.rbacContext;

    return resultEnvelope(
      await this.commandBus.execute(
        new CreateAssessmentCommand(
          rbacContext.userId,
          body.name,
          body.description,
          request.correlationId ?? "worker-interview-context",
        ),
      ),
    );
  }

  @Post(":assessmentId/repository-setup/complete")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async completeRepositorySetup(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new CompleteRepositorySetupCommand(
          assessmentId,
          request.rbacContext.userId,
          request.correlationId ?? "repository-setup-complete",
        ),
      ),
    );
  }

  @Post(":assessmentId/repository-relations")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async createRepositoryRelation(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const relation = relationBody(body);
    return resultEnvelope(
      await this.commandBus.execute(
        new ManageRepositoryRelationCommand(
          REPOSITORY_RELATION_MUTATIONS.create,
          assessmentId,
          request.rbacContext.userId,
          null,
          relation?.fromSnapshotId ?? null,
          relation?.toSnapshotId ?? null,
          relation?.type ?? null,
          request.correlationId ?? "repository-relation-create",
        ),
      ),
    );
  }

  @Patch(":assessmentId/repository-relations/:relationId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async updateRepositoryRelation(
    @Param("assessmentId") assessmentId: string,
    @Param("relationId") relationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const relation = relationBody(body);
    return resultEnvelope(
      await this.commandBus.execute(
        new ManageRepositoryRelationCommand(
          REPOSITORY_RELATION_MUTATIONS.update,
          assessmentId,
          request.rbacContext.userId,
          relationId,
          relation?.fromSnapshotId ?? null,
          relation?.toSnapshotId ?? null,
          relation?.type ?? null,
          request.correlationId ?? "repository-relation-update",
        ),
      ),
    );
  }

  @Delete(":assessmentId/repository-relations/:relationId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async deleteRepositoryRelation(
    @Param("assessmentId") assessmentId: string,
    @Param("relationId") relationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ManageRepositoryRelationCommand(
          REPOSITORY_RELATION_MUTATIONS.remove,
          assessmentId,
          request.rbacContext.userId,
          relationId,
          null,
          null,
          null,
          request.correlationId ?? "repository-relation-remove",
        ),
      ),
    );
  }

  @Delete(":assessmentId/repositories/:connectionId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async removeAssessmentRepository(
    @Param("assessmentId") assessmentId: string,
    @Param("connectionId") connectionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new RemoveAssessmentRepositoryCommand(
          assessmentId,
          connectionId,
          request.rbacContext.userId,
          request.correlationId ?? "assessment-repository-remove",
        ),
      ),
    );
  }

  @Patch(":assessmentId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async renameAssessment(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const name =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { name?: unknown }).name
        : undefined;
    return resultEnvelope(
      await this.commandBus.execute(
        new RenameAssessmentCommand(
          assessmentId,
          request.rbacContext.userId,
          name,
          request.correlationId ?? "assessment-rename",
        ),
      ),
    );
  }

  @Delete(":assessmentId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async deleteAssessment(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new DeleteAssessmentCommand(
          assessmentId,
          request.rbacContext.userId,
          request.correlationId ?? "assessment-delete",
        ),
      ),
    );
  }

  /**
   * Lists assessments visible to the current RBAC subject with optional pagination and status filtering.
   *
   * @param page - Optional 1-based page query parameter.
   * @param pageSize - Optional page-size query parameter.
   * @param status - Optional assessment status filter.
   * @param request - Authenticated request containing role, scope, and correlation context.
   * @returns The standard result envelope containing the paginated assessment list.
   */
  @Get()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async listAssessments(
    @Query("page") page: string | undefined,
    @Query("page_size") pageSize: string | undefined,
    @Query("status") status: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const rbacContext = request.rbacContext;

    return resultEnvelope(
      await this.queryBus.execute(
        new ListAssessmentsQuery(
          rbacContext.userId,
          rbacContext.role,
          rbacContext.scope,
          page !== undefined ? Number(page) : undefined,
          pageSize !== undefined ? Number(pageSize) : undefined,
          status,
          request.correlationId ?? "worker-interview-context",
        ),
      ),
    );
  }

  /**
   * Retrieves the caller-visible detail view for one assessment.
   *
   * @param assessmentId - Assessment identifier from the route path.
   * @param request - Authenticated request containing user, role, and correlation context.
   * @returns The standard result envelope containing assessment readiness and pipeline detail.
   */
  @Get(":assessmentId/interview")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getInterviewState(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.getState(assessmentId, request.rbacContext),
    );
  }

  @Get(":assessmentId/interview/questions/:questionId/source-snippet")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getInterviewSourceSnippet(
    @Param("assessmentId") assessmentId: string,
    @Param("questionId") questionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const snippetContext =
      await this.interviewRuntime.resolveActiveQuestionSnippetContext(
        assessmentId,
        questionId,
        request.rbacContext,
      );
    return resultEnvelope(
      await this.interviewSnippet.resolve({
        assessmentId,
        correlationId: request.correlationId ?? "interview-source-snippet",
        evidenceReportId: snippetContext.evidenceReportId,
        snippetRef: snippetContext.snippetRef,
      }),
    );
  }

  @Get(":assessmentId/readiness")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getReadiness(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const { rbacContext } = request;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetAssessmentReadinessQuery(
          assessmentId,
          rbacContext.userId,
          rbacContext.role,
          request.correlationId ?? "assessment-readiness",
        ),
      ),
    );
  }

  @Post(":assessmentId/interview/answers")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async submitInterviewAnswer(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.submitAnswer({
        assessmentId,
        actor: request.rbacContext,
        correlationId: request.correlationId ?? "worker-interview-context",
        answer: body as never,
      }),
    );
  }

  @Post(":assessmentId/interview/blocked-actions")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async recordInterviewBlockedAction(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.recordBlockedAction({
        assessmentId,
        actor: request.rbacContext,
        correlationId: request.correlationId ?? "worker-interview-context",
        blocked: body as never,
      }),
    );
  }

  @Post(":assessmentId/interview/resume")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async resumeInterviewTurn(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.resumeInterruptedTurn({
        assessmentId,
        actor: request.rbacContext,
        correlationId: request.correlationId ?? "worker-interview-context",
        resume: body as never,
      }),
    );
  }

  @Post(":assessmentId/interview/pause")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async pauseInterviewTurn(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const control = await this.interviewRuntime.pauseActiveTurn({
      assessmentId,
      actor: request.rbacContext,
      correlationId: request.correlationId ?? "worker-interview-context",
    });
    return resultEnvelope(control);
  }

  @Post(":assessmentId/pipeline/continue")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async continuePipeline(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.pipelineContinuation.continuePipeline({
        assessmentId,
        actor: request.rbacContext,
        correlationId: request.correlationId ?? "customer-pipeline-continue",
      }),
    );
  }

  @Post(":assessmentId/post-finding/decisions")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async submitPostFindingDecision(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.submitPostFindingDecision({
        assessmentId,
        actor: request.rbacContext,
        correlationId: request.correlationId ?? "post-finding-decision",
        decision: body as never,
      }),
    );
  }

  @Get(":assessmentId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getAssessment(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const rbacContext = request.rbacContext;

    return resultEnvelope(
      await this.queryBus.execute(
        new GetAssessmentQuery(
          assessmentId,
          rbacContext.userId,
          rbacContext.role,
          request.correlationId ?? "worker-interview-context",
        ),
      ),
    );
  }
}

@Controller("internal/assessment-interviews")
@UseGuards(WorkerApiKeyGuard)
export class InternalAssessmentInterviewController {
  constructor(
    private readonly interviewRuntime: AssessmentInterviewRuntimeService,
    private readonly commandBus: CommandBus,
  ) {}

  @Post(":assessmentId/ai-not-detected")
  async markAiNotDetected(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const technicalEvidenceReportId =
      body && typeof body === "object"
        ? (body as { technicalEvidenceReportId?: unknown })
            .technicalEvidenceReportId
        : undefined;
    return resultEnvelope(
      await this.commandBus.execute(
        new MarkAiNotDetectedCommand(
          assessmentId,
          technicalEvidenceReportId,
          request.correlationId ?? "worker-interview-context",
        ),
      ),
    );
  }

  @Get(":assessmentId/state")
  async getWorkerState(@Param("assessmentId") assessmentId: string) {
    return resultEnvelope(
      await this.interviewRuntime.getWorkerStateForWorker(assessmentId),
    );
  }

  @Get(":assessmentId/private-context/:contextRevision")
  async getPrivateContext(
    @Param("assessmentId") assessmentId: string,
    @Param("contextRevision") contextRevision: string,
    @Query("source_version") sourceVersion: string | undefined,
    @Query("pge_version") pgeVersion: string | undefined,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.getPrivateContextForWorker({
        assessmentId,
        contextRevision: Number(contextRevision),
        sourceVersion,
        pgeVersion,
      }),
    );
  }

  @Post(":assessmentId/targeted-needs")
  async registerTargetedNeed(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.registerTargetedNeedForWorker({
        assessmentId,
        correlationId: request.correlationId ?? "worker-interview-context",
        target: body as never,
      }),
    );
  }

  @Post(":assessmentId/runtime-progress")
  async recordRuntimeProgress(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.recordWorkerProgress(
        assessmentId,
        body,
        request.correlationId ?? "worker-interview-context",
      ),
    );
  }

  @Post(":assessmentId/agent-decisions")
  async recordAgentDecision(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.interviewRuntime.recordAgentDecision({
        assessmentId,
        correlationId: request.correlationId ?? "worker-interview-context",
        decision: body as never,
      }),
    );
  }

  @Post(":assessmentId/initial-question")
  async seedInitialQuestion(
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const technicalEvidenceReportId =
      body &&
      typeof body === "object" &&
      typeof (body as { technicalEvidenceReportId?: unknown })
        .technicalEvidenceReportId === "string"
        ? (body as { technicalEvidenceReportId: string })
            .technicalEvidenceReportId
        : undefined;
    const workflowRunId =
      body &&
      typeof body === "object" &&
      typeof (body as { workflowRunId?: unknown }).workflowRunId === "string"
        ? (body as { workflowRunId: string }).workflowRunId
        : undefined;
    return resultEnvelope(
      await this.interviewRuntime.seedInitialQuestionForWorker({
        assessmentId,
        correlationId: request.correlationId ?? "worker-interview-context",
        state: body as never,
        technicalEvidenceReportId,
        workflowRunId,
      }),
    );
  }
}

/**
 * Worker-key routes for the accepted per-rule assessment ledger (RuleEvidenceIndex).
 */
@Controller("internal/assessments")
@UseGuards(WorkerApiKeyGuard)
export class InternalRuleAssessmentController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Put(":assessmentId/rule-assessments/:engineeringRuleId")
  async putRuleAssessment(
    @Param("assessmentId") assessmentId: string,
    @Param("engineeringRuleId") engineeringRuleId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new PutRuleAssessmentCommand(
          assessmentId,
          engineeringRuleId,
          body,
          request.correlationId ?? "worker-rule-assessment",
        ),
      ),
    );
  }

  @Get(":assessmentId/rule-assessments")
  async listRuleAssessments(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new ListRuleAssessmentsQuery(
          assessmentId,
          request.correlationId ?? "worker-rule-assessment",
        ),
      ),
    );
  }
}

function relationBody(value: unknown): {
  fromSnapshotId: string;
  toSnapshotId: string;
  type: AssessmentRepositoryRelationType;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.from_snapshot_id === "string" &&
    typeof candidate.to_snapshot_id === "string" &&
    Object.values(ASSESSMENT_REPOSITORY_RELATION_TYPES).includes(
      candidate.type as AssessmentRepositoryRelationType,
    )
    ? {
        fromSnapshotId: candidate.from_snapshot_id,
        toSnapshotId: candidate.to_snapshot_id,
        type: candidate.type as AssessmentRepositoryRelationType,
      }
    : null;
}
