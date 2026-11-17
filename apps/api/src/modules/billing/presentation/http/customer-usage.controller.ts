import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ERROR_CODES,
  customerUsageQuerySchema,
  type CustomerUsageQuery,
} from "@lcsp/contracts/billing";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { GetCustomerUsageQuery } from "../../application/queries/get-customer-usage/get-customer-usage.query.js";

@Controller("billing/usage")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class CustomerUsageController {
  constructor(private readonly queries: QueryBus) {}

  /**
   * Business purpose: Expose the signed-in customer's usage report without owner-selectable access.
   * Business rules:
   * - Require the customer role and derive ownership exclusively from the authenticated context.
   * Execution flow:
   * 1. Validate filters, dispatch the owner-scoped query and wrap its public projection.
   * Failure cases:
   * - Authentication, role and validation failures use the global problem envelope.
   * Side effects:
   * - Read-only analytics request with no credit movement.
   */
  @Get()
  async get(
    @Query(
      new ZodValidationPipe(
        customerUsageQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    filters: CustomerUsageQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queries.execute(
        new GetCustomerUsageQuery(request.rbacContext.userId, filters),
      ),
    );
  }
}
