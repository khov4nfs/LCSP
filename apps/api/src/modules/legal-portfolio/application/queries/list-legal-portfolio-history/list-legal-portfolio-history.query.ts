import { Query } from "@nestjs/cqrs";
import type { LegalPortfolioHistory } from "@lcsp/contracts/legal-portfolio";
export class ListLegalPortfolioHistoryQuery extends Query<LegalPortfolioHistory> {}
