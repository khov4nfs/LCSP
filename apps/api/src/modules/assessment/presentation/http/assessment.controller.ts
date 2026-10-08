import { randomUUID } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  claimAssessmentRootRequestSchema,
  createAssessmentSchema,
  renameAssessmentSchema,
  assessmentListQuerySchema,
  type AssessmentListQuery,
} from "@lcsp/contracts/assessment-domain";
import type { z } from "zod";
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
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { CompleteRepositorySetupCommand } from "../../application/commands/complete-repository-setup/complete-repository-setup.command.js";
import { CreateAssessmentCommand } from "../../application/commands/create-assessment/create-assessment.command.js";
import { DeleteAssessmentCommand } from "../../application/commands/delete-assessment/delete-assessment.command.js";
import { MarkAiNotDetectedCommand } from "../../application/commands/mark-ai-not-detected/mark-ai-not-detected.command.js";
import { PutRuleAssessmentCommand } from "../../application/commands/put-rule-assessment/put-rule-assessment.command.js";
import { RenameAssessmentCommand } from "../../application/commands/rename-assessment/rename-assessment.command.js";
import { GetAssessmentQuery } from "../../application/queries/get-assessment/get-assessment.query.js";
import { GetRepositorySetupQuery } from "../../application/queries/get-repository-setup/get-repository-setup.query.js";
import { ListAssessmentsQuery } from "../../application/queries/list-assessments/list-assessments.query.js";
import { ListRuleAssessmentsQuery } from "../../application/queries/list-rule-assessments/list-rule-assessments.query.js";
import { AssessmentInterviewRuntimeService } from "../../application/services/assessment-interview-runtime.service.js";

const pipe = (schema: z.ZodType) =>
  new ZodValidationPipe(
    schema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
const idPipe = () => pipe(claimAssessmentRootRequestSchema.shape.assessmentId);

/** Customer transport dispatches canonical commands/queries; reads never start work. */
@Controller("assessments")
@UseGuards(RbacGuard)
export class AssessmentController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @RequireRoles(AUTH_USER_ROLES.customer)
  async createAssessment(
    @Body(pipe(createAssessmentSchema))
    body: z.infer<typeof createAssessmentSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new CreateAssessmentCommand(
          request.rbacContext.userId,
          body.name,
          body.description,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Post(":assessmentId/repository-setup/complete")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async completeRepositorySetup(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new CompleteRepositorySetupCommand(
          assessmentId,
          request.rbacContext.userId,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Get(":assessmentId/repository-setup")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async getRepositorySetup(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetRepositorySetupQuery(
          assessmentId,
          request.rbacContext.userId,
          request.rbacContext.role,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Patch(":assessmentId")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async renameAssessment(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Body(pipe(renameAssessmentSchema))
    body: z.infer<typeof renameAssessmentSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new RenameAssessmentCommand(
          assessmentId,
          request.rbacContext.userId,
          body.name,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Delete(":assessmentId")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async deleteAssessment(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new DeleteAssessmentCommand(
          assessmentId,
          request.rbacContext.userId,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Get()
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async listAssessments(
    @Query(pipe(assessmentListQuerySchema)) filters: AssessmentListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = request.rbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new ListAssessmentsQuery(
          actor.userId,
          actor.role,
          actor.scope,
          filters.page,
          filters.page_size,
          filters.lifecycleState,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Get(":assessmentId")
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getAssessment(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetAssessmentQuery(
          assessmentId,
          request.rbacContext.userId,
          request.rbacContext.role,
          request.correlationId || randomUUID(),
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
