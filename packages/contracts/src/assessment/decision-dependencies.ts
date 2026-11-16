import {
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionReferences,
  type RuleDecision,
} from "./agentic-runtime.ts";

export interface PersistedDecisionDependencyGraph {
  dependencyGraphComplete: boolean;
  evidenceDependencies: ReadonlyArray<{ evidenceId: string }>;
  factDependencies: ReadonlyArray<{ factId: string }>;
}

/**
 * Business purpose: Derive the exact direct support identities claimed by one validated rule decision.
 *
 * Business rules:
 * - Evidence and fact references from the decision, criteria, and applicability basis are all material dependencies.
 * - Duplicate references collapse to one stable edge; evidence behind a referenced fact stays an indirect edge through the fact-evidence ledger.
 *
 * Execution flow:
 * 1. Collect every decision reference through the shared contract projection.
 * 2. Partition evidence and fact identities, deduplicate them, and return stable sorted lists.
 *
 * Failure cases:
 * - Malformed decisions are rejected by the caller's contract parser before this function; no missing reference is invented.
 *
 * Side effects:
 * - Pure projection only; it does not validate, accept, or persist any dependency.
 */
export function decisionDependencyIds(decision: RuleDecision): {
  evidenceIds: string[];
  factIds: string[];
} {
  const evidenceIds = new Set<string>();
  const factIds = new Set<string>();
  for (const reference of ruleDecisionReferences(decision)) {
    if (reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE) {
      evidenceIds.add(reference.evidenceId);
    } else {
      factIds.add(reference.factId);
    }
  }
  return {
    evidenceIds: [...evidenceIds].sort(),
    factIds: [...factIds].sort(),
  };
}

/**
 * Business purpose: Decide whether a persisted dependency ledger exactly represents an immutable decision packet.
 *
 * Business rules:
 * - Only records explicitly marked complete may preserve a decision across unrelated case revisions.
 * - Persisted direct evidence and fact edges must exactly equal the decision packet; missing and extra edges both fail closed.
 *
 * Execution flow:
 * 1. Reject historical or explicitly incomplete records.
 * 2. Derive canonical packet identities and compare them with sorted unique persisted identities.
 *
 * Failure cases:
 * - Missing relation rows, duplicate/extra identities, or an incomplete marker return false and force normal stale-decision handling.
 *
 * Side effects:
 * - Pure integrity check; no decision, dependency, or assessment state is changed.
 */
export function decisionDependencyGraphIsComplete(
  decision: RuleDecision,
  persisted: PersistedDecisionDependencyGraph,
): boolean {
  if (!persisted.dependencyGraphComplete) return false;
  const expected = decisionDependencyIds(decision);
  const evidenceIds = [
    ...new Set(persisted.evidenceDependencies.map((row) => row.evidenceId)),
  ].sort();
  const factIds = [
    ...new Set(persisted.factDependencies.map((row) => row.factId)),
  ].sort();
  return (
    evidenceIds.length === persisted.evidenceDependencies.length &&
    factIds.length === persisted.factDependencies.length &&
    evidenceIds.length === expected.evidenceIds.length &&
    factIds.length === expected.factIds.length &&
    evidenceIds.every((id, index) => id === expected.evidenceIds[index]) &&
    factIds.every((id, index) => id === expected.factIds[index])
  );
}
