import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { LegalPortfolioHistoryLoader } from "../../../infrastructure/persistence/legal-portfolio-history.loader.js";
import { ListLegalPortfolioHistoryQuery } from "./list-legal-portfolio-history.query.js";
@QueryHandler(ListLegalPortfolioHistoryQuery)
export class ListLegalPortfolioHistoryHandler implements IQueryHandler<ListLegalPortfolioHistoryQuery> {
  constructor(private readonly history: LegalPortfolioHistoryLoader) {}
  execute() {
    return this.history.load();
  }
}
