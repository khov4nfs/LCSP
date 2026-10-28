import { Query } from "@nestjs/cqrs";

export class ResolveBillingAssessmentOwnerQuery extends Query<string | null> {
  constructor(
    public readonly assessmentId?: string,
    public readonly preparationRunId?: string,
  ) {
    super();
  }
}
