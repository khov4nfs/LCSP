import type { LegalPortfolioReadModel } from "@lcsp/contracts/legal-portfolio";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { ArtifactLifecycleState as PrismaArtifactLifecycleState } from "@prisma/client";

import { LegalPortfolioReadModelLoader } from "../../../infrastructure/persistence/legal-portfolio-read-model.service.js";
import { GetActiveLegalPortfolioQuery } from "./get-active-legal-portfolio.query.js";

/** The single runtime reader: the explicit ACTIVE portfolio, never "latest by date". */
@QueryHandler(GetActiveLegalPortfolioQuery)
export class GetActiveLegalPortfolioHandler implements IQueryHandler<GetActiveLegalPortfolioQuery> {
  constructor(private readonly readModel: LegalPortfolioReadModelLoader) {}

  execute(
    input: GetActiveLegalPortfolioQuery,
  ): Promise<LegalPortfolioReadModel> {
    return this.readModel.load(
      { lifecycleState: PrismaArtifactLifecycleState.ACTIVE },
      input.correlationId,
    );
  }
}
