import { canonicalJson, sha256Hex } from "./domain-ids.js";

export interface DecisionFingerprintEntry {
  decisionId: string;
  decisionRevision: number;
  decision: unknown;
}

/**
 * Business purpose: Bind an immutable final report to the accepted assessment decision revisions it records.
 *
 * Business rules:
 * - Preserve caller-provided canonical rule order; sorting here would change the report's decision identity.
 * - Include each decision ID, revision, and decision value in the fingerprint input.
 *
 * Execution flow:
 * 1. Project the ordered decision entries to their identity, revision, and value.
 * 2. Serialize that projection canonically and prefix its SHA-256 digest.
 *
 * Failure cases:
 * - Invalid values that cannot be canonically serialized fail rather than producing a partial fingerprint.
 *
 * Side effects:
 * - None: computes a deterministic fingerprint in memory.
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
