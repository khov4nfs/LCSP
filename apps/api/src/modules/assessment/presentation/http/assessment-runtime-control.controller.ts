import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_RUNTIME_CONTROL_ACTIONS } from "@lcsp/contracts/evidence";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";

import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import {
  claimAssessmentRootRequestSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import {
  customerRuntimeControlRequestSchema,
  adminBudgetExtensionRequestSchema,
  type CustomerRuntimeControlRequest,
  type AdminBudgetExtensionRequest,
} from "@lcsp/contracts/evidence";
import { GetRuntimeControlQuery } from "../../application/queries/get-runtime-control/get-runtime-control.query.js";
import { ControlAssessmentRuntimeCommand } from "../../application/commands/control-assessment-runtime/control-assessment-runtime.command.js";

function idPipe() {
  return new ZodValidationPipe(
    claimAssessmentRootRequestSchema.shape.assessmentId,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
}
function customerControlPipe() {
  return new ZodValidationPipe(
    customerRuntimeControlRequestSchema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
}
function adminExtensionPipe() {
  return new ZodValidationPipe(
    adminBudgetExtensionRequestSchema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
}

@Controller("assessments/:assessmentId/runtime")
@UseGuards(RbacGuard)
export class AssessmentRuntimeControlController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get("control")
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async current(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queries.execute(
        new GetRuntimeControlQuery(
          assessmentId,
          req.rbacContext,
          req.correlationId ?? assessmentId,
        ),
      ),
    );
  }

  @Post("stop")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async stop(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body(customerControlPipe()) body: CustomerRuntimeControlRequest,
  ) {
    return resultEnvelope(
      await this.commands.execute(
        new ControlAssessmentRuntimeCommand(
          assessmentId,
          req.rbacContext,
          ASSESSMENT_RUNTIME_CONTROL_ACTIONS.stop,
          body.targetRunId,
          req.correlationId ?? assessmentId,
        ),
      ),
    );
  }

  @Post("continue")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async resume(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body(customerControlPipe()) body: CustomerRuntimeControlRequest,
  ) {
    const locale =
      (req.headers?.["x-lcsp-locale"] as string | undefined) ?? null;
    return resultEnvelope(
      await this.commands.execute(
        new ControlAssessmentRuntimeCommand(
          assessmentId,
          req.rbacContext,
          ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
          body.targetRunId,
          req.correlationId ?? assessmentId,
          locale,
        ),
      ),
    );
  }

  @Post("extend-budget")
  @RequireRoles(AUTH_USER_ROLES.admin)
  async extendBudget(
    @Param("assessmentId", idPipe()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
    @Body(adminExtensionPipe()) body: AdminBudgetExtensionRequest,
  ) {
    const locale =
      (req.headers?.["x-lcsp-locale"] as string | undefined) ?? null;
    return resultEnvelope(
      await this.commands.execute(
        new ControlAssessmentRuntimeCommand(
          assessmentId,
          req.rbacContext,
          ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
          body.targetRunId,
          req.correlationId ?? assessmentId,
          locale,
          body.budgetExtension,
        ),
      ),
    );
  }
}
