import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";

import type { AssessmentDetailDto } from "../../contracts/assessment/assessment-detail.contract.js";

/**
 * Requests one assessment detail view within the caller's RBAC subject context.
 */
export class GetAssessmentQuery extends Query<AssessmentDetailDto> {
  /**
   * Creates the assessment-detail query.
   *
   * @param assessmentId - Assessment identifier requested by the caller.
   * @param sessionUserId - Authenticated user identifier used for owner visibility checks.
   * @param subjectRole - RBAC subject role used to enforce owner visibility behavior.
   * @param correlationId - Correlation identifier propagated to response and problem metadata.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
