import { randomUUID } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  claimAssessmentRootRequestSchema,
  createAssessmentSchema,
  renameAssessmentSchema,
  assessmentEventsQuerySchema,
  assessmentListQuerySchema,
  type AssessmentEventsQuery,
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
import { CompleteRepositorySetupCommand } from "../../application/commands/complete-repository-setup/complete-repository-setup.command.js";
import { CreateAssessmentCommand } from "../../application/commands/create-assessment/create-assessment.command.js";
import { DeleteAssessmentCommand } from "../../application/commands/delete-assessment/delete-assessment.command.js";
import { RenameAssessmentCommand } from "../../application/commands/rename-assessment/rename-assessment.command.js";
import { GetAssessmentQuery } from "../../application/queries/get-assessment/get-assessment.query.js";
import { GetRepositorySetupQuery } from "../../application/queries/get-repository-setup/get-repository-setup.query.js";
import { ListAssessmentEventsQuery } from "../../application/queries/list-assessment-events/list-assessment-events.query.js";
import { ListAssessmentsQuery } from "../../application/queries/list-assessments/list-assessments.query.js";

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

  /** The conversation's single source: this assessment's canonical events, paged by sequence. */
  @Get(":assessmentId/events")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async listEvents(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Query(pipe(assessmentEventsQuerySchema)) page: AssessmentEventsQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new ListAssessmentEventsQuery(
          assessmentId,
          request.rbacContext.userId,
          request.rbacContext.role,
          page,
          request.correlationId || randomUUID(),
        ),
      ),
    );
  }
}
