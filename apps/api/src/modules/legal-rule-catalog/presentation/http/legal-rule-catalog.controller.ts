import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import * as C from "@lcsp/contracts/legal-rule-catalog";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { LegalRuleCatalogService } from "../../application/services/legal-rule-catalog.service.js";
import { PreparationRuleService } from "../../application/services/preparation-rule.service.js";

const body = (schema: z.ZodType) =>
  new ZodValidationPipe(schema, C.LEGAL_RULE_CATALOG_ERRORS.INVALID);
const uuid = () => new ParseUUIDPipe();
const correlation = (req: AuthenticatedRequest) =>
  req.correlationId || randomUUID();

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
    return resultEnvelope(
      await this.preparation.cancel(runId, correlation(req)),
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

  @Post("complete")
  @HttpCode(200)
  async complete(
    @Body(body(C.preparationRuleCompleteSchema))
    request: C.PreparationRuleComplete,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.preparation.complete(request, correlation(req)),
    );
  }
}
