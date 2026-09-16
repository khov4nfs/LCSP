import { Body, Controller, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { BillingAdminReconciliationService } from "../../application/services/billing-admin-reconciliation.service.js";

@Controller("admin/billing/reconciliation")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class BillingAdminReconciliationController {
  constructor(private readonly service: BillingAdminReconciliationService) {}
  @Patch(":paymentId/reject")
  async reject(
    @Param("paymentId") paymentId: string,
    @Body() body: { expectedStatus?: string; rationale?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.service.reject({
        paymentId,
        expectedStatus: body.expectedStatus ?? "NEEDS_REVIEW",
        rationale: body.rationale ?? "",
        actorId: request.rbacContext.userId,
        correlationId: request.correlationId ?? "billing-admin",
      }),
    );
  }
}
