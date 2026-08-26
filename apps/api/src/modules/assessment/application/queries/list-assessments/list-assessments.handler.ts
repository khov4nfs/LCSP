import { HttpStatus, Inject } from "@nestjs/common";
import type { IQueryHandler } from "@nestjs/cqrs";
import { QueryHandler } from "@nestjs/cqrs";

import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { fromPrismaWizardStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { WizardStatus } from "../../contracts/assessment/assessment-detail.contract.js";
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
 * Produces the caller-visible assessment list with fail-closed RBAC scope filtering and wizard-status enrichment.
 */
@QueryHandler(ListAssessmentsQuery)
export class ListAssessmentsHandler implements IQueryHandler<ListAssessmentsQuery> {
  /**
   * Creates the list handler with assessment persistence and wizard-profile access.
   *
   * @param assessmentRepository - Repository used for paginated assessment filtering.
   * @param prisma - Prisma service used to load wizard status for returned assessments.
   */
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessmentRepository: AssessmentRepository,
    private readonly prisma: PrismaService,
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

    const wizardStatuses = await this.loadWizardStatuses(
      items.map((item) => item.id),
    );

    const assessments: AssessmentSummary[] = items.map((item) => ({
      assessment_id: item.id,
      name: item.name,
      status: item.status,
      wizard_status:
        wizardStatuses.get(item.id) ?? WIZARD_STATUS_CODES.notStarted,
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

  /**
   * Loads wizard status for a returned assessment page in one query.
   *
   * @param assessmentIds - Assessment identifiers whose wizard statuses should be resolved.
   * @returns Map from assessment identifier to normalized wizard status.
   */
  private async loadWizardStatuses(
    assessmentIds: string[],
  ): Promise<Map<string, WizardStatus>> {
    const rows = await this.prisma.wizardProfile.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { assessmentId: true, status: true },
    });

    return new Map(
      rows.map((row) => [row.assessmentId, fromPrismaWizardStatus(row.status)]),
    );
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
