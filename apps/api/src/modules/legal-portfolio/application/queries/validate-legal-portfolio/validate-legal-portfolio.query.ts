import type {
  LegalPortfolioValidateRequest,
  LegalPortfolioValidateResult,
} from "@lcsp/contracts/legal-portfolio";
import { Query } from "@nestjs/cqrs";

export class ValidateLegalPortfolioQuery extends Query<LegalPortfolioValidateResult> {
  constructor(
    public readonly request: LegalPortfolioValidateRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
