import type {
  LegalPortfolioSubmitRequest,
  LegalPortfolioSubmitResult,
} from "@lcsp/contracts/legal-portfolio";
import { Command } from "@nestjs/cqrs";

export class SubmitLegalPortfolioCommand extends Command<LegalPortfolioSubmitResult> {
  constructor(
    public readonly request: LegalPortfolioSubmitRequest,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
