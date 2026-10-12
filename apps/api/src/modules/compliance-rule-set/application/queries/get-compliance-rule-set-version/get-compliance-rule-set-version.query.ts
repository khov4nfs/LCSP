import type { ComplianceRuleSetReadModel } from "@lcsp/contracts/compliance-rule-set";
import { Query } from "@nestjs/cqrs";

export class GetComplianceRuleSetVersionQuery extends Query<ComplianceRuleSetReadModel> {
  constructor(
    public readonly ruleSetVersionId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
