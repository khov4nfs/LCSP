import type {
  RuleSetPreparationClaimRequest,
  RuleSetPreparationCorpusBundle,
} from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class ClaimRuleSetPreparationCommand extends Command<RuleSetPreparationCorpusBundle> {
  constructor(
    public readonly request: RuleSetPreparationClaimRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
