import { randomUUID } from "node:crypto";
import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { AssessmentTrackingLoader } from "../../infrastructure/persistence/assessment-tracking.loader.js";

/**
 * Controller providing the authoritative customer tracking read model.
 */
@Controller("assessments/tracking")
@UseGuards(RbacGuard)
export class AssessmentTrackingController {
  constructor(private readonly trackingLoader: AssessmentTrackingLoader) {}

  /**
   * Retrieves the customer tracking dashboard read model.
   *
   * Aggregates actions requiring human resolution, material changes since the latest result,
   * current accepted rule compliance summary, result freshness, and report readiness.
   */
  @Get("overview")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async getOverview(
    @Req() request: AuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("since") since?: string,
    @Query("locale") locale?: string,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const data = await this.trackingLoader.loadCustomerOverview({
      sessionUserId: request.rbacContext.userId,
      subjectRole: request.rbacContext.role,
      correlationId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      since: since || undefined,
      locale: locale || undefined,
    });
    return resultEnvelope(data);
  }
}
