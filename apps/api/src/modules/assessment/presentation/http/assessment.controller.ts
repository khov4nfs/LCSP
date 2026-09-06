import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { CreateAssessmentCommand } from "../../application/commands/create-assessment/create-assessment.command.js";
import { CompleteRepositorySetupCommand } from "../../application/commands/complete-repository-setup/complete-repository-setup.command.js";
import { GetAssessmentQuery } from "../../application/queries/get-assessment/get-assessment.query.js";
import { GetAssessmentReadinessQuery } from "../../application/queries/get-assessment-readiness/get-assessment-readiness.query.js";
import { ListAssessmentsQuery } from "../../application/queries/list-assessments/list-assessments.query.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { AssessmentInterviewRuntimeService } from "../../application/services/assessment-interview-runtime.service.js";
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
  ) {}

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
    return resultEnvelope(
      await this.interviewRuntime.seedInitialQuestionForWorker({
        assessmentId,
        correlationId: request.correlationId ?? "worker-interview-context",
        state: body as never,
      }),
    );
  }
}
