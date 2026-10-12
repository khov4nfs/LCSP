import { randomUUID } from "node:crypto";
import {
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
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RetryRuleSetPreparationCommand } from "../../application/commands/retry-rule-set-preparation/retry-rule-set-preparation.command.js";
import { ListComplianceRuleSetHistoryQuery } from "../../application/queries/list-compliance-rule-set-history/list-compliance-rule-set-history.query.js";

/**
 * Operations view of the shared Compliance Rule Sets. Preparation starts automatically with a
 * Legal Source Version activation, so there is no start route here: the only operator action is
 * retrying one failed preparation of the same Legal Source Version.
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
}
