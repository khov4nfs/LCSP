import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ERROR_CODES,
  billingAdminDashboardQuerySchema,
  billingAdminExportQuerySchema,
  type BillingAdminDashboardQuery,
  type BillingAdminExportQuery,
} from "@lcsp/contracts/billing";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { GetBillingAdminDashboardQuery } from "../../application/queries/get-admin-billing-dashboard/get-admin-billing-dashboard.query.js";
import { GetBillingAdminExportQuery } from "../../application/queries/get-admin-billing-export/get-admin-billing-export.query.js";

@Controller("admin/billing")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class BillingAdminController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  async getDashboard(
    @Query(
      new ZodValidationPipe(
        billingAdminDashboardQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: BillingAdminDashboardQuery,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(new GetBillingAdminDashboardQuery(query)),
    );
  }

  @Get("export")
  async exportReport(
    @Query(
      new ZodValidationPipe(
        billingAdminExportQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: BillingAdminExportQuery,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(new GetBillingAdminExportQuery(query)),
    );
  }
}
