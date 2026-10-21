import { randomUUID } from "node:crypto";
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { AssessmentTrackingLoader } from "../../infrastructure/persistence/assessment-tracking.loader.js";

/**
 * Controller providing operational tracking and platform health projections for administrators.
 */
@Controller("admin/tracking")
@UseGuards(RbacGuard)
export class AdminTrackingController {
  constructor(private readonly trackingLoader: AssessmentTrackingLoader) {}

  /**
   * Retrieves administrative operational tracking projection.
   *
   * Aggregates customer-impacting failures, execution anomalies, unreconciled LLM usage,
   * untrusted projections, and overall platform health metrics.
   */
  @Get("operational")
  @RequireRoles(AUTH_USER_ROLES.admin)
  async getOperational(@Req() request: AuthenticatedRequest) {
    const correlationId = request.correlationId || randomUUID();
    const data = await this.trackingLoader.loadAdminOperational({
      sessionUserId: request.rbacContext.userId,
      subjectRole: request.rbacContext.role,
      correlationId,
    });
    return resultEnvelope(data);
  }
}
