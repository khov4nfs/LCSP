import type {
  ComplianceRuleSetValidateRequest,
  ComplianceRuleSetValidateResult,
} from "@lcsp/contracts/compliance-rule-set";
import { Query } from "@nestjs/cqrs";

export class ValidateComplianceRuleSetQuery extends Query<ComplianceRuleSetValidateResult> {
  constructor(
    public readonly request: ComplianceRuleSetValidateRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
