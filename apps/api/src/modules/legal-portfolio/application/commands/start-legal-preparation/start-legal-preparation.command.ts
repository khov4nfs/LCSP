import type {
  LegalPreparationRun,
  LegalPreparationStartRequest,
} from "@lcsp/contracts/legal-portfolio";
import { Command } from "@nestjs/cqrs";

export class StartLegalPreparationCommand extends Command<LegalPreparationRun> {
  constructor(
    public readonly request: LegalPreparationStartRequest,
    public readonly requestedBy: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
