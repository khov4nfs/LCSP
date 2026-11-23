import { createHash } from "node:crypto";

import type { AuthorizationDecision } from "./authorization-decision.repository.js";

/**
 * Business purpose: Produce one opaque retry identity for a complete canonical authorization decision.
 * Business rules:
 * - Actor, session, resource type/id, outcome, reason and correlation all participate in identity.
 * Execution flow:
 * 1. Serialize the ordered canonical tuple with explicit nulls.
 * 2. Hash it into a non-sensitive stable key shared by primary and recovery writers.
 * Failure cases:
 * - None; every typed authorization decision produces one deterministic key.
 * Side effects:
 * - None; this is a pure identity projection.
 */
export function authorizationDecisionKey(
  decision: AuthorizationDecision,
  occurrenceId: string,
): string {
  const canonicalTuple = JSON.stringify([
    occurrenceId,
    decision.actor_id ?? null,
    decision.session_id ?? null,
    decision.resource_type,
    decision.resource_id,
    decision.decision,
    decision.reason_code,
    decision.correlationId,
  ]);
  return `rbac-audit:${createHash("sha256").update(canonicalTuple).digest("hex")}`;
}
