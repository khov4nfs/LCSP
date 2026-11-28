import type { LegalDocumentGraph } from "@lcsp/contracts/legal-source";
import { SOURCE_REVIEW_STATES } from "@lcsp/contracts/legal-source";

import { inventoryHash } from "./claim-inventory.js";
import {
  frontierDefinitionFingerprint,
  reviewItemStateFingerprint,
  reviewReferenceOwners,
  sourceReviewUnits,
  xorReviewHash,
  zeroReviewAccumulator,
} from "./source-review-frontier.js";

/**
 * Business purpose: Assign each source reference to the review unit responsible for its evidence.
 * Business rules:
 * - Preserve graph reference order and the existing owner selection rule.
 * - References with no review owner remain unassigned.
 * Execution flow:
 * 1. Resolve reference owners. 2. Group reference IDs by owner in graph order.
 * Failure cases:
 * - Invalid graph relationships are handled by the owner resolver.
 * Side effects:
 * - None; returns a new in-memory map.
 */
export function referenceIdsByReviewOwner(graph: LegalDocumentGraph) {
  // Why: INIT and EXPAND must assign references by the same pinned graph rule.
  // How: Both paths reuse one grouping projection after owner resolution.
  // Invariant: No source reference is assigned to a different review unit by the action chosen.
  const owners = reviewReferenceOwners(graph);
  const byOwner = new Map<string, string[]>();
  for (const reference of graph.references) {
    const owner = owners.get(reference.referenceId);
    if (!owner) continue;
    const ids = byOwner.get(owner) ?? [];
    ids.push(reference.referenceId);
    byOwner.set(owner, ids);
  }
  return byOwner;
}

/**
 * Business purpose: Derive the initial durable review frontier from a pinned legal-source graph.
 * Business rules:
 * - Explicit scope is accepted only for a discovery-only diagnostic and only for existing review units.
 * - Every selected unit starts PENDING and contributes to the frontier state fingerprint.
 * Execution flow:
 * 1. Select deterministic review units. 2. Apply an authorized diagnostic scope. 3. Build row, counter, and fingerprint projections.
 * Failure cases:
 * - Invalid explicit scope returns null without a partial frontier.
 * Side effects:
 * - None; the caller persists the returned projection in its existing transaction.
 */
export function initialReviewFrontierProjection(
  graph: LegalDocumentGraph,
  scopeNodeIds: string[] | undefined,
  discoveryOnly: boolean,
) {
  // Why: The initial frontier must be derived before any database write.
  // How: Return complete create data or null for a rejected diagnostic scope.
  // Invariant: Scope cannot add a node outside the pinned graph or a normal preparation.
  let units = sourceReviewUnits(graph);
  if (scopeNodeIds) {
    const unitIds = new Set(units.map((unit) => unit.nodeId));
    if (!discoveryOnly || scopeNodeIds.some((id) => !unitIds.has(id)))
      return null;
    const selected = new Set(scopeNodeIds);
    units = units.filter((unit) => selected.has(unit.nodeId));
  }
  const referencesByOwner = referenceIdsByReviewOwner(graph);
  const fingerprint = frontierDefinitionFingerprint(
    graph.materializationId,
    1,
    units.map((unit) => unit.nodeId),
  );
  const stateAccumulator = units.reduce(
    (hash, unit) =>
      xorReviewHash(
        hash,
        reviewItemStateFingerprint({
          sourceNodeId: unit.nodeId,
          state: SOURCE_REVIEW_STATES.PENDING,
        }),
      ),
    zeroReviewAccumulator,
  );
  return {
    materializationId: graph.materializationId,
    fingerprint,
    stateAccumulator,
    stateFingerprint: inventoryHash({
      fingerprint,
      accumulator: stateAccumulator,
    }),
    unitCount: units.length,
    pendingCount: units.length,
    items: {
      create: units.map((unit, ordinal) => ({
        sourceNodeId: unit.nodeId,
        structuralPath: unit.structuralPath,
        ordinal,
        stateFingerprint: reviewItemStateFingerprint({
          sourceNodeId: unit.nodeId,
          state: SOURCE_REVIEW_STATES.PENDING,
        }),
        referenceIds: referencesByOwner.get(unit.nodeId) ?? [],
      })),
    },
  };
}

type ReviewTransitionRow = Parameters<typeof reviewItemStateFingerprint>[0] & {
  stateFingerprint: string;
  ownedClaimCount: number;
};

const REVIEW_STATE_COUNTERS: Record<string, string> = {
  [SOURCE_REVIEW_STATES.PENDING]: "pendingCount",
  [SOURCE_REVIEW_STATES.REOPENED]: "pendingCount",
  [SOURCE_REVIEW_STATES.IN_REVIEW]: "inReviewCount",
  [SOURCE_REVIEW_STATES.REVIEWED_WITH_CLAIMS]: "reviewedWithClaimsCount",
  [SOURCE_REVIEW_STATES.REVIEWED_NO_CLAIMS]: "reviewedNoClaimsCount",
  [SOURCE_REVIEW_STATES.BLOCKED_REFERENCE]: "blockedCount",
};

/**
 * Business purpose: Calculate the durable frontier delta after one review row changes.
 * Business rules:
 * - Replace the old row hash with the new row hash in the XOR accumulator.
 * - Move one unit only when its state bucket changes; persist the owned-claim count delta.
 * Execution flow:
 * 1. Fingerprint the updated row. 2. Replace its accumulator contribution. 3. Derive counter deltas and the new frontier fingerprint.
 * Failure cases:
 * - An unknown review state has no counter bucket and must not be passed by the persistence caller.
 * Side effects:
 * - None; returns values for the caller's atomic row and frontier updates.
 */
export function reviewFrontierTransition(
  frontier: { fingerprint: string; stateAccumulator: string },
  previous: ReviewTransitionRow,
  current: ReviewTransitionRow,
) {
  // Why: A changed review must update counters and the aggregate hash from the same before/after rows.
  // How: Compute the entire delta before either row or frontier is written.
  // Invariant: Replaying an unchanged state does not move a unit between state buckets.
  const itemFingerprint = reviewItemStateFingerprint(current);
  const stateAccumulator = xorReviewHash(
    xorReviewHash(frontier.stateAccumulator, previous.stateFingerprint),
    itemFingerprint,
  );
  const counters: Record<string, { increment: number }> = {};
  const beforeBucket = REVIEW_STATE_COUNTERS[previous.state];
  const afterBucket = REVIEW_STATE_COUNTERS[current.state];
  if (beforeBucket !== afterBucket) {
    counters[beforeBucket] = { increment: -1 };
    counters[afterBucket] = { increment: 1 };
  }
  counters.persistedClaimCount = {
    increment: current.ownedClaimCount - previous.ownedClaimCount,
  };
  return {
    itemFingerprint,
    stateAccumulator,
    stateFingerprint: inventoryHash({
      fingerprint: frontier.fingerprint,
      accumulator: stateAccumulator,
    }),
    counters,
  };
}
