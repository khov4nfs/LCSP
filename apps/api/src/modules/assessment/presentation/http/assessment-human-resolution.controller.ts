import { randomUUID } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  answerAssessmentHumanRequestSchema,
  claimAssessmentRootRequestSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  type AnswerAssessmentHumanRequest,
} from "@lcsp/contracts/assessment-domain";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { AnswerHumanRequestCommand } from "../../application/commands/answer-human-request/answer-human-request.command.js";
import { GetHumanRequestsQuery } from "../../application/queries/get-human-requests/get-human-requests.query.js";

const idPipe = () =>
  new ZodValidationPipe(
    claimAssessmentRootRequestSchema.shape.assessmentId,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/** Customer fact transport. Auth/Zod/CQRS only; no Interview or lifecycle authority. */
@Controller("assessments/:assessmentId/human-requests")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentHumanResolutionController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  async list(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queries.execute(
        new GetHumanRequestsQuery(
          assessmentId,
          req.rbacContext,
          req.correlationId || randomUUID(),
        ),
      ),
    );
  }

  @Post(":requestId/answers")
  @HttpCode(200)
  async answer(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Param("requestId", idPipe()) requestId: string,
    @Body(
      new ZodValidationPipe(
        answerAssessmentHumanRequestSchema,
        ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_ANSWER_INVALID,
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    )
    body: AnswerAssessmentHumanRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commands.execute(
        new AnswerHumanRequestCommand(
          assessmentId,
          requestId,
          req.rbacContext,
          body,
          req.correlationId || randomUUID(),
        ),
      ),
    );
  }
}
