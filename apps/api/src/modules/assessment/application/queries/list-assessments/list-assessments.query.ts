import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";

import type { AssessmentListDto } from "../../contracts/assessment/assessment-list.contract.js";

/**
 * Requests a paginated assessment list constrained by caller role/scope and optional status.
 */
export class ListAssessmentsQuery extends Query<AssessmentListDto> {
  /**
   * Creates the assessment-list query.
   *
   * @param sessionUserId - Authenticated user used for ownership filtering.
   * @param subjectRole - RBAC subject role used to choose owner or scoped-assessment visibility.
   * @param scope - Optional resource scope from the RBAC request context.
   * @param page - Optional requested 1-based page number.
   * @param pageSize - Optional requested page size.
   * @param status - Optional assessment status filter.
   * @param correlationId - Correlation identifier propagated to response and validation errors.
   */
  constructor(
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly scope: string | null,
    public readonly page: number | undefined,
    public readonly pageSize: number | undefined,
    public readonly status: string | undefined,
    public readonly correlationId: string,
  ) {
    super();
  }
}
