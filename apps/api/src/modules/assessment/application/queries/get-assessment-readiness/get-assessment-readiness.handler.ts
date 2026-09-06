import { HttpStatus, Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_MISSING_EVIDENCE_CODES,
  ASSESSMENT_NEXT_ACTION_KEYS,
  READINESS_MODES,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { REPOSITORY_CONNECTION_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaEvidenceAcceptanceStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import type { AssessmentReadinessStatusDto } from "../../contracts/assessment/readiness-status.contract.js";
import { GetAssessmentReadinessQuery } from "./get-assessment-readiness.query.js";

@QueryHandler(GetAssessmentReadinessQuery)
export class GetAssessmentReadinessHandler implements IQueryHandler<GetAssessmentReadinessQuery> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    query: GetAssessmentReadinessQuery,
  ): Promise<AssessmentReadinessStatusDto> {
    const assessment = await this.assessments.findById(query.assessmentId);
    if (
      !assessment ||
      query.subjectRole !== AUTH_USER_ROLES.customer ||
      assessment.ownerId !== query.sessionUserId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const [connection, acceptedEvidence] = await Promise.all([
      this.prisma.repositoryConnection.findFirst({
        where: {
          assessmentId: assessment.id,
          userId: query.sessionUserId,
          status: REPOSITORY_CONNECTION_STATUSES.active,
        },
        orderBy: { connectedAt: "desc" },
        select: {
          id: true,
          provider: true,
          repositoryId: true,
          repositoryFullName: true,
          defaultBranch: true,
          status: true,
        },
      }),
      this.prisma.technicalEvidenceReport.findFirst({
        where: {
          assessmentId: assessment.id,
          status: toPrismaEvidenceAcceptanceStatus(
            TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
          ),
        },
        select: { id: true },
      }),
    ]);

    return {
      classification_locked: acceptedEvidence === null,
      missing_evidence:
        acceptedEvidence === null
          ? [
              {
                type: ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
                label:
                  ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
                description:
                  ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
              },
            ]
          : [],
      unresolved_unknown_items: [],
      readiness_mode: READINESS_MODES.selfDeclared,
      completed_steps: connection ? ["repository_setup"] : [],
      next_action: ASSESSMENT_NEXT_ACTION_KEYS.workflowRun,
      updated_at: assessment.updatedAt.toISOString(),
      repository_connection: connection
        ? {
            connection_id: connection.id,
            provider: String(connection.provider),
            repository_id: connection.repositoryId,
            repository_full_name: connection.repositoryFullName,
            default_branch: connection.defaultBranch,
            status: String(connection.status),
          }
        : null,
    };
  }
}
