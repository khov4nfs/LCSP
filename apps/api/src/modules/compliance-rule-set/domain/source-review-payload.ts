import { sourceReviewPayloadSchema } from "@lcsp/contracts/compliance-rule-set";
import type { RuleSetPreparationSourceReview } from "@prisma/client";

/**
 * Business purpose: Read a persisted source review through its shared contract before using its claims.
 * Business rules:
 * - Stored content must satisfy the canonical source-review schema; invalid data is never repaired silently.
 * Execution flow:
 * 1. Parse the stored payload. 2. Return typed claims, identities, and relations.
 * Failure cases:
 * - Invalid persisted content throws a validation error to the calling review gate.
 * Side effects:
 * - None; parses data in memory.
 */
export function reviewPayload(item: RuleSetPreparationSourceReview) {
  // Why: Both source review and claim inventory must interpret persisted evidence identically.
  // How: Parse once at the shared domain boundary rather than importing one command handler from another.
  // Invariant: Malformed stored reviews cannot silently influence inventory or authoring decisions.
  return sourceReviewPayloadSchema.parse(item.payload);
}
