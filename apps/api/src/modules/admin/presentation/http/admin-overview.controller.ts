import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import {
  ADMIN_ACCOUNT_ERRORS,
  adminOverviewQuerySchema,
  AUTH_USER_ROLES,
  type AdminOverviewQueryInput,
  type AdminOverviewStats,
} from "@lcsp/contracts/auth";

import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.ts";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { GetAdminOverviewQuery } from "../../application/queries/index.ts";

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
  ): Promise<AdminOverviewStats> {
    return this.queryBus.execute<GetAdminOverviewQuery, AdminOverviewStats>(
      new GetAdminOverviewQuery(query.period),
    );
  }
}
