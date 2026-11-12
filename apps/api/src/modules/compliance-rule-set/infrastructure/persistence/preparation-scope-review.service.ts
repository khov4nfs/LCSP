/** Two-person, source-pinned Preparation claim-scope review.
 * This is not model authority or permission to omit real legal obligations.
 */
import { Injectable, HttpStatus } from "@nestjs/common";
import {
  Prisma,
  PreparationScopeReviewState,
  PreparationTargetActivityScope,
  ClaimPreparationPhase,
  AgentExecutionState,
} from "@prisma/client";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  legalSemanticGraphSchema,
  preparationScopeReviewSubmitSchema,
  type PreparationScopeReviewSubmit,
  type PreparationScopeReviewApproval,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  reviewDevelopmentClaims,
  scopeDigest,
} from "../../domain/development-scope-review.js";

@Injectable()
export class PreparationScopeReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose:
   * Return a standard fail-closed conflict to Admin callers.
   * Business rules:
   * - Caller context identifies the request and reason; no data mutation on rejection.
   * Execution flow:
   * 1. Raise a canonical HTTP 409 error with a stable reason.
   * Failure cases:
   * - Always rejects when called.
   * Side effects:
   * - Throws a framework exception.
   */
  private conflict(correlationId: string, reason: string): never {
    throw problemException(
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      correlationId,
      { status: HttpStatus.CONFLICT, meta: { reason } },
    );
  }

  /**
   * Business purpose:
   * Lock the exact Preparation row while checking review and publication state.
   * Business rules:
   * - No review may mutate a published or missing run.
   * Execution flow:
   * 1. Take a parameterized row lock and load the pinned run.
   * Failure cases:
   * - Conflicting/missing runs fail closed.
   * Side effects:
   * - Acquires a transaction-bound database lock.
   */
  private async lockedRun(
    tx: Prisma.TransactionClient,
    runId: string,
    correlationId: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "RuleSetPreparationRun" WHERE "id" = ${runId} FOR UPDATE`,
    );
    const run = await tx.ruleSetPreparationRun.findUnique({
      where: { id: runId },
      include: { ruleSet: { select: { id: true } } },
    });
    if (!run || run.ruleSet)
      this.conflict(correlationId, "SCOPE_REVIEW_RUN_MISSING_OR_PUBLISHED");
    return run;
  }

  /**
   * Business purpose:
   * Expose review history to authorized Admin callers.
   * Business rules:
   * - Only the authenticated controller grants this read operation.
   * Execution flow:
   * 1. List ledger revisions for the supplied Preparation run.
   * Failure cases:
   * - Database read errors propagate.
   * Side effects:
   * - Reads ledger records without changing them.
   */
  async get(runId: string) {
    return this.prisma.ruleSetPreparationScopeReview.findMany({
      where: { preparationRunId: runId },
      orderBy: { inventoryRevision: "desc" },
    });
  }

  /**
   * Business purpose:
   * Persist a draft 1:1 claim-level scope decision ledger.
   * Business rules:
   * - Only a requested and paused frozen inventory is eligible; revision and pins are compared.
   * Execution flow:
   * 1. Lock run, validate graph and submitted stages, then CAS-insert/update the draft.
   * Failure cases:
   * - Missing, stale, approved or malformed ledger rejects.
   * Side effects:
   * - Writes a revisioned DRAFT ledger in a transaction.
   */
  async submit(
    runId: string,
    request: PreparationScopeReviewSubmit,
    actorId: string,
    correlationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.lockedRun(tx, runId, correlationId);
      if (
        !run.scopeReviewRequested ||
        run.executionState !== AgentExecutionState.PAUSED ||
        run.claimInventoryRevision !== request.inventoryRevision ||
        run.claimPhase !== ClaimPreparationPhase.CLAIM_INVENTORY_READY ||
        run.targetActivityScope !== PreparationTargetActivityScope.FULL_SOURCE
      )
        this.conflict(correlationId, "SCOPE_REVIEW_NOT_AT_FROZEN_INVENTORY");
      const inventory = await tx.ruleSetPreparationClaimInventory.findUnique({
        where: {
          preparationRunId_revision: {
            preparationRunId: runId,
            revision: request.inventoryRevision,
          },
        },
      });
      if (!inventory || inventory.fingerprint !== request.inventoryFingerprint)
        this.conflict(correlationId, "SCOPE_REVIEW_INVENTORY_STALE");
      const graph = legalSemanticGraphSchema.parse(inventory.graph);
      if (graph.legalSourceVersionId !== run.legalSourceVersionId)
        this.conflict(correlationId, "SCOPE_REVIEW_SOURCE_PIN_MISMATCH");
      const validated = preparationScopeReviewSubmitSchema.parse(request);
      const projection = reviewDevelopmentClaims(graph, validated.decisions);
      const existing = await tx.ruleSetPreparationScopeReview.findUnique({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: runId,
            inventoryRevision: request.inventoryRevision,
          },
        },
      });
      if (
        (existing?.revision ?? 0) !== request.expectedReviewRevision ||
        existing?.state === PreparationScopeReviewState.APPROVED
      )
        this.conflict(
          correlationId,
          "SCOPE_REVIEW_REVISION_OR_APPROVAL_CONFLICT",
        );
      const data = {
        legalSourceVersionId: run.legalSourceVersionId,
        inventoryFingerprint: inventory.fingerprint,
        graphDigest: projection.graphDigest,
        decisionDigest: projection.decisionsDigest,
        decisions: validated.decisions as unknown as Prisma.InputJsonValue,
        projection: projection as unknown as Prisma.InputJsonValue,
        submittedBy: actorId,
        state: PreparationScopeReviewState.DRAFT,
        approvedBy: null,
        approvedAt: null,
      };
      return existing
        ? tx.ruleSetPreparationScopeReview.update({
            where: {
              preparationRunId_inventoryRevision: {
                preparationRunId: runId,
                inventoryRevision: request.inventoryRevision,
              },
            },
            data: { ...data, revision: { increment: 1 } },
          })
        : tx.ruleSetPreparationScopeReview.create({
            data: {
              ...data,
              preparationRunId: runId,
              inventoryRevision: request.inventoryRevision,
            },
          });
    });
  }

  /**
   * Business purpose:
   * Capture an independent human approval for a frozen scope review.
   * Business rules:
   * - Reviewer must differ from submitter; no unresolved claims or graph drift allowed.
   * Execution flow:
   * 1. Lock run, recheck inventory and re-evaluate decisions, then record approval actor and time.
   * Failure cases:
   * - Incorrect revision, identity, digest or missing review rejects.
   * Side effects:
   * - Updates approval metadata transactionally.
   */
  async approve(
    runId: string,
    request: PreparationScopeReviewApproval,
    reviewerId: string,
    correlationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.lockedRun(tx, runId, correlationId);
      const review = await tx.ruleSetPreparationScopeReview.findUnique({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: runId,
            inventoryRevision: request.inventoryRevision,
          },
        },
      });
      if (
        !review ||
        run.claimInventoryRevision !== request.inventoryRevision ||
        review.revision !== request.expectedReviewRevision ||
        review.decisionDigest !== request.decisionDigest ||
        review.state !== PreparationScopeReviewState.DRAFT
      )
        this.conflict(correlationId, "SCOPE_REVIEW_STALE_OR_NOT_DRAFT");
      if (review.submittedBy === reviewerId)
        this.conflict(
          correlationId,
          "SCOPE_REVIEW_REQUIRES_INDEPENDENT_APPROVER",
        );
      if (
        run.claimPhase !== ClaimPreparationPhase.CLAIM_INVENTORY_READY ||
        !run.scopeReviewRequested ||
        run.executionState !== AgentExecutionState.PAUSED
      )
        this.conflict(correlationId, "SCOPE_REVIEW_AUTHORING_ALREADY_STARTED");
      const inventory =
        await tx.ruleSetPreparationClaimInventory.findUniqueOrThrow({
          where: {
            preparationRunId_revision: {
              preparationRunId: runId,
              revision: review.inventoryRevision,
            },
          },
        });
      if (
        inventory.fingerprint !== review.inventoryFingerprint ||
        scopeDigest(inventory.graph) !== review.graphDigest
      )
        this.conflict(correlationId, "SCOPE_REVIEW_FROZEN_SOURCE_CHANGED");
      const graph = legalSemanticGraphSchema.parse(inventory.graph);
      const decisions =
        preparationScopeReviewSubmitSchema.shape.decisions.parse(
          review.decisions,
        );
      const projection = reviewDevelopmentClaims(graph, decisions);
      if (
        projection.decisionsDigest !== review.decisionDigest ||
        projection.graphDigest !== review.graphDigest ||
        projection.unresolvedClaimIds.length ||
        projection.developmentClaimIds.length === 0
      )
        this.conflict(correlationId, "SCOPE_REVIEW_UNRESOLVED_OR_CHANGED");
      return tx.ruleSetPreparationScopeReview.update({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: runId,
            inventoryRevision: review.inventoryRevision,
          },
        },
        data: {
          state: PreparationScopeReviewState.APPROVED,
          approvedBy: reviewerId,
          approvedAt: new Date(),
        },
      });
    });
  }

  /**
   * Business purpose:
   * Authorize Development-only mode for an approved paused Preparation run.
   * Business rules:
   * - This only sets the run scope, not an ACTIVE Rule Set; frozen approval must still match.
   * Execution flow:
   * 1. Lock run, recheck approval provenance, then switch targetActivityScope.
   * Failure cases:
   * - Stale, unapproved, unpaused or already-published state rejects.
   * Side effects:
   * - Updates one Preparation run scope; no external activation.
   */
  async activate(
    runId: string,
    revision: number,
    actorId: string,
    correlationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.lockedRun(tx, runId, correlationId);
      if (
        !run.scopeReviewRequested ||
        run.claimInventoryRevision !== revision ||
        run.claimPhase !== ClaimPreparationPhase.CLAIM_INVENTORY_READY ||
        run.executionState !== AgentExecutionState.PAUSED ||
        run.targetActivityScope !== PreparationTargetActivityScope.FULL_SOURCE
      )
        this.conflict(correlationId, "SCOPE_REVIEW_PAUSED_FROZEN_RUN_REQUIRED");
      const review = await tx.ruleSetPreparationScopeReview.findUnique({
        where: {
          preparationRunId_inventoryRevision: {
            preparationRunId: runId,
            inventoryRevision: revision,
          },
        },
      });
      if (
        !review ||
        review.state !== PreparationScopeReviewState.APPROVED ||
        review.submittedBy === review.approvedBy ||
        !review.approvedBy
      )
        this.conflict(correlationId, "SCOPE_REVIEW_APPROVAL_MISSING");
      const frozen =
        await tx.ruleSetPreparationClaimInventory.findUniqueOrThrow({
          where: {
            preparationRunId_revision: { preparationRunId: runId, revision },
          },
        });
      if (
        review.inventoryFingerprint !== frozen.fingerprint ||
        review.graphDigest !== scopeDigest(frozen.graph)
      )
        this.conflict(correlationId, "SCOPE_REVIEW_APPROVAL_STALE");
      await tx.ruleSetPreparationRun.update({
        where: { id: runId },
        data: {
          targetActivityScope: PreparationTargetActivityScope.DEVELOPMENT_ONLY,
        },
      });
      return {
        preparationRunId: runId,
        inventoryRevision: revision,
        targetActivityScope: "DEVELOPMENT_ONLY",
        activatedBy: actorId,
        reviewRevision: review.revision,
        decisionDigest: review.decisionDigest,
      };
    });
  }
}
