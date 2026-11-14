import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_REACTIVATION_ERROR_CODES,
  complianceRuleSetReactivationRequestSchema,
  type ComplianceRuleSetReactivationRequest,
  ruleSetPreparationAdminRequestSchema,
  type RuleSetPreparationAdminRequest,
  preparationScopeReviewSubmitSchema,
  preparationScopeReviewApprovalSchema,
  preparationScopeReviewActivateSchema,
  type PreparationScopeReviewSubmit,
  type PreparationScopeReviewApproval,
  type PreparationScopeReviewActivate,
  preparationSourceUnitsRequestSchema,
  type PreparationSourceUnitsRequest,
} from "@lcsp/contracts/compliance-rule-set";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { PreparationScopeReviewService } from "../../infrastructure/persistence/preparation-scope-review.service.js";
import { RuleCatalogGroupsService } from "../../infrastructure/persistence/rule-catalog-groups.service.js";
import {
  submitRuleCatalogGroupsSchema,
  approveRuleCatalogGroupsSchema,
  type SubmitRuleCatalogGroups,
} from "@lcsp/contracts/assessment-domain";
import { ResumeRuleSetPreparationCommand } from "../../application/commands/resume-rule-set-preparation/resume-rule-set-preparation.command.js";
import { RetryRuleSetPreparationCommand } from "../../application/commands/retry-rule-set-preparation/retry-rule-set-preparation.command.js";
import { GetComplianceRuleSetResultQuery } from "../../application/queries/get-compliance-rule-set-result/get-compliance-rule-set-result.query.js";
import { ListComplianceRuleSetHistoryQuery } from "../../application/queries/list-compliance-rule-set-history/list-compliance-rule-set-history.query.js";
import { PrepareCurrentRuleSetCommand } from "../../application/commands/prepare-current-rule-set/prepare-current-rule-set.command.js";
import { CancelRuleSetPreparationCommand } from "../../application/commands/cancel-rule-set-preparation/cancel-rule-set-preparation.command.js";
import { ReactivateComplianceRuleSetCommand } from "../../application/commands/reactivate-compliance-rule-set/reactivate-compliance-rule-set.command.js";
import { PreparationSourceAnalysisReadService } from "../../infrastructure/persistence/preparation-source-analysis-read.service.js";

/**
 * Operations view of the shared Compliance Rule Sets. Preparation starts automatically with a
 * Legal Source Version activation; Admin can prepare the current source, retry a failure, or cancel
 * an active preparation.
 * The controller only dispatches commands; source selection and orchestration stay server-owned.
 */
@Controller("admin/compliance-rule-sets")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class ComplianceRuleSetAdminController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly scopeReviews: PreparationScopeReviewService,
    private readonly catalogGroups: RuleCatalogGroupsService,
    private readonly sourceAnalysis: PreparationSourceAnalysisReadService,
  ) {}

  /**
   * Business purpose: Surface active Development-only versions needing grouping administration.
   * Business rules:
   * - Controller-wide Admin authorization applies; the list grants no publication or legal approval.
   * Execution flow:
   * 1. Return the bounded server-owned pending grouping list.
   * Failure cases:
   * - Authorization or persistence failures propagate through the shared problem boundary.
   * Side effects:
   * - Reads grouping readiness only.
   */
  @Get("groups/pending")
  async pendingGroups() {
    return resultEnvelope(await this.catalogGroups.pending());
  }

  @Get(":ruleSetVersionId/groups")
  async groups(@Param("ruleSetVersionId", new ParseUUIDPipe()) id: string) {
    return resultEnvelope(await this.catalogGroups.get(id));
  }

  /**
   * Business purpose: Open a pinned grouping proposal for authorized administrative review.
   * Business rules:
   * - Controller-wide Admin authorization applies; proposal generation never approves membership.
   * Execution flow:
   * 1. Validate version identity and return the canonical proposal through the shared envelope.
   * Failure cases:
   * - Inactive, foreign or stale versions reject through the domain service.
   * Side effects:
   * - May idempotently materialize a missing historical proposal.
   */
  @Get(":ruleSetVersionId/groups/proposal")
  async proposal(
    @Param("ruleSetVersionId", new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalogGroups.proposal(id, req.correlationId || randomUUID()),
    );
  }

  @Post(":ruleSetVersionId/groups")
  @HttpCode(HttpStatus.OK)
  async submitGroups(
    @Param("ruleSetVersionId", new ParseUUIDPipe()) id: string,
    @Body(
      new ZodValidationPipe(
        submitRuleCatalogGroupsSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    body: SubmitRuleCatalogGroups,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalogGroups.submit(
        id,
        body,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
      ),
    );
  }

  @Post(":ruleSetVersionId/groups/approval")
  @HttpCode(HttpStatus.OK)
  async approveGroups(
    @Param("ruleSetVersionId", new ParseUUIDPipe()) id: string,
    @Body(
      new ZodValidationPipe(
        approveRuleCatalogGroupsSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    body: {
      membershipDigest: string;
      confirmsTaxonomyAndMembershipReview: true;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.catalogGroups.approve(
        id,
        body.membershipDigest,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
      ),
    );
  }

  @Get()
  list() {
    return this.queries
      .execute(new ListComplianceRuleSetHistoryQuery())
      .then(resultEnvelope);
  }

  /** View result: one stored rule set version (ACTIVE or SUPERSEDED) with its source provenance. */
  @Get(":ruleSetVersionId")
  result(
    @Param("ruleSetVersionId", new ParseUUIDPipe()) ruleSetVersionId: string,
    @Req() req: AuthenticatedRequest,
    @Headers("x-lcsp-locale") locale?: string,
  ) {
    return this.queries
      .execute(
        new GetComplianceRuleSetResultQuery(
          ruleSetVersionId,
          req.correlationId || randomUUID(),
          locale,
        ),
      )
      .then(resultEnvelope);
  }

  /** Current inventory review and all historical revisions remain visible to Admin reviewers. */
  @Get("preparations/:preparationRunId/scope-reviews")
  async getScopeReviews(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
  ) {
    return resultEnvelope(await this.scopeReviews.get(preparationRunId));
  }

  /**
   * Business purpose: Provide Admin with a paginated view of canonical persisted Source Review units for one Preparation snapshot.
   *
   * Business rules:
   * - Controller-wide Admin authorization applies; the run, inventory revision and pinned frontier determine all returned data.
   * - Query filters only narrow the page and never alter authoritative frontier coverage totals.
   *
   * Execution flow:
   * 1. Validate the Preparation run UUID and bounded query contract.
   * 2. Delegate the consistent pinned read to the source-analysis service and return the standard success envelope.
   *
   * Failure cases:
   * - Invalid input, missing runs, missing frontiers and stale cursors use the shared typed problem boundary.
   *
   * Side effects:
   * - Read-only; no Preparation, Source Review, graph materialization or worker state is changed.
   */
  @Get("preparations/:preparationRunId/source-units")
  async sourceUnits(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Query(
      new ZodValidationPipe(
        preparationSourceUnitsRequestSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    request: PreparationSourceUnitsRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.sourceAnalysis.list(
        preparationRunId,
        request,
        req.correlationId || randomUUID(),
      ),
    );
  }

  @Post("preparations/:preparationRunId/scope-reviews")
  @HttpCode(HttpStatus.OK)
  async submitScopeReview(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Body(
      new ZodValidationPipe(
        preparationScopeReviewSubmitSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    request: PreparationScopeReviewSubmit,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.scopeReviews.submit(
        preparationRunId,
        request,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
      ),
    );
  }

  @Post("preparations/:preparationRunId/scope-reviews/approval")
  @HttpCode(HttpStatus.OK)
  async approveScopeReview(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Body(
      new ZodValidationPipe(
        preparationScopeReviewApprovalSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    request: PreparationScopeReviewApproval,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.scopeReviews.approve(
        preparationRunId,
        request,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
      ),
    );
  }

  /** Separate compare-and-set transition: human approval alone never enables the model. */
  @Post("preparations/:preparationRunId/scope-reviews/activate")
  @HttpCode(HttpStatus.OK)
  async activateScopeReview(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Body(
      new ZodValidationPipe(
        preparationScopeReviewActivateSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    request: PreparationScopeReviewActivate,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.scopeReviews.activate(
        preparationRunId,
        request.inventoryRevision,
        req.rbacContext.userId,
        req.correlationId || randomUUID(),
      ),
    );
  }

  @Post("preparations/:preparationRunId/retries")
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new RetryRuleSetPreparationCommand(
          preparationRunId,
          req.rbacContext.userId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }

  @Post("preparations/:preparationRunId/resume")
  @HttpCode(HttpStatus.ACCEPTED)
  resume(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new ResumeRuleSetPreparationCommand(
          preparationRunId,
          req.rbacContext.userId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }

  @Post("preparations/:preparationRunId/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(
    @Param("preparationRunId", new ParseUUIDPipe()) preparationRunId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new CancelRuleSetPreparationCommand(
          preparationRunId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }

  @Post("prepare")
  @HttpCode(HttpStatus.ACCEPTED)
  prepare(
    @Body(
      new ZodValidationPipe(
        ruleSetPreparationAdminRequestSchema,
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      ),
    )
    request: RuleSetPreparationAdminRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new PrepareCurrentRuleSetCommand(
          req.rbacContext.userId,
          req.correlationId || randomUUID(),
          request.replaceActive === true,
          request.legalSourceVersionId,
          request.targetActivityScope ?? "FULL_SOURCE",
        ),
      )
      .then(resultEnvelope);
  }

  @Post(":ruleSetVersionId/reactivate")
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param("ruleSetVersionId", new ParseUUIDPipe())
    targetRuleSetVersionId: string,
    @Body(
      new ZodValidationPipe(
        complianceRuleSetReactivationRequestSchema,
        RULE_SET_REACTIVATION_ERROR_CODES.REQUEST_INVALID,
      ),
    )
    request: ComplianceRuleSetReactivationRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commands
      .execute(
        new ReactivateComplianceRuleSetCommand(
          targetRuleSetVersionId,
          request,
          req.rbacContext.userId,
          req.correlationId || randomUUID(),
        ),
      )
      .then(resultEnvelope);
  }
}
