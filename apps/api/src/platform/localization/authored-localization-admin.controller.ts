import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  authoredSourceReviewSchema,
  authoredOutputReviewSchema,
  AUTHORED_LOCALIZATION_CODES,
} from "@lcsp/contracts/assessment-domain";
import type { z } from "zod";
import { RbacGuard } from "../rbac/rbac.guard.js";
import { RequireRoles } from "../rbac/decorators/require-roles.decorator.js";
import type { AuthenticatedRequest } from "../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../http/filters/error.factory.js";
import { AuthoredLocalizationService } from "./authored-localization.service.js";

@Controller("admin/localization/:scopeId")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class AuthoredLocalizationAdminController {
  constructor(private readonly localization: AuthoredLocalizationService) {}

  /**
   * Business purpose: Expose bounded field-level evidence for authorized localization review.
   * Business rules:
   * - Only authenticated administrators may inspect the explicit scope; the cursor is a request UUID.
   * Execution flow:
   * 1. Page persisted jobs and their candidate/review evidence through the shared envelope.
   * Failure cases:
   * - Invalid identifiers or failed authorization reject before evidence access.
   * Side effects:
   * - Reads durable localization work only, without provider invocation.
   */
  @Get()
  list(@Param("scopeId") scopeId: string, @Query("after") after?: string) {
    return this.localization.reviewQueue(scopeId, after).then(resultEnvelope);
  }

  /**
   * Business purpose: Record an administrator's source-language determination for exact original bytes.
   * Business rules:
   * - Validated revision/hash bindings and authenticated reviewer identity are mandatory.
   * Execution flow:
   * 1. Validate the declaration and dispatch the transactional review with server-owned actor identity.
   * Failure cases:
   * - Foreign scope, stale bytes and conflicting provenance reject without changing canonical content.
   * Side effects:
   * - Appends durable source review evidence and releases eligible translation work.
   */
  @Post(":requestId/source-review")
  source(
    @Param("scopeId") scopeId: string,
    @Param("requestId", new ParseUUIDPipe()) id: string,
    @Body(
      new ZodValidationPipe(
        authoredSourceReviewSchema,
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
      ),
    )
    body: z.infer<typeof authoredSourceReviewSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.localization
      .reviewSource(scopeId, id, body, req.rbacContext.userId)
      .then(resultEnvelope);
  }

  /**
   * Business purpose: Authorize a reviewed target-language representation or explicit normalization.
   * Business rules:
   * - Approval binds exact output/original hashes and the server-authenticated reviewer; canonical bytes remain immutable.
   * Execution flow:
   * 1. Validate confirmation and delegate the atomic review/publication operation.
   * Failure cases:
   * - Stale candidates, unauthorized users and inconsistent bindings cannot publish READY revisions.
   * Side effects:
   * - Appends review evidence and publishes an immutable localized revision.
   */
  @Post(":requestId/output-review")
  output(
    @Param("scopeId") scopeId: string,
    @Param("requestId", new ParseUUIDPipe()) id: string,
    @Body(
      new ZodValidationPipe(
        authoredOutputReviewSchema,
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
      ),
    )
    body: z.infer<typeof authoredOutputReviewSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.localization
      .reviewOutput(scopeId, id, body, req.rbacContext.userId)
      .then(resultEnvelope);
  }
}
