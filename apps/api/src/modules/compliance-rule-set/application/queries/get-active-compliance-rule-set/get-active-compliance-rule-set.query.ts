import type { ComplianceRuleSetReadModel } from "@lcsp/contracts/compliance-rule-set";
import { Query } from "@nestjs/cqrs";

export class GetActiveComplianceRuleSetQuery extends Query<ComplianceRuleSetReadModel> {
  constructor(public readonly correlationId: string) {
    super();
  }
}
