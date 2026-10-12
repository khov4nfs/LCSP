import { Query } from "@nestjs/cqrs";
import type { AssessmentHumanRequestsResult } from "@lcsp/contracts/assessment-domain";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

export class GetHumanRequestsQuery extends Query<AssessmentHumanRequestsResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly actor: RbacRequestContext,
    public readonly correlationId: string,
  ) {
    super();
  }
}
