import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import {
  ADMIN_ACCOUNT_ERRORS,
  adminOverviewQuerySchema,
  AUTH_USER_ROLES,
  type AdminOverviewQueryInput,
} from "@lcsp/contracts/auth";

import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { GetAdminOverviewQuery } from "../../application/queries/index.js";

/**
 * Administrative HTTP controller for aggregating system overview metrics.
 */
@Controller("admin/overview")
export class AdminOverviewController {
  constructor(private readonly queryBus: QueryBus) {}

  /**
   * Retrieves high-level dashboard metrics across accounts, assessments, legal rule corpus, and audit activity.
   */
  @Get()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async getOverview(
    @Query(
      new ZodValidationPipe(
        adminOverviewQuerySchema,
        ADMIN_ACCOUNT_ERRORS.invalidInput,
      ),
    )
    query: AdminOverviewQueryInput,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(new GetAdminOverviewQuery(query.period)),
    );
  }
}
