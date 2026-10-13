import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  ruleSetPreparationAdminRequestSchema,
  type RuleSetPreparationAdminRequest,
} from "@lcsp/contracts/compliance-rule-set";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RetryRuleSetPreparationCommand } from "../../application/commands/retry-rule-set-preparation/retry-rule-set-preparation.command.js";
import { ListComplianceRuleSetHistoryQuery } from "../../application/queries/list-compliance-rule-set-history/list-compliance-rule-set-history.query.js";
import { PrepareCurrentRuleSetCommand } from "../../application/commands/prepare-current-rule-set/prepare-current-rule-set.command.js";
import { CancelRuleSetPreparationCommand } from "../../application/commands/cancel-rule-set-preparation/cancel-rule-set-preparation.command.js";

/**
 * Operations view of the shared Compliance Rule Sets. Preparation starts automatically with a
 * Legal Source Version activation; Admin can prepare the current source, retry a failure, or cancel
 * an active preparation.
 * The controller only dispatches commands; source selection and orchestration stay server-owned.
 */
@Controller("admin/compliance-rule-sets")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class ComplianceRuleSetAdminController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  list() {
    return this.queries
      .execute(new ListComplianceRuleSetHistoryQuery())
      .then(resultEnvelope);
  }

  @Post("preparations/:preparationRunId/retries")
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new RetryRuleSetPreparationCommand(
          preparationRunId,
          req.rbacContext.userId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }

  @Post("preparations/:preparationRunId/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new CancelRuleSetPreparationCommand(
          preparationRunId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }

  @Post("prepare")
  @HttpCode(HttpStatus.ACCEPTED)
  prepare(
    @Body(
      new ZodValidationPipe(
        ruleSetPreparationAdminRequestSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    _request: RuleSetPreparationAdminRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new PrepareCurrentRuleSetCommand(
          req.rbacContext.userId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }
}
