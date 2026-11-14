import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_RUNTIME_CONTROL_ACTIONS } from "@lcsp/contracts/evidence";
import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import {
  claimAssessmentRootRequestSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import {
  adminBudgetExtensionRequestSchema,
  type AdminBudgetExtensionRequest,
} from "@lcsp/contracts/evidence";
import { ControlAssessmentRuntimeCommand } from "../../application/commands/control-assessment-runtime/control-assessment-runtime.command.js";

const idPipe = () =>
  new ZodValidationPipe(
    claimAssessmentRootRequestSchema.shape.assessmentId,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );
const adminExtensionPipe = () =>
  new ZodValidationPipe(
    adminBudgetExtensionRequestSchema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    422,
  );

/**
 * Controller providing administrative budget governance workflows for assessment executions.
 */
@Controller("admin/assessments/:assessmentId")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class AdminAssessmentBudgetController {
  constructor(private readonly commands: CommandBus) {}

  @Post("budget-extension")
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

