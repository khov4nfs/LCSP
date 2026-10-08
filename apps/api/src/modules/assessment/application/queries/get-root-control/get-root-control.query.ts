import { Query } from "@nestjs/cqrs";
import type { AssessmentRuntimeControlResult } from "@lcsp/contracts/evidence";
export class GetRootControlQuery extends Query<AssessmentRuntimeControlResult | null> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
