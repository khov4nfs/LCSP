import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { workspaceAssessmentSnapshotSchema } from "@lcsp/contracts/evidence";
import {
  Controller,
  Sse,
  Req,
  UseGuards,
  HttpException,
  type MessageEvent,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import {
  interval,
  startWith,
  exhaustMap,
  defer,
  map,
  catchError,
  of,
} from "rxjs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import {
  internalServerProblem,
  isProblemResult,
} from "../../../../platform/http/filters/error.factory.js";
import { GetWorkspaceRuntimeQuery } from "../../application/queries/get-workspace-runtime/get-workspace-runtime.query.js";

@Controller("workspace/runtime-events")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
export class WorkspaceRuntimeEventsController {
  constructor(private readonly queries: QueryBus) {}
  @Sse()
  stream(@Req() request: AuthenticatedRequest) {
    const actor = request.rbacContext;
    const ownerId =
      actor.role === AUTH_USER_ROLES.customer
        ? actor.userId
        : `no-assessment-owner:${actor.userId}`;
    const correlationId = request.correlationId ?? "";
    return interval(2000).pipe(
      startWith(0),
      exhaustMap(() =>
        defer(() =>
          this.queries.execute(
            new GetWorkspaceRuntimeQuery(ownerId, correlationId),
          ),
        ).pipe(
          map((data): MessageEvent => ({
            type: "workspace.runtime",
            data: workspaceAssessmentSnapshotSchema.parse({
              emitted_at: data.emittedAt,
              canonical_assessments: data.canonicalAssessments,
              canonical_events: data.canonicalEvents,
            }),
          })),
        ),
      ),
      catchError((error: unknown) => {
        const response =
          error instanceof HttpException ? error.getResponse() : error;
        return of<MessageEvent>({
          type: "error",
          data: isProblemResult(response)
            ? {
                ok: false,
                problem: {
                  ...response.problem,
                  correlationId:
                    response.problem.correlationId || correlationId,
                },
              }
            : internalServerProblem(correlationId),
        });
      }),
    );
  }
}
