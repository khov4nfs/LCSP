import type { LegalPortfolioReadModel } from "@lcsp/contracts/legal-portfolio";
import { type IQueryHandler, QueryBus, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetLegalPortfolioVersionQuery } from "../../../../legal-portfolio/application/queries/get-legal-portfolio-version/get-legal-portfolio-version.query.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetPinnedPortfolioQuery } from "./get-pinned-portfolio.query.js";

/** The immutable portfolio version this assessment is pinned to (never "whatever is ACTIVE"). */
@QueryHandler(GetPinnedPortfolioQuery)
export class GetPinnedPortfolioHandler implements IQueryHandler<GetPinnedPortfolioQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly queryBus: QueryBus,
  ) {}

  async execute(
    input: GetPinnedPortfolioQuery,
  ): Promise<LegalPortfolioReadModel> {
    const pins = await this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      return this.support.loadPins(tx, input.assessmentId, input.correlationId);
    });
    return this.queryBus.execute(
      new GetLegalPortfolioVersionQuery(
        pins.legalPortfolioVersionId,
        input.correlationId,
      ),
    );
  }
}
