import type {
  Prisma,
  RuleSetPreparationReviewFrontier,
  RuleSetPreparationSourceReview,
} from "@prisma/client";

import { inventoryHash } from "../../domain/claim-inventory.js";
import { reviewFrontierTransition } from "../../domain/source-review-frontier-projection.js";

/**
 * Business purpose: Persist one source-review transition and its aggregate frontier state together.
 * Business rules:
 * - The caller has already locked the Preparation run and owns the surrounding transaction.
 * - The review row and frontier must use the same before/after evidence and state fingerprint.
 * Execution flow:
 * 1. Reload a changed review row. 2. Calculate its pure transition. 3. Write row fingerprint and frontier counters/hash in order.
 * Failure cases:
 * - A missing review row or failed write propagates so the caller rolls back the whole transaction.
 * Side effects:
 * - Updates one review row and its frontier using the caller's transaction; opens no nested transaction.
 */
export async function persistSourceReviewFrontierChange(
  tx: Prisma.TransactionClient,
  key: { preparationRunId: string; inventoryRevision: number },
  frontier: RuleSetPreparationReviewFrontier,
  previous?: RuleSetPreparationSourceReview,
) {
  // Why: Row fingerprint and frontier counters must commit or roll back together.
  // How: Re-read the updated row under the existing run lock, then persist one calculated transition.
  // Invariant: No separate transaction can expose a row/frontier mismatch.
  let counters: Record<string, { increment: number }> = {};
  let stateAccumulator = frontier.stateAccumulator;
  let stateFingerprint = inventoryHash({
    fingerprint: frontier.fingerprint,
    accumulator: stateAccumulator,
  });
  if (previous) {
    const rowKey = {
      ...key,
      sourceNodeId: previous.sourceNodeId,
    };
    const current = await tx.ruleSetPreparationSourceReview.findUniqueOrThrow({
      where: { preparationRunId_inventoryRevision_sourceNodeId: rowKey },
    });
    const transition = reviewFrontierTransition(frontier, previous, current);
    counters = transition.counters;
    stateAccumulator = transition.stateAccumulator;
    stateFingerprint = transition.stateFingerprint;
    await tx.ruleSetPreparationSourceReview.update({
      where: { preparationRunId_inventoryRevision_sourceNodeId: rowKey },
      data: { stateFingerprint: transition.itemFingerprint },
    });
  }
  return tx.ruleSetPreparationReviewFrontier.update({
    where: { preparationRunId_inventoryRevision: key },
    data: { ...counters, stateAccumulator, stateFingerprint },
  });
}
