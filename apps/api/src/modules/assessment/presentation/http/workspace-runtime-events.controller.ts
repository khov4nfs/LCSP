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
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import {
  internalServerProblem,
  isProblemResult,
} from "../../../../platform/http/filters/error.factory.js";
import { GetWorkspaceRuntimeQuery } from "../../application/queries/get-workspace-runtime/get-workspace-runtime.query.js";

@Controller("workspace/runtime-events")
@UseGuards(RbacGuard)
// This stream carries customer assessment events; ADMIN operational visibility uses metadata projections instead.
@RequireRoles(AUTH_USER_ROLES.customer)
export class WorkspaceRuntimeEventsController {
  constructor(private readonly queries: QueryBus) {}

  /**
   * Business purpose:
   * Stream canonical workspace assessment activity to the authenticated customer owner.
   *
   * Business rules:
   * - The class RBAC guard admits CUSTOMER only, and every query is scoped to that customer's user ID.
   * - Rule Set Preparation activity belongs to its dedicated ADMIN transport and is never multiplexed here.
   *
   * Execution flow:
   * 1. Poll the canonical owner-scoped workspace query at a bounded interval.
   * 2. Validate and emit lifecycle, assessment-event and sanitized agent-event snapshots.
   * 3. Convert failures to the standard problem envelope with the request correlation ID.
   *
   * Failure cases:
   * - Invalid persisted snapshots or query failures emit an error event without widening owner scope.
   *
   * Side effects:
   * - Opens a read-only SSE subscription and performs periodic database reads; no assessment state is changed.
   */
  @Sse()
  stream(@Req() request: AuthenticatedRequest) {
    const actor = request.rbacContext;
    // The class-level CUSTOMER guard makes the authenticated user the only valid owner scope.
    const ownerId = actor.userId;
    const correlationId = request.correlationId ?? "";
    return interval(2000).pipe(
      startWith(0),
      exhaustMap(() =>
        defer(() =>
          this.queries.execute(
            new GetWorkspaceRuntimeQuery(ownerId, correlationId, null),
          ),
        ).pipe(
          map((data): MessageEvent => ({
            type: "workspace.runtime",
            data: workspaceAssessmentSnapshotSchema.parse({
              emitted_at: data.emittedAt,
              canonical_assessments: data.canonicalAssessments,
              canonical_events: data.canonicalEvents,
              agent_stream_events: data.agentStreamEvents,
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
