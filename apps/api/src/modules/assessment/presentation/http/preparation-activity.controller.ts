import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  agentStreamEventSchema,
  preparationActivityPageSchema,
  preparationActivityQuerySchema,
} from "@lcsp/contracts/evidence";
import type { z } from "zod";
import { filter, map } from "rxjs";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { preparationActivityView } from "../../../../platform/runtime-events/preparation-activity-view.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
@Controller(
  "admin/compliance-rule-sets/preparations/:preparationRunId/activity",
)
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class PreparationActivityController {
  constructor(private readonly runtime: AssessmentRuntimeEventService) {}

  /**
   * Business purpose:
   * Stream sanitized operational activity for one Rule Set Preparation to an authorized administrator.
   *
   * Business rules:
   * - Admin RBAC and an exact Preparation UUID are mandatory.
   * - Only allowlisted Preparation activity is emitted; assessment runtime and customer content never enter this transport.
   *
   * Execution flow:
   * 1. Subscribe to durable replay plus live events scoped to the exact Preparation identity.
   * 2. Project each event through the privacy-safe Preparation activity allowlist.
   * 3. Emit validated individual SSE frames for accepted events only.
   *
   * Failure cases:
   * - Invalid UUIDs fail request validation; malformed or private events are dropped fail-closed.
   *
   * Side effects:
   * - Opens a read-only SSE subscription; no Preparation, assessment or provider state is changed.
   */
  @Sse("stream")
  stream(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
  ) {
    // A synthetic owner key matches the event-service publication boundary and
    // prevents the ADMIN stream from subscribing to any customer-owned assessment.
    return this.runtime
      .observeAgentStreamEvents(`preparation:${preparationRunId}`, {
        preparationRunId,
      })
      .pipe(
        // Re-check the authoritative boundary after subscription so an event-service
        // regression cannot multiplex assessment/customer events onto the ADMIN stream.
        filter(
          (event) =>
            event.boundaryType ===
              AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation &&
            event.preparationRunId === preparationRunId,
        ),
        map((event) => preparationActivityView(event)),
        filter((event) => event !== null),
        map((event): MessageEvent => ({
          type: "preparation.activity",
          data: agentStreamEventSchema.parse(event),
        })),
      );
  }
  /**
   * Business purpose: Expose paginated persisted Preparation activity to authorized administrators.
   * Business rules:
   * - Admin RBAC, exact run UUID and validated bounded cursor parameters are required.
   * Execution flow:
   * 1. Read the existing journal and validate its public sanitized event envelope.
   * Failure cases:
   * - Invalid identifiers/cursors, forbidden access and persistence errors reject without lifecycle changes.
   * Side effects:
   * - Read-only telemetry; no build, retry, resume or paid inference.
   */
  @Get()
  async list(
    @Param("preparationRunId", new ParseUUIDPipe()) id: string,
    @Query(
      new ZodValidationPipe(
        preparationActivityQuerySchema,
        SHARED_ERROR_CODES.validationFailed,
      ),
    )
    query: z.infer<typeof preparationActivityQuerySchema>,
  ) {
    return resultEnvelope(
      preparationActivityPageSchema.parse(
        await this.runtime.getPreparationStreamHistoryPage(id, query),
      ),
    );
  }
}
