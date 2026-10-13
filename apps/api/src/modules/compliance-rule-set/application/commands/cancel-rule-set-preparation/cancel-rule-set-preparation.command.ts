import { Command } from "@nestjs/cqrs";
import type { RuleSetPreparationRun } from "@lcsp/contracts/compliance-rule-set";

export class CancelRuleSetPreparationCommand extends Command<RuleSetPreparationRun> {
  constructor(
    public readonly preparationRunId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
