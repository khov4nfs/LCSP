import type { LegalPortfolioReadModel } from "@lcsp/contracts/legal-portfolio";
import { Query } from "@nestjs/cqrs";

export class GetLegalPortfolioVersionQuery extends Query<LegalPortfolioReadModel> {
  constructor(
    public readonly portfolioVersionId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
