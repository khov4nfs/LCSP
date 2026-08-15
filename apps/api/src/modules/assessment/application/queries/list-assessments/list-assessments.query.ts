import { Query } from "@nestjs/cqrs";

import type { AssessmentListDto } from "../../contracts/assessment/assessment-list.contract.js";
import type { SubjectRole } from "../../../../../platform/pbac/pbac.types.js";

/**
 * Requests a paginated assessment list constrained by organization, caller role/scope, and optional status.
 */
export class ListAssessmentsQuery extends Query<AssessmentListDto> {
  /**
   * Creates the assessment-list query.
   *
   * @param organizationId - Organization boundary for all returned assessments.
   * @param sessionUserId - Authenticated user used for manager ownership filtering.
   * @param subjectRole - PBAC subject role used to choose owner or scoped-assessment visibility.
   * @param scope - Membership scope for non-manager callers, or null when no resource scope is granted.
   * @param page - Optional requested 1-based page number.
   * @param pageSize - Optional requested page size.
   * @param status - Optional assessment status filter.
   * @param correlationId - Correlation identifier propagated to response and validation errors.
   */
  constructor(
    public readonly organizationId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: SubjectRole,
    public readonly scope: string | null,
    public readonly page: number | undefined,
    public readonly pageSize: number | undefined,
    public readonly status: string | undefined,
    public readonly correlationId: string,
  ) {
    super();
  }
}
