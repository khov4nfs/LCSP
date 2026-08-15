import { Query } from "@nestjs/cqrs";

import type { AssessmentDetailDto } from "../../contracts/assessment/assessment-detail.contract.js";
import type { SubjectRole } from "../../../../../platform/pbac/pbac.types.js";

/**
 * Requests one assessment detail view within the caller's organization and PBAC subject context.
 */
export class GetAssessmentQuery extends Query<AssessmentDetailDto> {
  /**
   * Creates the assessment-detail query.
   *
   * @param assessmentId - Assessment identifier requested by the caller.
   * @param organizationId - Organization boundary within which the assessment must exist.
   * @param sessionUserId - Authenticated user identifier used for owner visibility checks.
   * @param subjectRole - PBAC subject role used to select manager/developer visibility behavior.
   * @param correlationId - Correlation identifier propagated to response and problem metadata.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: SubjectRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
