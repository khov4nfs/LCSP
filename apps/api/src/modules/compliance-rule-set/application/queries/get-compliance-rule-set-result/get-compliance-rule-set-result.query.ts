import type { ComplianceRuleSetResult } from "@lcsp/contracts/compliance-rule-set";
import { Query } from "@nestjs/cqrs";

export class GetComplianceRuleSetResultQuery extends Query<ComplianceRuleSetResult> {
  constructor(
    public readonly ruleSetVersionId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
