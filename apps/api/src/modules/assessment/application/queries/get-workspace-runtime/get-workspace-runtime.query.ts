import { Query } from "@nestjs/cqrs";
import type { AssessmentRuntimeSnapshot } from "@lcsp/contracts/evidence";
export class GetWorkspaceRuntimeQuery extends Query<AssessmentRuntimeSnapshot> {
  constructor(
    public readonly ownerId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
