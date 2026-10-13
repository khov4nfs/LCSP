import type { RuleSetPreparationRun } from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class PrepareCurrentRuleSetCommand extends Command<RuleSetPreparationRun> {
  constructor(
    public readonly requestedBy: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
