import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { GetWorkspaceRuntimeQuery } from "./get-workspace-runtime.query.js";
@QueryHandler(GetWorkspaceRuntimeQuery)
export class GetWorkspaceRuntimeHandler implements IQueryHandler<GetWorkspaceRuntimeQuery> {
  constructor(private readonly events: AssessmentRuntimeEventService) {}
  execute(query: GetWorkspaceRuntimeQuery) {
    return this.events.buildWorkspaceSnapshot(
      query.ownerId,
      query.correlationId,
    );
  }
}
