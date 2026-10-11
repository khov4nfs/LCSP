import type { ComplianceRuleSetReadModel } from "@lcsp/contracts/compliance-rule-set";
import { Query } from "@nestjs/cqrs";

export class GetPinnedRuleSetQuery extends Query<ComplianceRuleSetReadModel> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
