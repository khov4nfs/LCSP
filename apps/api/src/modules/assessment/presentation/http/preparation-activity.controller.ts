import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  preparationActivityPageSchema,
  preparationActivityQuerySchema,
} from "@lcsp/contracts/evidence";
import type { z } from "zod";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
@Controller(
  "admin/compliance-rule-sets/preparations/:preparationRunId/activity",
)
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class PreparationActivityController {
  constructor(private readonly runtime: AssessmentRuntimeEventService) {}
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
