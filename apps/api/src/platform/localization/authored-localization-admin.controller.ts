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
  authoredLocalizationQueueQuerySchema,
  authoredOutputReviewSchema,
  authoredBatchSourceReviewSchema,
  authoredBatchOutputReviewSchema,
  authoredCandidateActionSchema,
  AUTHORED_LOCALIZATION_CODES,
  type AuthoredLocalizationEntity,
  type AuthoredBatchSourceReview,
  type AuthoredBatchOutputReview,
  type AuthoredCandidateAction,
} from "@lcsp/contracts/assessment-domain";
import type { z } from "zod";
import { RbacGuard } from "../rbac/rbac.guard.js";
import { RequireRoles } from "../rbac/decorators/require-roles.decorator.js";
import type { AuthenticatedRequest } from "../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../http/filters/error.factory.js";
import { AuthoredLocalizationService } from "./authored-localization.service.js";

@Controller("admin/localization")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class AuthoredLocalizationAdminController {
  constructor(private readonly localization: AuthoredLocalizationService) {}

  /**
   * Business purpose: Discover operational localization backlog across scopes without requiring a caller-supplied scopeId.
   * Business rules:
   * - Only authenticated administrators may inspect backlog counts, worker/provider readiness and per-scope work queues.
   * Execution flow:
   * 1. Page distinct scopes and their derived operational counts through the shared envelope.
   * Failure cases:
   * - Invalid filters or failed authorization reject before data access.
   * Side effects:
   * - Read-only operational discovery.
   */
  @Get()
  backlog(
    @Query("afterScopeId") afterScopeId?: string,
    @Query("entityType") entityType?: AuthoredLocalizationEntity,
  ) {
    return this.localization
      .backlog(afterScopeId, entityType)
      .then(resultEnvelope);
  }

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
  @Get(":scopeId")
  list(
    @Param("scopeId") scopeId: string,
    @Query(
      new ZodValidationPipe(
        authoredLocalizationQueueQuerySchema,
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
      ),
    )
    query: z.infer<typeof authoredLocalizationQueueQuerySchema>,
  ) {
    return this.localization
      .reviewQueue(
        scopeId,
        query.after,
        100,
        query.filter,
        query.history === "true",
      )
      .then(resultEnvelope);
  }

  /**
   * Business purpose: Record bounded batch source-language determinations for up to 50 individually reviewed fields.
   * Business rules:
   * - Validated revision/hash bindings, individual-field attestation and authenticated reviewer identity are mandatory.
   * Execution flow:
   * 1. Validate the batch payload and dispatch itemized source review with server-owned actor identity.
   * Failure cases:
   * - Stale items are reported in rejectedCount/results; malformed requests fail validation.
   * Side effects:
   * - Appends durable source review evidence and releases eligible translation work.
   */
  @Post(":scopeId/batch-source-review")
  batchSource(
    @Param("scopeId") scopeId: string,
    @Body(
      new ZodValidationPipe(
        authoredBatchSourceReviewSchema,
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
      ),
    )
    body: AuthoredBatchSourceReview,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.localization
      .batchReviewSource(scopeId, body, req.rbacContext.userId)
      .then(resultEnvelope);
  }

  /**
   * Business purpose: Authorize bounded batch target-language outputs or normalizations for up to 50 reviewed fields.
   * Business rules:
   * - Validated origin/output hashes, target-language confirmation and authenticated reviewer identity are mandatory.
   * Execution flow:
   * 1. Validate the batch payload and dispatch itemized output review with server-owned actor identity.
   * Failure cases:
   * - Stale or rejected items are reported in rejectedCount/results; malformed requests fail validation.
   * Side effects:
   * - Appends review evidence and publishes immutable localized revisions for valid items.
   */
  @Post(":scopeId/batch-output-review")
  batchOutput(
    @Param("scopeId") scopeId: string,
    @Body(
      new ZodValidationPipe(
        authoredBatchOutputReviewSchema,
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
      ),
    )
    body: AuthoredBatchOutputReview,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.localization
      .batchReviewOutput(scopeId, body, req.rbacContext.userId)
      .then(resultEnvelope);
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
  @Post(":scopeId/:requestId/source-review")
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
  @Post(":scopeId/:requestId/output-review")
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

  /**
   * Business purpose: Reject an invalid candidate or trigger a controlled retry on a failed/pending localization request.
   * Business rules:
   * - Canonical bytes and accepted READY revisions are never mutated; server-authenticated reviewer identity is recorded.
   * Execution flow:
   * 1. Validate the candidate action payload and delegate to retryOrRejectCandidate.
   * Failure cases:
   * - Foreign scope, stale hashes or accepted READY revisions reject with a conflict.
   * Side effects:
   * - Appends immutable review evidence and transitions or supersedes the request.
   */
  @Post(":scopeId/:requestId/retry")
  retryOrReject(
    @Param("scopeId") scopeId: string,
    @Param("requestId", new ParseUUIDPipe()) id: string,
    @Body(
      new ZodValidationPipe(
        authoredCandidateActionSchema,
        AUTHORED_LOCALIZATION_CODES.PROVIDER_INVALID,
      ),
    )
    body: AuthoredCandidateAction,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.localization
      .retryOrRejectCandidate(scopeId, id, body, req.rbacContext.userId)
      .then(resultEnvelope);
  }
}
