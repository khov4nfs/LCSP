import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { AssessmentRuntimeControlService } from "../../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetRootControlQuery } from "./get-root-control.query.js";
@QueryHandler(GetRootControlQuery)
export class GetRootControlHandler implements IQueryHandler<GetRootControlQuery> {
  constructor(
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly controls: AssessmentRuntimeControlService,
  ) {}
  async execute(query: GetRootControlQuery) {
    const run = await this.authority.authorize({
      ...query,
      requireActive: false,
    });
    return run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE
      ? this.controls.current(query.assessmentId)
      : null;
  }
}
