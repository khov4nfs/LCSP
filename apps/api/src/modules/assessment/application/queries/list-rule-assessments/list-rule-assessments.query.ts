import { Query } from "@nestjs/cqrs";

import type { AcceptedRuleAssessment } from "@lcsp/contracts/evidence";

/** Worker read of every accepted per-rule assessment of one assessment. */
export class ListRuleAssessmentsQuery extends Query<AcceptedRuleAssessment[]> {
  constructor(
    public readonly assessmentId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
