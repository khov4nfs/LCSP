import type { GetRuleDecisionResult } from "@lcsp/contracts/assessment-domain";
import { Query } from "@nestjs/cqrs";

export class GetRuleDecisionQuery extends Query<GetRuleDecisionResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly assessmentRuleId: string,
    public readonly correlationId: string,
    public readonly revision?: number,
  ) {
    super();
  }
}
