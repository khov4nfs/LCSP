import type { StartRuleInvestigationRequest } from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export type StartRuleInvestigationResult = { resolutionState: string };

export class StartRuleInvestigationCommand extends Command<StartRuleInvestigationResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: StartRuleInvestigationRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
