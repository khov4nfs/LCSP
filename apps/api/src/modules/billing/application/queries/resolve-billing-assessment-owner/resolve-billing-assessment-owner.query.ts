import { Query } from "@nestjs/cqrs";

export class ResolveBillingAssessmentOwnerQuery extends Query<string> {
  constructor(public readonly assessmentId: string) {
    super();
  }
}
