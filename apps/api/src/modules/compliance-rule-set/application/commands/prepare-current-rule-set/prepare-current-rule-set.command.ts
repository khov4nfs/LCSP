import type { RuleSetPreparationRun } from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class PrepareCurrentRuleSetCommand extends Command<RuleSetPreparationRun> {
  constructor(
    public readonly requestedBy: string,
    public readonly correlationId: string,
    /** Explicit intent to author a new version that supersedes the ACTIVE one on activation. */
    public readonly replaceActive = false,
    /** The version the operator selected; the request is refused when it is no longer the active one. */
    public readonly expectedLegalSourceVersionId?: string,
  ) {
    super();
  }
}
