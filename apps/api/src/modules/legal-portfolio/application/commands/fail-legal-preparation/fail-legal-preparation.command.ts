import type {
  LegalPreparationFailRequest,
  LegalPreparationRun,
} from "@lcsp/contracts/legal-portfolio";
import { Command } from "@nestjs/cqrs";

export class FailLegalPreparationCommand extends Command<LegalPreparationRun> {
  constructor(
    public readonly request: LegalPreparationFailRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
