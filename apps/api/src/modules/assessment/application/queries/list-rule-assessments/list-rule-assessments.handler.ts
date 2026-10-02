import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import type { AcceptedRuleAssessment } from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { rowToAcceptedRuleAssessment } from "../../mappers/rule-assessment.mapper.js";
import { ListRuleAssessmentsQuery } from "./list-rule-assessments.query.js";

@QueryHandler(ListRuleAssessmentsQuery)
export class ListRuleAssessmentsHandler implements IQueryHandler<ListRuleAssessmentsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    query: ListRuleAssessmentsQuery,
  ): Promise<AcceptedRuleAssessment[]> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: query.assessmentId },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const rows = await this.prisma.engineeringRuleAssessment.findMany({
      where: { assessmentId: query.assessmentId },
      orderBy: { engineeringRuleId: "asc" },
    });
    return rows.map(rowToAcceptedRuleAssessment);
  }
}
