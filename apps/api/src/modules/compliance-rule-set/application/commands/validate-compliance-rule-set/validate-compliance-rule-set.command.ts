import type {
  ComplianceRuleSetValidateRequest,
  ComplianceRuleSetValidateResult,
} from "@lcsp/contracts/compliance-rule-set";
import { Command } from "@nestjs/cqrs";

export class ValidateComplianceRuleSetCommand extends Command<ComplianceRuleSetValidateResult> {
  constructor(
    public readonly request: ComplianceRuleSetValidateRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
