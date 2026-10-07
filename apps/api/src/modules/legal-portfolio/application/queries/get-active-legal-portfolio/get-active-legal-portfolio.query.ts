import type { LegalPortfolioReadModel } from "@lcsp/contracts/legal-portfolio";
import { Query } from "@nestjs/cqrs";

export class GetActiveLegalPortfolioQuery extends Query<LegalPortfolioReadModel> {
  constructor(public readonly correlationId: string) {
    super();
  }
}
