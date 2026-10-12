import type {
  RuleSetPreparationRun,
  RuleSetPreparationStartRequest,
} from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class StartRuleSetPreparationCommand extends Command<RuleSetPreparationRun> {
  constructor(
    public readonly request: RuleSetPreparationStartRequest,
    public readonly requestedBy: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
