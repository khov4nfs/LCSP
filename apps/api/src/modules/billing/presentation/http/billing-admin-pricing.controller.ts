import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ERROR_CODES,
  adminModelPricingOverviewQuerySchema,
  billingResourceIdSchema,
  createModelTariffDraftSchema,
  previewModelPricingSchema,
  publishModelTariffDraftSchema,
  supersedeModelTariffAssignmentSchema,
  updateModelTariffDraftSchema,
  type AdminModelPricingOverviewQuery,
  type CreateModelTariffDraftInput,
  type PreviewModelPricingInput,
  type PublishModelTariffDraftInput,
  type SupersedeModelTariffAssignmentInput,
  type UpdateModelTariffDraftInput,
} from "@lcsp/contracts/billing";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { CreateModelTariffDraftCommand } from "../../application/commands/create-model-tariff-draft/create-model-tariff-draft.command.js";
import { PublishModelTariffDraftCommand } from "../../application/commands/publish-model-tariff-draft/publish-model-tariff-draft.command.js";
import { SupersedeModelTariffAssignmentCommand } from "../../application/commands/supersede-model-tariff-assignment/supersede-model-tariff-assignment.command.js";
import { UpdateModelTariffDraftCommand } from "../../application/commands/update-model-tariff-draft/update-model-tariff-draft.command.js";
import { GetModelPricingOverviewQuery } from "../../application/queries/get-model-pricing-overview/get-model-pricing-overview.query.js";
import { GetModelTariffDraftQuery } from "../../application/queries/get-model-tariff-draft/get-model-tariff-draft.query.js";
import { GetModelTariffSnapshotQuery } from "../../application/queries/get-model-tariff-snapshot/get-model-tariff-snapshot.query.js";
import { PreviewModelPricingQuery } from "../../application/queries/preview-model-pricing/preview-model-pricing.query.js";
import { mapModelPricingError } from "./errors/billing-http.error-mapper.js";

/**
 * Controller exposing administrative endpoints for model pricing tariff drafts, published snapshots,
 * interval assignments, and token calculation previews.
 */
// Rationale ("Why"): Provides Admin-only HTTP interface to manage pricing drafts, snapshots, assignments, and token previews.
// Mechanism ("How"): Guarded by RbacGuard with AUTH_USER_ROLES.admin. Validates all inputs via Zod pipes and dispatches CQRS commands/queries.
// Invariants & Constraints: Wrapped in Result Envelope { ok: true, data }, actorId derived from rbacContext, errors mapped via mapModelPricingError.
@Controller("admin/billing/model-pricing")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class BillingAdminPricingController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Business purpose: Retrieve complete administrative model pricing overview including active coverage, allowlist, drafts, snapshots, and assignments.
   *
   * Business rules:
   * - Only authenticated ADMIN users may access pricing overview.
   * - Respects optional filter parameters for provider, resolvedModel, scope, and status.
   *
   * Execution flow:
   * 1. Validate query parameters using Zod pipe.
   * 2. Dispatch GetModelPricingOverviewQuery to QueryBus.
   * 3. Wrap response in Result Envelope { ok: true, data }.
   *
   * Failure cases:
   * - 401 Unauthorized if unauthenticated.
   * - 403 Forbidden if non-admin user.
   * - 400 Bad Request if query params fail validation.
   *
   * Side effects:
   * - Read-only query; no database mutations.
   */
  // Rationale ("Why"): Allows administrators to monitor active coverage, allowlist models, and tariff version histories.
  // Mechanism ("How"): Queries read models via GetModelPricingOverviewQuery.
  // Invariants & Constraints: Read-only; preserves fail-closed posture.
  @Get()
  async getOverview(
    @Query(
      new ZodValidationPipe(
        adminModelPricingOverviewQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: AdminModelPricingOverviewQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const data = await this.queryBus.execute(
        new GetModelPricingOverviewQuery(query),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }

  /**
   * Business purpose: Retrieve a specific mutable customer model tariff draft by its identifier.
   *
   * Business rules:
   * - Only authenticated ADMIN users may view draft details.
   * - Returns 404 if draft does not exist.
   *
   * Execution flow:
   * 1. Extract draft ID from route parameter.
   * 2. Dispatch GetModelTariffDraftQuery.
   * 3. Wrap response in Result Envelope { ok: true, data }.
   *
   * Failure cases:
   * - 401 Unauthorized if unauthenticated.
   * - 403 Forbidden if non-admin.
   * - 404 Not Found if draft does not exist.
   *
   * Side effects:
   * - Pure read-only query.
   */
  // Rationale ("Why"): Enables inspection of draft details before publication.
  // Mechanism ("How"): Dispatches GetModelTariffDraftQuery with requested draft ID.
  // Invariants & Constraints: Read-only.
  @Get("drafts/:id")
  async getDraft(
    @Param(
      "id",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const data = await this.queryBus.execute(
        new GetModelTariffDraftQuery(id),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }

  /**
   * Business purpose: Retrieve an immutable historical customer model tariff snapshot by identifier.
   *
   * Business rules:
   * - Only authenticated ADMIN users may view snapshots.
   * - Returns 404 if snapshot does not exist.
   *
   * Execution flow:
   * 1. Extract snapshot ID from route parameter.
   * 2. Dispatch GetModelTariffSnapshotQuery.
   * 3. Wrap response in Result Envelope { ok: true, data }.
   *
   * Failure cases:
   * - 401 Unauthorized if unauthenticated.
   * - 403 Forbidden if non-admin.
   * - 404 Not Found if snapshot does not exist.
   *
   * Side effects:
   * - Pure read-only query.
   */
  // Rationale ("Why"): Enables audit trail inspection of historical published snapshots.
  // Mechanism ("How"): Dispatches GetModelTariffSnapshotQuery with snapshot ID.
  // Invariants & Constraints: Read-only; snapshot records are immutable.
  @Get("snapshots/:id")
  async getSnapshot(
    @Param(
      "id",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const data = await this.queryBus.execute(
        new GetModelTariffSnapshotQuery(id),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }

  /**
   * Business purpose: Create a new mutable customer model tariff draft in DRAFT status.
   *
   * Business rules:
   * - Only authenticated ADMIN users may create drafts.
   * - Rates must be non-negative integers; policies must be valid token bucket policies.
   * - Scope key is normalized and verified against allowlist when scope is EXACT_MODEL.
   *
   * Execution flow:
   * 1. Validate body with Zod pipe.
   * 2. Extract actorId from rbacContext and correlationId from request.
   * 3. Dispatch CreateModelTariffDraftCommand.
   * 4. Wrap created draft view in Result Envelope with HTTP 201.
   *
   * Failure cases:
   * - 401 Unauthorized / 403 Forbidden for auth failures.
   * - 400 Bad Request for validation failures.
   * - 422 Unprocessable Entity if rates are incomplete or model unlisted.
   *
   * Side effects:
   * - Inserts new CustomerModelTariffDraft row in database.
   */
  // Rationale ("Why"): Allows authoring of proposed tariff rates before atomic publication.
  // Mechanism ("How"): Validates input and dispatches CreateModelTariffDraftCommand.
  // Invariants & Constraints: Draft status set to DRAFT; actorId extracted securely from rbacContext.
  @Post("drafts")
  @HttpCode(HttpStatus.CREATED)
  async createDraft(
    @Body(
      new ZodValidationPipe(
        createModelTariffDraftSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: CreateModelTariffDraftInput,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const actorId = req.rbacContext.userId;
      const correlationId = req.correlationId ?? "billing-pricing-request";
      const data = await this.commandBus.execute(
        new CreateModelTariffDraftCommand({
          ...body,
          actorId,
          correlationId,
        }),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }

  /**
   * Business purpose: Update an existing mutable customer model tariff draft with optimistic version check.
   *
   * Business rules:
   * - Only authenticated ADMIN users may update drafts.
   * - Draft must be in DRAFT status; published drafts cannot be modified.
   * - expectedVersion must match current draft version (optimistic locking).
   *
   * Execution flow:
   * 1. Validate patch payload with Zod pipe.
   * 2. Extract actorId and correlationId.
   * 3. Dispatch UpdateModelTariffDraftCommand.
   * 4. Wrap updated draft view in Result Envelope with HTTP 200.
   *
   * Failure cases:
   * - 401 Unauthorized / 403 Forbidden.
   * - 404 Not Found if draft does not exist.
   * - 409 Conflict if expectedVersion is stale or draft already published.
   *
   * Side effects:
   * - Updates CustomerModelTariffDraft row and increments version in database.
   */
  // Rationale ("Why"): Allows modifying rate parameters and assumptions of uncommitted drafts.
  // Mechanism ("How"): Dispatches UpdateModelTariffDraftCommand with optimistic version guard.
  // Invariants & Constraints: Immutable snapshots never modified; optimistic concurrency enforced.
  @Patch("drafts/:id")
  async updateDraft(
    @Param(
      "id",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    id: string,
    @Body(
      new ZodValidationPipe(
        updateModelTariffDraftSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: UpdateModelTariffDraftInput,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const actorId = req.rbacContext.userId;
      const correlationId = req.correlationId ?? "billing-pricing-request";
      const data = await this.commandBus.execute(
        new UpdateModelTariffDraftCommand({
          ...body,
          draftId: id,
          actorId,
          correlationId,
        }),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }

  /**
   * Business purpose: Preview token microcredit charges using exact integer calculation without mutating state.
   *
   * Business rules:
   * - Only authenticated ADMIN users may run pricing previews.
   * - Uses identical ModelPricingCalculatorService as runtime settlement.
   * - Model must be in runtime allowlist; fails closed if unlisted or no coverage.
   *
   * Execution flow:
   * 1. Validate preview input with Zod pipe.
   * 2. Dispatch PreviewModelPricingQuery.
   * 3. Wrap calculation result in Result Envelope with HTTP 200.
   *
   * Failure cases:
   * - 401 / 403 for auth failures.
   * - 422 Unprocessable Entity if model is unlisted or coverage missing.
   *
   * Side effects:
   * - Pure calculation query; no side effects.
   */
  // Rationale ("Why"): Gives admins immediate, authoritative preview of charges using identical integer math as billing settlement.
  // Mechanism ("How"): Dispatches PreviewModelPricingQuery.
  // Invariants & Constraints: Zero floating-point math; fails closed on unlisted models.
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  async preview(
    @Body(
      new ZodValidationPipe(
        previewModelPricingSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: PreviewModelPricingInput,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const data = await this.queryBus.execute(
        new PreviewModelPricingQuery(body),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }

  /**
   * Business purpose: Atomically publish a draft into an immutable snapshot, interval assignment, and audit event.
   *
   * Business rules:
   * - Only authenticated ADMIN users may publish drafts.
   * - Requires idempotencyKey, requestFingerprint, and auditReason.
   * - Draft must be in DRAFT status with matching expectedDraftVersion.
   * - Creates immutable CustomerModelTariffSnapshot and CustomerModelTariffAssignment [effectiveFrom, effectiveTo).
   * - Overlapping intervals for same normalized scope are blocked at DB constraint boundary.
   *
   * Execution flow:
   * 1. Validate payload with Zod pipe.
   * 2. Extract actorId and correlationId.
   * 3. Dispatch PublishModelTariffDraftCommand.
   * 4. Wrap publish response in Result Envelope with HTTP 201.
   *
   * Failure cases:
   * - 401 / 403 for auth failures.
   * - 409 Conflict for idempotency conflict, stale draft version, or interval overlap.
   *
   * Side effects:
   * - Atomically persists snapshot, assignment, marks draft PUBLISHED, and logs AuditEvent.
   */
  // Rationale ("Why"): Commits draft rates into immutable pricing authority with full traceability.
  // Mechanism ("How"): Dispatches PublishModelTariffDraftCommand inside serializable/isolated transaction.
  // Invariants & Constraints: Idempotency enforced via fingerprint; snapshots immutable once published.
  @Post("drafts/:id/publish")
  @HttpCode(HttpStatus.CREATED)
  async publishDraft(
    @Param(
      "id",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    id: string,
    @Body(
      new ZodValidationPipe(
        publishModelTariffDraftSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: PublishModelTariffDraftInput,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const actorId = req.rbacContext.userId;
      const correlationId = req.correlationId ?? "billing-pricing-request";
      const data = await this.commandBus.execute(
        new PublishModelTariffDraftCommand({
          ...body,
          draftId: id,
          actorId,
          correlationId,
        }),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }

  /**
   * Business purpose: Supersede an active or scheduled assignment with a new replacement assignment without mutating historical snapshots.
   *
   * Business rules:
   * - Only authenticated ADMIN users may supersede assignments.
   * - Requires idempotencyKey, requestFingerprint, and auditReason.
   * - Closes superseded assignment interval at replacement effectiveFrom.
   * - Never mutates or overwrites historical CustomerModelTariffSnapshot rows.
   *
   * Execution flow:
   * 1. Validate payload with Zod pipe.
   * 2. Extract actorId and correlationId.
   * 3. Dispatch SupersedeModelTariffAssignmentCommand.
   * 4. Wrap supersede response in Result Envelope with HTTP 201.
   *
   * Failure cases:
   * - 401 / 403 for auth failures.
   * - 409 Conflict for idempotency collision or interval overlap.
   *
   * Side effects:
   * - Updates superseded assignment effectiveTo and supersededByAssignmentId, creates replacement assignment, logs AuditEvent.
   */
  // Rationale ("Why"): Transitions active pricing to new rates without corrupting historical billing auditability.
  // Mechanism ("How"): Dispatches SupersedeModelTariffAssignmentCommand to adjust intervals atomically.
  // Invariants & Constraints: Historical snapshots remain untouched; audit reason recorded.
  @Post("assignments/:id/supersede")
  @HttpCode(HttpStatus.CREATED)
  async supersedeAssignment(
    @Param(
      "id",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    id: string,
    @Body(
      new ZodValidationPipe(
        supersedeModelTariffAssignmentSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: SupersedeModelTariffAssignmentInput,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const actorId = req.rbacContext.userId;
      const correlationId = req.correlationId ?? "billing-pricing-request";
      const data = await this.commandBus.execute(
        new SupersedeModelTariffAssignmentCommand({
          ...body,
          assignmentId: id,
          actorId,
          correlationId,
        }),
      );
      return resultEnvelope(data);
    } catch (error) {
      mapModelPricingError(error, req);
    }
  }
}
