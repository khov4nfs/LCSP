import { canonicalJson, sha256Hex } from "./domain-ids.js";

export interface DecisionFingerprintEntry {
  decisionId: string;
  decisionRevision: number;
  decision: unknown;
}

/**
 * Fingerprints the decisions in the exact order serialized by the report.
 * Callers are responsible for supplying canonical rule order (the V2 builder
 * uses the pinned rule-set ordinal). No sorting is performed here because
 * sorting would erase the report's canonical ordering invariant.
 */
export function decisionFingerprint(
  entries: ReadonlyArray<DecisionFingerprintEntry>,
): string {
  return `sha256:${sha256Hex(
    canonicalJson(
      entries.map(({ decisionId, decisionRevision, decision }) => ({
        decisionId,
        decisionRevision,
        decision,
      })),
    ),
  )}`;
}
