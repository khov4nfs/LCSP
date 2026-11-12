/** Immutable, server-owned scope admission shared by claim, validate and activation.
 * A saved reviewer signature does not substitute for current inventory or source checks.
 */
import { HttpStatus } from "@nestjs/common";
import {
  PreparationTargetActivityScope,
  PreparationScopeReviewState,
  type Prisma,
} from "@prisma/client";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  legalSemanticGraphSchema,
  preparationScopeReviewSubmitSchema,
  type ComplianceRuleSetPacket,
} from "@lcsp/contracts/compliance-rule-set";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import {
  reviewDevelopmentClaims,
  scopeDigest,
  validateDevelopmentPacket,
  type DevelopmentProjection,
} from "../../domain/development-scope-review.js";

export async function requireApprovedDevelopmentScope(
  prisma: Prisma.TransactionClient,
  runId: string,
  revision: number,
  legalSourceVersionId: string,
  scope: PreparationTargetActivityScope,
  correlationId: string,
  packet?: ComplianceRuleSetPacket,
): Promise<DevelopmentProjection | null> {
  if (scope === PreparationTargetActivityScope.FULL_SOURCE) return null;
  function reject(reason: string): never {
    throw problemException(
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      correlationId,
      { status: HttpStatus.CONFLICT, meta: { reason } },
    );
  }
  const review = await prisma.ruleSetPreparationScopeReview.findUnique({
    where: {
      preparationRunId_inventoryRevision: {
        preparationRunId: runId,
        inventoryRevision: revision,
      },
    },
  });
  const frozen = await prisma.ruleSetPreparationClaimInventory.findUnique({
    where: { preparationRunId_revision: { preparationRunId: runId, revision } },
  });
  if (
    !review ||
    !frozen ||
    review.state !== PreparationScopeReviewState.APPROVED ||
    review.legalSourceVersionId !== legalSourceVersionId ||
    review.inventoryFingerprint !== frozen.fingerprint ||
    !review.approvedBy ||
    review.approvedBy === review.submittedBy
  )
    reject("SCOPE_APPROVAL_MISSING_OR_STALE");
  try {
    const graph = legalSemanticGraphSchema.parse(frozen.graph);
    const decisions = preparationScopeReviewSubmitSchema.shape.decisions.parse(
      review.decisions,
    );
    const projection = reviewDevelopmentClaims(graph, decisions);
    if (
      graph.legalSourceVersionId !== legalSourceVersionId ||
      review.graphDigest !== scopeDigest(frozen.graph) ||
      review.decisionDigest !== projection.decisionsDigest ||
      projection.unresolvedClaimIds.length ||
      projection.developmentClaimIds.length === 0
    )
      reject("SCOPE_REVIEW_PROJECTION_INVALID");
    if (packet) validateDevelopmentPacket(packet, projection);
    return projection;
  } catch (error) {
    if (
      (error as Error).message?.startsWith("PREPARATION_SCOPE_") ||
      (error as Error).name === "ZodError"
    )
      reject("SCOPE_REVIEW_VALIDATION_FAILED");
    throw error;
  }
}
