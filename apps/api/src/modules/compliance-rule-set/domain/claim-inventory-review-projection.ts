import type { LegalSemanticGraph } from "@lcsp/contracts/compliance-rule-set";

import { normalizeInventory } from "./claim-inventory.js";
import { reviewPayload } from "./source-review-payload.js";
import { reviewedFrontierFingerprint } from "./source-review-frontier.js";

type CompletedReviewRow = {
  sourceNodeId: string;
  state: string;
  claimIds: string[];
  disposition: string | null;
  reason: string | null;
  completionFingerprint: string | null;
  payload: unknown;
};

/**
 * Business purpose: Reconstruct the canonical inventory candidate from completed source-review evidence.
 * Business rules:
 * - Persisted review payloads are schema-validated before use; source accounting comes from the stored review rows.
 * - Relations retain the existing first-row-wins deduplication rule before canonical inventory ordering.
 * Execution flow:
 * 1. Bind the frontier fingerprint to reviewed rows. 2. Parse every payload. 3. Assemble and normalize graph and identity projections.
 * Failure cases:
 * - Malformed persisted payloads throw without yielding a partial inventory projection.
 * Side effects:
 * - None; returns a new graph and identity map without writing source rows.
 */
export function projectCompletedReviewInventory(
  graph: LegalSemanticGraph,
  frontier: { revision: number; fingerprint: string },
  items: CompletedReviewRow[],
) {
  // Why: Freezing must compare the worker candidate with the exact durable review snapshot.
  // How: One pure projection derives all charged claims, relations, identities and accounting from stored rows.
  // Invariant: Caller does not substitute unpersisted worker payload for reviewed evidence.
  const reviewBinding = {
    revision: frontier.revision,
    fingerprint: frontier.fingerprint,
    reviewedFingerprint: reviewedFrontierFingerprint(
      frontier.fingerprint,
      items,
    ),
  };
  const payloads = items.map(reviewPayload);
  const persistentGraph = normalizeInventory({
    ...graph,
    reviewFrontier: reviewBinding,
    claims: payloads.flatMap((payload) => payload.claims),
    relations: [
      ...new Map(
        payloads
          .flatMap((payload) => payload.relations)
          .map((relation) => [relation.relationId, relation]),
      ).values(),
    ],
    sourceAccounting: items.map((item) => ({
      sourceNodeId: item.sourceNodeId,
      claimIds: item.claimIds,
      nonSemanticReason: item.claimIds.length ? null : item.reason,
    })),
    referenceAccounting: payloads.flatMap(
      (payload) => payload.referenceAccounting,
    ),
  });
  const persistentIdentities = Object.fromEntries(
    payloads.flatMap((payload) => Object.entries(payload.identities)),
  );
  return { reviewBinding, persistentGraph, persistentIdentities };
}
