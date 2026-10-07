import type { LegalPortfolioReadModel } from "@lcsp/contracts/legal-portfolio";
import { Query } from "@nestjs/cqrs";

export class GetPinnedPortfolioQuery extends Query<LegalPortfolioReadModel> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
