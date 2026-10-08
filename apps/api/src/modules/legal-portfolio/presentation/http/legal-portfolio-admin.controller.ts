import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  HttpCode,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  legalPreparationStartRequestSchema,
  type LegalPreparationStartRequest,
  LEGAL_PORTFOLIO_ERROR_CODES,
} from "@lcsp/contracts/legal-portfolio";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { StartLegalPreparationCommand } from "../../application/commands/start-legal-preparation/start-legal-preparation.command.js";
import { ListLegalPortfolioHistoryQuery } from "../../application/queries/list-legal-portfolio-history/list-legal-portfolio-history.query.js";
@Controller("admin/legal-portfolios")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class LegalPortfolioAdminController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}
  @Get()
  list() {
    return this.queries
      .execute(new ListLegalPortfolioHistoryQuery())
      .then(resultEnvelope);
  }
  @Post("preparations")
  @HttpCode(202)
  prepare(
    @Body(
      new ZodValidationPipe(
        legalPreparationStartRequestSchema,
        LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
        422,
      ),
    )
    body: LegalPreparationStartRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new StartLegalPreparationCommand(
          body,
          req.rbacContext.userId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }
}
