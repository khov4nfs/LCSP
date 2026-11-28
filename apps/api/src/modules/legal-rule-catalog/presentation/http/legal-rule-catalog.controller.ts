import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import * as C from "@lcsp/contracts/legal-rule-catalog";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { WorkerApiKeyGuard } from "../../../../platform/rbac/guards/worker-api-key.guard.js";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { LegalRuleCatalogService } from "../../application/services/legal-rule-catalog.service.js";
import { PreparationRuleService } from "../../application/services/preparation-rule.service.js";

const body = (schema: z.ZodType) =>
  new ZodValidationPipe(schema, C.LEGAL_RULE_CATALOG_ERRORS.INVALID);
// Why: Large import documents must fail before the command can reserve a DB connection.
// How: The dedicated body pipe returns the catalog's canonical 422 problem.
// Invariant: Invalid import payloads never expose Zod paths or reach the transaction.
export const importAssessmentRulesBody = new ZodValidationPipe(
  C.assessmentRuleImportRequestSchema,
  C.LEGAL_RULE_CATALOG_ERRORS.INVALID,
  HttpStatus.UNPROCESSABLE_ENTITY,
);
const uuid = () => new ParseUUIDPipe();
const correlation = (req: AuthenticatedRequest) =>
  req.correlationId || req.get("x-correlation-id")?.trim() || randomUUID();

@Controller("admin/legal-rule-catalog")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class LegalRuleCatalogController {
  constructor(
    private readonly catalog: LegalRuleCatalogService,
    private readonly preparation: PreparationRuleService,
  ) {}

  @Get()
  async catalogs() {
    return resultEnvelope(await this.catalog.catalogs());
  }

  @Post()
  async create(
    @Body(body(C.legalRuleCatalogWriteSchema))
    request: z.infer<typeof C.legalRuleCatalogWriteSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalog.create(
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: Return the server-composed eligible provision page for the LegalRule source picker.
   * Business rules:
   * - Admin authorization applies; the requested source version must pass catalog lifecycle and retrieval-index eligibility.
   * Execution flow:
   * 1. Validate bounded source/document/pagination query fields.
   * 2. Delegate full-document hierarchy resolution to the catalog service.
   * 3. Return the canonical success envelope.
   * Failure cases:
   * - Invalid query, missing document, or unavailable source is rejected through shared validation/problem handling.
   * Side effects:
   * - Reads source rows only; no catalog, chunk, or review-coverage mutation.
   */
  @Get("source-provisions")
  async sourceProvisions(
    @Query(body(C.legalRuleSourceProvisionQuerySchema))
    query: C.LegalRuleSourceProvisionQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalog.sourceProvisions(query, correlation(req)),
    );
  }

  /**
   * Business purpose: Permanently delete an idle LegalRule catalog and its associated data.
   * Business rules:
   * - Admin authorization required; cannot delete catalogs with active preparation runs.
   * Execution flow:
   * 1. Validate catalog UUID
   * 2. Delegate deletion to catalog service
   * 3. Return typed envelope result.
   * Failure cases:
   * - Missing catalog returns 404; active runs return 409 conflict.
   * Side effects:
   * - Deletes catalog and owned rules, selections and batches.
   */
  @Delete(":catalogId")
  @HttpCode(200)
  async deleteCatalog(
    @Param("catalogId", uuid()) catalogId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalog.deleteCatalog(
        catalogId,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  @Get(":catalogId/rules")
  async rules(
    @Param("catalogId", uuid()) catalogId: string,
    @Query(body(C.legalRuleListSchema)) query: C.LegalRuleList,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalog.list(catalogId, query, correlation(req)),
    );
  }

  /**
   * Business purpose: Publish an explicitly confirmed set of prepared Assessment Rules through the canonical ACTIVE Rule Set boundary.
   *
   * Business rules:
   * - Only Admin callers reach this endpoint; the service revalidates exact current result revisions, pinned source, and packet integrity.
   * - The request cannot select failed, stale, missing, or zero-rule results, and activation is never automatic after Preparation.
   *
   * Execution flow:
   * 1. Validate the catalog UUID and bounded result manifest.
   * 2. Delegate freshness, source, and packet checks to the selected-result publisher.
   * 3. Return the version and activation acknowledgement only after the transaction commits.
   *
   * Failure cases:
   * - Invalid, stale, incompatible, or source-invalid selections return shared typed problems and retain the current ACTIVE version.
   * - Audit, outbox, or persistence failures roll back publication.
   *
   * Side effects:
   * - May create one ACTIVE ComplianceRuleSetVersion with immutable selected-result provenance and supersede the prior ACTIVE version.
   */
  @Post(":catalogId/assessment-rules/activate")
  @HttpCode(200)
  async activatePreparedAssessmentRules(
    @Param("catalogId", uuid()) catalogId: string,
    @Body(body(C.legalRuleActivationRequestSchema))
    request: C.LegalRuleActivationRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.activate(
        catalogId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: Load externally authored Assessment Rules for catalog Legal Rules as prepared results without running the Preparation agent.
   * Business rules:
   * - Admin authorization applies; the document must match the catalog, its current revision and pinned source, and every item is validated like agent output.
   * - The import never activates anything; the Admin still confirms through the activation endpoint.
   * Execution flow:
   * 1. Validate the catalog UUID and the Assessment Rule Import v1 body.
   * 2. Delegate verification and all-or-nothing recording to the preparation service.
   * 3. Return the per-rule acknowledgements in the canonical envelope.
   * Failure cases:
   * - Invalid documents, stale revisions, ineligible rules, active runs and invalid output return shared typed problems and write nothing.
   * Side effects:
   * - Records prepared result revisions and audit events in one transaction; no model run, outbox message or Rule Set change.
   */
  @Post(":catalogId/assessment-rules/import")
  @HttpCode(200)
  async importAssessmentRules(
    @Param("catalogId", uuid()) catalogId: string,
    @Body(importAssessmentRulesBody)
    request: C.AssessmentRuleImportRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.importAssessmentRules(
        catalogId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: Register an exact source-backed legal scope candidate for review.
   * Business rules: Authenticated Admin only; the service owns source pins and review identity.
   * Execution flow: 1. Validate the request. 2. Delegate draft registration and return its revision/digest.
   * Failure cases: Stale or invalid scope evidence is rejected by the service.
   * Side effects: Creates or revises a draft authorization; no Preparation or model call.
   */
  @Post(":catalogId/scope-authorizations/submit")
  @HttpCode(200)
  async submitScopeAuthorization(
    @Param("catalogId", uuid()) catalogId: string,
    @Body(body(C.selectedScopeAuthorizationSubmitSchema))
    request: C.SelectedScopeAuthorizationSubmit,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.submitScopeAuthorization(
        catalogId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: List semantic review authorizations for a specific Legal Rule in a catalog.
   * Business rules: Admin-only; enables UI auto-discovery without manual 64-hex key entry.
   * Execution flow: 1. Query authorizations for (catalogId, ruleId). 2. Return wrapped list.
   * Failure cases: Invalid UUIDs reject via ValidationPipe.
   * Side effects: Read-only.
   */
  @Get(":catalogId/rules/:ruleId/scope-authorizations")
  async listRuleScopeAuthorizations(
    @Param("catalogId", uuid()) catalogId: string,
    @Param("ruleId", uuid()) ruleId: string,
  ) {
    return resultEnvelope(
      await this.preparation.listScopeAuthorizationsForRule(catalogId, ruleId),
    );
  }

  /**
   * Business purpose: Read an exact candidate and pinned source evidence for independent legal review.
   * Business rules: Admin-only; the service verifies catalog ownership and current source identity.
   * Execution flow: 1. Resolve the candidate key. 2. Return verified review evidence.
   * Failure cases: Missing or stale candidates cannot be reviewed from this endpoint.
   * Side effects: Read-only.
   */
  @Get(":catalogId/scope-authorizations/:scopeKey")
  async readScopeAuthorization(
    @Param("catalogId", uuid()) catalogId: string,
    @Param("scopeKey") scopeKey: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.readScopeAuthorization(
        catalogId,
        scopeKey,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: Approve the independently reviewed semantic candidate.
   * Business rules: Authenticated Admin only; separate reviewer and exact source/digest checks remain server-owned.
   * Execution flow: 1. Validate request. 2. Delegate approval and return persisted state.
   * Failure cases: Stale, self-approved or unsupported candidates cannot authorize publication.
   * Side effects: Persists approval and audit only.
   */
  @Post(":catalogId/scope-authorizations/approve")
  @HttpCode(200)
  async approveScopeAuthorization(
    @Param("catalogId", uuid()) catalogId: string,
    @Body(body(C.selectedScopeAuthorizationApproveSchema))
    request: C.SelectedScopeAuthorizationApprove,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.approveScopeAuthorization(
        catalogId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: Revoke a previously approved semantic authorization so it can no longer authorize new publications.
   * Business rules: Authenticated Admin only; preserves historical records while marking the authorization REJECTED.
   * Execution flow: 1. Validate the revocation payload. 2. Delegate to PreparationRuleService and return the updated state.
   * Failure cases: Stale revisions or non-approved authorizations return CONFLICT.
   * Side effects: Transitions authorization to REJECTED and appends an audit event.
   */
  @Post(":catalogId/scope-authorizations/revoke")
  @HttpCode(200)
  async revokeScopeAuthorization(
    @Param("catalogId", uuid()) catalogId: string,
    @Body(body(C.selectedScopeAuthorizationRevokeSchema))
    request: C.SelectedScopeAuthorizationRevoke,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.revokeScopeAuthorization(
        catalogId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  @Post(":catalogId/rules")
  @HttpCode(200)
  async saveRule(
    @Param("catalogId", uuid()) catalogId: string,
    @Body(body(C.legalRuleWriteSchema)) request: C.LegalRuleWrite,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalog.saveRule(
        catalogId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: Import one eligible Article–Clause–Point leaf into a catalog pinned to its source version.
   * Business rules:
   * - Admin authorization applies; the server recomputes description, identity and citations from the catalog's pinned source.
   * Execution flow:
   * 1. Validate catalog UUID and the requested document/locator/revision.
   * 2. Recompute source eligibility and hierarchy composition in the catalog service.
   * 3. Return the existing saved-rule acknowledgement envelope.
   * Failure cases:
   * - Ineligible leaves, excessive context, stale revisions and invalid citations use shared typed problem handling.
   * Side effects:
   * - Saves one rule, advances catalog revision, and writes the existing audit event.
   */
  @Post(":catalogId/source-provisions/import")
  @HttpCode(200)
  async importSourceProvision(
    @Param("catalogId", uuid()) catalogId: string,
    @Body(body(C.legalRuleSourceProvisionImportSchema))
    request: C.LegalRuleSourceProvisionImport,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalog.importSourceProvision(
        catalogId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  @Post("selections")
  async select(
    @Body(body(C.legalRuleSelectionSchema)) request: C.LegalRuleSelection,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalog.select(
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  @Post("preparations")
  @HttpCode(202)
  async submit(
    @Body(body(C.legalRuleBulkSchema))
    request: z.infer<typeof C.legalRuleBulkSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.submit(
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  @Get("preparations/:batchId")
  async batch(
    @Param("batchId", uuid()) batchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.batch(batchId, correlation(req)),
    );
  }

  @Post("preparations/:batchId/retries")
  @HttpCode(202)
  async retry(
    @Param("batchId", uuid()) batchId: string,
    @Body(body(C.legalRuleRetrySchema))
    request: z.infer<typeof C.legalRuleRetrySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.retry(
        batchId,
        request.idempotencyKey,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  @Post("runs/:runId/cancel")
  @HttpCode(200)
  async cancel(
    @Param("runId", uuid()) runId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // Why: A human Admin cancellation must retain the authenticated actor in its durable audit.
    // How: Pass the RBAC user ID through the selected-rule service to the shared command.
    // Invariant: The request body cannot choose or impersonate the audit actor.
    return resultEnvelope(
      await this.preparation.cancel(
        runId,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }

  @Get("rules/:ruleId/results")
  async history(
    @Param("ruleId", uuid()) ruleId: string,
    @Query(body(C.preparationRuleHistoryQuerySchema))
    query: z.infer<typeof C.preparationRuleHistoryQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.history(
        ruleId,
        correlation(req),
        query.beforeRevision,
      ),
    );
  }

  @Post("rules/:ruleId/regenerate")
  @HttpCode(202)
  async regenerate(
    @Param("ruleId", uuid()) ruleId: string,
    @Body(body(C.legalRuleRegenerateSchema))
    request: z.infer<typeof C.legalRuleRegenerateSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.regenerate(
        ruleId,
        request,
        req.rbacContext.userId,
        correlation(req),
      ),
    );
  }
}

@Controller("internal/legal-rule-preparation")
@UseGuards(WorkerApiKeyGuard)
export class PreparationRuleWorkerController {
  constructor(private readonly preparation: PreparationRuleService) {}

  @Post("claim")
  @HttpCode(200)
  async claim(
    @Body(body(C.preparationRuleClaimSchema))
    request: z.infer<typeof C.preparationRuleClaimSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      C.preparationRuleClaimResponseSchema.parse(
        await this.preparation.claim(
          request.preparationRunId,
          correlation(req),
        ),
      ),
    );
  }

  @Post("instructions")
  @HttpCode(200)
  async instructions(
    @Body(body(C.preparationRuleInstructionsSchema))
    request: z.infer<typeof C.preparationRuleInstructionsSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.instructions(
        request.preparationRunId,
        request.receipt,
        correlation(req),
      ),
    );
  }

  /**
   * Business purpose: Tell the worker whether a drafted selected-rule result is structurally acceptable before it is settled.
   * Business rules:
   * - Only the authenticated worker may call it; it applies the same schema and provenance checks as completion and persists nothing.
   * Execution flow:
   * 1. Validate the body with the shared output schema and delegate to the preparation service.
   * Failure cases:
   * - Invalid drafts return HTTP 400 or 422 with bounded field paths, matching the completion callback.
   * Side effects:
   * - Read-only; no run state changes.
   */
  @Post("validate")
  @HttpCode(200)
  async validate(
    @Body(
      new ZodValidationPipe(
        C.preparationRuleValidateSchema,
        C.LEGAL_RULE_CATALOG_ERRORS.INVALID,
        HttpStatus.BAD_REQUEST,
        true,
      ),
    )
    request: C.PreparationRuleValidate,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.validate(request, correlation(req)),
    );
  }

  /**
   * Business purpose: Settle a selected rule with the outcome reported by its worker.
   * Business rules:
   * - Only the authenticated worker may submit a result, and the shared completion schema governs its shape.
   * Execution flow:
   * 1. Validate the callback body and delegate settlement to the preparation service.
   * Failure cases:
   * - Invalid callbacks return HTTP 400 with bounded schema diagnostics for the worker.
   * Side effects:
   * - Accepted requests may persist a terminal result through the preparation service.
   */
  @Post("complete")
  @HttpCode(200)
  async complete(
    @Body(
      new ZodValidationPipe(
        C.preparationRuleCompleteSchema,
        C.LEGAL_RULE_CATALOG_ERRORS.INVALID,
        HttpStatus.BAD_REQUEST,
        true,
      ),
    )
    request: C.PreparationRuleComplete,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.complete(request, correlation(req)),
    );
  }
}
