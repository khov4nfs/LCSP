import type { RuleSetPreparationRun } from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

/** Operator retry of one FAILED Rule Set Preparation run of the same Legal Source Version. */
export class RetryRuleSetPreparationCommand extends Command<RuleSetPreparationRun> {
  constructor(
    public readonly preparationRunId: string,
    public readonly requestedBy: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
