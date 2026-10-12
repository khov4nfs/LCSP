import { Query } from "@nestjs/cqrs";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";
import type { AssessmentRuntimeControlResult } from "@lcsp/contracts/evidence";
export class GetRuntimeControlQuery extends Query<AssessmentRuntimeControlResult | null> {
  constructor(
    public readonly assessmentId: string,
    public readonly actor: RbacRequestContext,
    public readonly correlationId: string,
  ) {
    super();
  }
}
