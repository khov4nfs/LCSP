import type { LegalPortfolioReadModel } from "@lcsp/contracts/legal-portfolio";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { ArtifactLifecycleState as PrismaArtifactLifecycleState } from "@prisma/client";

import { LegalPortfolioReadModelLoader } from "../../../infrastructure/persistence/legal-portfolio-read-model.service.js";
import { GetLegalPortfolioVersionQuery } from "./get-legal-portfolio-version.query.js";

/**
 * One immutable portfolio version by identity, for an assessment's pin. SUPERSEDED versions
 * stay readable because existing assessments remain pinned to their as-of legal basis.
 */
@QueryHandler(GetLegalPortfolioVersionQuery)
export class GetLegalPortfolioVersionHandler implements IQueryHandler<GetLegalPortfolioVersionQuery> {
  constructor(private readonly readModel: LegalPortfolioReadModelLoader) {}

  execute(
    input: GetLegalPortfolioVersionQuery,
  ): Promise<LegalPortfolioReadModel> {
    return this.readModel.load(
      {
        id: input.portfolioVersionId,
        lifecycleState: {
          in: [
            PrismaArtifactLifecycleState.ACTIVE,
            PrismaArtifactLifecycleState.SUPERSEDED,
          ],
        },
      },
      input.correlationId,
    );
  }
}
