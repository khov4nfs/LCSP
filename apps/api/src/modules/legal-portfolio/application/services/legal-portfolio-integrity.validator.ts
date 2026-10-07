import { createHash } from "node:crypto";

import {
  LEGAL_PORTFOLIO_COVERAGE_STATES,
  LEGAL_PORTFOLIO_FAILURE_CODES,
  type LegalPortfolioFailureCode,
  type LegalPortfolioPacket,
  type LegalPortfolioSourceRef,
  type LegalPortfolioValidationFailure,
} from "@lcsp/contracts/legal-portfolio";

/** Legal status recorded on a chunk whose provision no longer has effect. */
const REPEALED_LEGAL_STATUS = "REPEALED";
const HIERARCHY_SEPARATOR = "::";

export interface CorpusChunkSnapshot {
  id: string;
  documentId: string;
  locator: string;
  contentSha256: string;
  legalStatus: string;
  sourceEffectStatus: string;
}

export interface CorpusSnapshot {
  corpusVersionId: string;
  chunks: CorpusChunkSnapshot[];
  retrievalIndexValid: boolean;
}

/** True when `documentId` + `locator` carries `contentSha256` in a corpus other than the pinned one. */
export type ForeignChunkHashLookup = (ref: LegalPortfolioSourceRef) => boolean;

export interface PortfolioValidationResult {
  failures: LegalPortfolioValidationFailure[];
  /** Server-resolved bindings keyed by sourceClaimKey; present only for refs that resolved cleanly. */
  resolved: Map<string, CorpusChunkSnapshot>;
}

export function sourceClaimKey(ref: {
  documentId: string;
  locator: string;
}): string {
  return `${ref.documentId}${HIERARCHY_SEPARATOR}${ref.locator}`;
}

/** Stable JSON: object keys sorted, so equal packets always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** "art-5::cl-1::pt-a" -> ["art-5::cl-1", "art-5"]. */
function ancestorLocators(locator: string): string[] {
  const parts = locator.split(HIERARCHY_SEPARATOR);
  const ancestors: string[] = [];
  for (let length = parts.length - 1; length > 0; length -= 1) {
    ancestors.push(parts.slice(0, length).join(HIERARCHY_SEPARATOR));
  }
  return ancestors;
}

/**
 * Mechanical integrity validation of one complete portfolio packet against the
 * one pinned corpus: identity, hash, citation, locator, provenance, shape and
 * completeness only. It never classifies, interprets or repairs legal meaning.
 */
export function validateLegalPortfolioPacket(
  packet: LegalPortfolioPacket,
  corpus: CorpusSnapshot,
  isForeignChunkHash: ForeignChunkHashLookup,
): PortfolioValidationResult {
  const failures: LegalPortfolioValidationFailure[] = [];
  const resolved = new Map<string, CorpusChunkSnapshot>();
  const fail = (
    code: LegalPortfolioFailureCode,
    ref: string | null,
    detail: string | null = null,
  ) => failures.push({ code, ref, detail });

  if (!corpus.retrievalIndexValid) {
    fail(LEGAL_PORTFOLIO_FAILURE_CODES.RETRIEVAL_INDEX_NOT_VALID, null);
  }
  if (packet.legalRules.length === 0 || packet.engineeringRules.length === 0) {
    fail(LEGAL_PORTFOLIO_FAILURE_CODES.EMPTY_PORTFOLIO, null);
  }

  // --- unique identities (portfolio scope) ---------------------------------
  const legalRuleIds = new Set<string>();
  for (const rule of packet.legalRules) {
    if (legalRuleIds.has(rule.legalRuleId)) {
      fail(
        LEGAL_PORTFOLIO_FAILURE_CODES.DUPLICATE_RULE_ID,
        `legalRule:${rule.legalRuleId}`,
      );
    }
    legalRuleIds.add(rule.legalRuleId);
  }
  const engineeringRuleIds = new Set<string>();
  for (const rule of packet.engineeringRules) {
    if (engineeringRuleIds.has(rule.engineeringRuleId)) {
      fail(
        LEGAL_PORTFOLIO_FAILURE_CODES.DUPLICATE_ENGINEERING_RULE_ID,
        `engineeringRule:${rule.engineeringRuleId}`,
      );
    }
    engineeringRuleIds.add(rule.engineeringRuleId);
    const criterionIds = new Set<string>();
    for (const criterion of rule.criteria) {
      if (criterionIds.has(criterion.criterionId)) {
        fail(
          LEGAL_PORTFOLIO_FAILURE_CODES.DUPLICATE_ENGINEERING_RULE_ID,
          `engineeringRule:${rule.engineeringRuleId}`,
          `duplicate criterion ${criterion.criterionId}`,
        );
      }
      criterionIds.add(criterion.criterionId);
    }
  }
  const relationIds = new Set<string>();
  for (const relation of packet.contextRelations) {
    if (relationIds.has(relation.relationId)) {
      fail(
        LEGAL_PORTFOLIO_FAILURE_CODES.DUPLICATE_RULE_ID,
        `relation:${relation.relationId}`,
      );
    }
    relationIds.add(relation.relationId);
  }

  // --- source claims resolve to the one pinned corpus ----------------------
  const chunkByKey = new Map(
    corpus.chunks.map((chunk) => [sourceClaimKey(chunk), chunk] as const),
  );
  let cleanClaims = 0;
  let foreignClaims = 0;
  const checkedClaims = new Set<string>();
  const checkClaim = (ref: LegalPortfolioSourceRef, owner: string) => {
    const key = sourceClaimKey(ref);
    const chunk = chunkByKey.get(key);
    const refLabel = `${owner}|locator:${key}`;
    if (!chunk) {
      fail(LEGAL_PORTFOLIO_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE, refLabel);
      return;
    }
    if (chunk.contentSha256 !== ref.contentSha256) {
      if (isForeignChunkHash(ref)) foreignClaims += 1;
      fail(
        LEGAL_PORTFOLIO_FAILURE_CODES.STALE_SOURCE_HASH,
        refLabel,
        "declared hash does not match the pinned corpus content",
      );
      return;
    }
    if (chunk.legalStatus === REPEALED_LEGAL_STATUS) {
      fail(LEGAL_PORTFOLIO_FAILURE_CODES.REPEALED_SOURCE_REFERENCE, refLabel);
      return;
    }
    if (!checkedClaims.has(`${owner}|${key}`)) {
      checkedClaims.add(`${owner}|${key}`);
      cleanClaims += 1;
    }
    resolved.set(key, chunk);
  };
  for (const rule of packet.legalRules) {
    for (const ref of rule.sourceRefs)
      checkClaim(ref, `legalRule:${rule.legalRuleId}`);
  }
  for (const rule of packet.engineeringRules) {
    for (const ref of rule.sourceRefs) {
      checkClaim(ref, `engineeringRule:${rule.engineeringRuleId}`);
    }
  }
  for (const relation of packet.contextRelations) {
    if (relation.toSourceRef) {
      checkClaim(relation.toSourceRef, `relation:${relation.relationId}`);
    }
  }
  // Refs that bind to different corpus versions inside one packet.
  if (foreignClaims > 0 && cleanClaims > 0) {
    fail(
      LEGAL_PORTFOLIO_FAILURE_CODES.MIXED_CORPUS_VERSION,
      null,
      "source claims bind to more than one corpus version",
    );
  }

  // --- referential integrity ------------------------------------------------
  const linkedRuleIds = new Set<string>();
  for (const rule of packet.engineeringRules) {
    for (const legalRuleId of rule.legalRuleIds) {
      if (!legalRuleIds.has(legalRuleId)) {
        fail(
          LEGAL_PORTFOLIO_FAILURE_CODES.ORPHAN_ENGINEERING_RULE,
          `engineeringRule:${rule.engineeringRuleId}`,
          `unknown legal rule ${legalRuleId}`,
        );
      } else {
        linkedRuleIds.add(legalRuleId);
      }
    }
  }
  for (const relation of packet.contextRelations) {
    const label = `relation:${relation.relationId}`;
    if (!legalRuleIds.has(relation.fromLegalRuleId)) {
      fail(
        LEGAL_PORTFOLIO_FAILURE_CODES.ORPHAN_CONTEXT_RELATION,
        label,
        `unknown source rule ${relation.fromLegalRuleId}`,
      );
    }
    if (relation.toLegalRuleId && !legalRuleIds.has(relation.toLegalRuleId)) {
      fail(
        LEGAL_PORTFOLIO_FAILURE_CODES.ORPHAN_CONTEXT_RELATION,
        label,
        `unknown target rule ${relation.toLegalRuleId}`,
      );
    }
  }

  // --- coverage -------------------------------------------------------------
  for (const rule of packet.legalRules) {
    const label = `legalRule:${rule.legalRuleId}`;
    if (
      rule.coverage.state === LEGAL_PORTFOLIO_COVERAGE_STATES.NON_ASSESSABLE
    ) {
      if (!rule.coverage.nonAssessableReason?.trim()) {
        fail(
          LEGAL_PORTFOLIO_FAILURE_CODES.NON_ASSESSABLE_REASON_REQUIRED,
          label,
        );
      }
    } else if (!linkedRuleIds.has(rule.legalRuleId)) {
      fail(LEGAL_PORTFOLIO_FAILURE_CODES.INCOMPLETE_RULE_COVERAGE, label);
    }
  }
  // Every in-scope provision (non-repealed leaf chunk) is covered by a rule,
  // an EngineeringRule or a context relation: it or one of its ancestors must be
  // referenced. A NON_ASSESSABLE rule that cites it counts as covered.
  const referencedKeys = new Set(resolved.keys());
  const nonLeafKeys = new Set<string>();
  for (const chunk of corpus.chunks) {
    for (const ancestor of ancestorLocators(chunk.locator)) {
      nonLeafKeys.add(
        sourceClaimKey({ documentId: chunk.documentId, locator: ancestor }),
      );
    }
  }
  for (const chunk of corpus.chunks) {
    const key = sourceClaimKey(chunk);
    if (chunk.legalStatus === REPEALED_LEGAL_STATUS || nonLeafKeys.has(key))
      continue;
    const covered = [chunk.locator, ...ancestorLocators(chunk.locator)].some(
      (locator) =>
        referencedKeys.has(
          sourceClaimKey({ documentId: chunk.documentId, locator }),
        ),
    );
    if (!covered) {
      fail(
        LEGAL_PORTFOLIO_FAILURE_CODES.INCOMPLETE_SOURCE_COVERAGE,
        `locator:${key}`,
      );
    }
  }

  const seen = new Set<string>();
  const unique = failures
    .filter((failure) => {
      const key = `${failure.code}|${failure.ref}|${failure.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      `${a.code}|${a.ref}|${a.detail}`.localeCompare(
        `${b.code}|${b.ref}|${b.detail}`,
      ),
    );
  return { failures: unique, resolved };
}
