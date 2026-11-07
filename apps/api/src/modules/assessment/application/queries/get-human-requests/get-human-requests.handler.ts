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
  /**
   * Business purpose: Return an owner's canonical questions with every dependent rule.
   * Business rules:
   * - Ownership is verified before exposing request and case revisions.
   * Execution flow:
   * 1. Authorize the owner and read the current case revision.
   * 2. Load questions and normalized dependencies, then project them in the requested locale.
   * Failure cases:
   * - Missing or unauthorized assessments are rejected by the ownership guard.
   * Side effects:
   * - Read-only database access and localized presentation; no facts or dependencies are changed.
   */
  execute(input: GetHumanRequestsQuery) {
    return this.prisma.$transaction(async (tx) => {
      await this.support.requireOwner(tx, input);
      const current = await tx.assessmentCase.findUniqueOrThrow({
        where: { assessmentId: input.assessmentId },
      });
      const rows = await tx.assessmentHumanRequest.findMany({
        where: { assessmentId: input.assessmentId },
        orderBy: { createdAt: "asc" },
        include: { dependencies: true },
      });
      return {
        caseRevision: current.caseRevision,
        requests: await Promise.all(
          rows.map((row) => this.support.view(row, input.locale)),
        ),
      };
    });
  }
}
