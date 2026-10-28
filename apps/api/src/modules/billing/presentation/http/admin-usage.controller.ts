import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ERROR_CODES,
  adminUsageQuerySchema,
  type AdminUsageQuery,
} from "@lcsp/contracts/billing";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { GetAdminUsageQuery } from "../../application/queries/get-admin-usage/get-admin-usage.query.js";

@Controller("admin/usage")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class AdminUsageController {
  constructor(private readonly queries: QueryBus) {}
  @Get()
  async get(
    @Query(
      new ZodValidationPipe(
        adminUsageQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    filters: AdminUsageQuery,
  ) {
    return resultEnvelope(
      await this.queries.execute(new GetAdminUsageQuery(filters)),
    );
  }
}
