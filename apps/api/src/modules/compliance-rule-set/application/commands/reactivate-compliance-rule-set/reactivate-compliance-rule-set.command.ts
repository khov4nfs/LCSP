import { Command } from "@nestjs/cqrs";
import type {
  ComplianceRuleSetReactivationRequest,
  ComplianceRuleSetReactivationResult,
} from "@lcsp/contracts/compliance-rule-set";

export class ReactivateComplianceRuleSetCommand extends Command<ComplianceRuleSetReactivationResult> {
  constructor(
    public readonly targetRuleSetVersionId: string,
    public readonly request: ComplianceRuleSetReactivationRequest,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
