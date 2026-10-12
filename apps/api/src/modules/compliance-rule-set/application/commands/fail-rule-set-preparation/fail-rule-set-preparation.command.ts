import type {
  RuleSetPreparationFailRequest,
  RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class FailRuleSetPreparationCommand extends Command<RuleSetPreparationRun> {
  constructor(
    public readonly request: RuleSetPreparationFailRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
