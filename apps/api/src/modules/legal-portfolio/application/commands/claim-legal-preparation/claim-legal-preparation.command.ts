import type {
  LegalPreparationClaimRequest,
  LegalPreparationCorpusBundle,
} from "@lcsp/contracts/legal-portfolio";
import { Command } from "@nestjs/cqrs";

export class ClaimLegalPreparationCommand extends Command<LegalPreparationCorpusBundle> {
  constructor(
    public readonly request: LegalPreparationClaimRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
