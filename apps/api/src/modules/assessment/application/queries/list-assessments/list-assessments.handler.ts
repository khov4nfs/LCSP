import { HttpStatus, Inject } from "@nestjs/common";
import type { IQueryHandler } from "@nestjs/cqrs";
import { QueryHandler } from "@nestjs/cqrs";

import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type {
  AssessmentListDto,
  AssessmentSummary,
} from "../../contracts/assessment/assessment-list.contract.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentListCriteria,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import { ListAssessmentsQuery } from "./list-assessments.query.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Produces the caller-visible assessment list with fail-closed RBAC scope filtering.
 */
@QueryHandler(ListAssessmentsQuery)
export class ListAssessmentsHandler implements IQueryHandler<ListAssessmentsQuery> {
  /**
   * Creates the list handler with assessment persistence access.
   *
   * @param assessmentRepository - Repository used for paginated assessment filtering.
   */
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessmentRepository: AssessmentRepository,
  ) {}

  /**
   * Validates pagination/status filters, applies role-aware visibility, and returns enriched assessment summaries.
   *
   * @param query - User role, pagination, status, and correlation context for the list request.
   * @returns Paginated assessment summaries visible to the caller.
   * @throws An invalid-request problem when an unknown assessment status is supplied.
   */
  async execute(query: ListAssessmentsQuery): Promise<AssessmentListDto> {
    const page = Math.max(DEFAULT_PAGE, query.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    let status: AssessmentListCriteria["status"];
    if (query.status) {
      if (!isKnownStatus(query.status)) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.invalidRequest,
          query.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      status = query.status;
    }

    const emptyResult = (): AssessmentListDto => ({
      assessments: [],
      total: 0,
      page,
      page_size: pageSize,
      correlationId: query.correlationId,
    });

    if (query.subjectRole !== AUTH_USER_ROLES.customer) {
      return emptyResult();
    }

    const criteria: AssessmentListCriteria = {
      status,
      page,
      pageSize,
      ownerId: query.sessionUserId,
    };

    const { items, total } = await this.assessmentRepository.findMany(criteria);

    if (items.length === 0) {
      return emptyResult();
    }

    const assessments: AssessmentSummary[] = items.map((item) => ({
      assessment_id: item.id,
      name: item.name,
      status: item.status,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
    }));

    return {
      assessments,
      total,
      page,
      page_size: pageSize,
      correlationId: query.correlationId,
    };
  }
}

/**
 * Checks whether a requested assessment status is part of the supported contract enum.
 *
 * @param status - Raw status filter supplied by the caller.
 * @returns True when the status matches a known assessment status code.
 */
function isKnownStatus(
  status: string,
): status is (typeof ASSESSMENT_STATUS_CODES)[keyof typeof ASSESSMENT_STATUS_CODES] {
  return Object.values(ASSESSMENT_STATUS_CODES).some(
    (knownStatus) => knownStatus === status,
  );
}
