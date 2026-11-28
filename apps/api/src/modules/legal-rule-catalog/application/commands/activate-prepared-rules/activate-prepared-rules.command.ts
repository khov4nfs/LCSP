import { Command } from "@nestjs/cqrs";
import type {
  LegalRuleActivationRequest,
  LegalRuleActivationResult,
} from "@lcsp/contracts/legal-rule-catalog";

// Why: The publication request must carry actor and correlation context together through the command bus.
// How: The typed command binds one catalog selection to one expected result contract.
// Invariant: The handler rechecks all pins and authorization supplied by the Admin route.
export class ActivatePreparedRulesCommand extends Command<LegalRuleActivationResult> {
  constructor(
    public readonly catalogId: string,
    public readonly request: LegalRuleActivationRequest,
    public readonly actor: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
