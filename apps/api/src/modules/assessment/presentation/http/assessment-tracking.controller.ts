import { randomUUID } from "node:crypto";
import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  customerTrackingOverviewQuerySchema,
  customerTrackingListQuerySchema,
  type CustomerTrackingOverviewQuery,
  type CustomerTrackingListQuery,
} from "@lcsp/contracts/assessment-domain";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
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
    @Query(new ZodValidationPipe(customerTrackingOverviewQuerySchema))
    query: CustomerTrackingOverviewQuery,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const data = await this.trackingLoader.loadCustomerOverview({
      sessionUserId: request.rbacContext.userId,
      subjectRole: request.rbacContext.role,
      correlationId,
      ...query,
    });
    return resultEnvelope(data);
  }

  @Get("obligations")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async getObligations(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(customerTrackingListQuerySchema))
    query: CustomerTrackingListQuery,
  ) {
    const data = await this.trackingLoader.loadCustomerObligations({
      sessionUserId: request.rbacContext.userId,
      subjectRole: request.rbacContext.role,
      correlationId: request.correlationId || randomUUID(),
      ...query,
    });
    return resultEnvelope(data);
  }

  @Get("reports")
  @RequireRoles(AUTH_USER_ROLES.customer)
  async getReports(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(customerTrackingListQuerySchema))
    query: CustomerTrackingListQuery,
  ) {
    const data = await this.trackingLoader.loadCustomerReports({
      sessionUserId: request.rbacContext.userId,
      subjectRole: request.rbacContext.role,
      correlationId: request.correlationId || randomUUID(),
      limit: query.limit,
      offset: query.offset,
      freshness: query.freshness,
    });
    return resultEnvelope(data);
  }
}
