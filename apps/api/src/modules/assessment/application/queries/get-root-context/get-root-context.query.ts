import type { AssessmentRootContext } from "@lcsp/contracts/assessment-domain";
import { Query } from "@nestjs/cqrs";

export class GetRootContextQuery extends Query<AssessmentRootContext> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
