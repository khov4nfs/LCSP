import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentHumanRequestSupport } from "../../../infrastructure/persistence/assessment-human-request-support.service.js";
import { GetHumanRequestsQuery } from "./get-human-requests.query.js";

@QueryHandler(GetHumanRequestsQuery)
export class GetHumanRequestsHandler implements IQueryHandler<GetHumanRequestsQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AssessmentHumanRequestSupport,
  ) {}
  execute(input: GetHumanRequestsQuery) {
    return this.prisma.$transaction(async (tx) => {
      await this.support.requireOwner(tx, input);
      const current = await tx.assessmentCase.findUniqueOrThrow({
        where: { assessmentId: input.assessmentId },
      });
      const rows = await tx.assessmentHumanRequest.findMany({
        where: { assessmentId: input.assessmentId },
        orderBy: { createdAt: "asc" },
      });
      return {
        caseRevision: current.caseRevision,
        requests: rows.map((row) => this.support.view(row)),
      };
    });
  }
}
