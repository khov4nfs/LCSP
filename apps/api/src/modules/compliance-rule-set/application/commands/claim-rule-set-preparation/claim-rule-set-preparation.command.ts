import type {
  RuleSetPreparationClaimRequest,
  RuleSetPreparationLegalSourceBundle,
} from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class ClaimRuleSetPreparationCommand extends Command<RuleSetPreparationLegalSourceBundle> {
  constructor(
    public readonly request: RuleSetPreparationClaimRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
