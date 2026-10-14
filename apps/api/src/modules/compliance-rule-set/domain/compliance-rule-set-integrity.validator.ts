import { createHash } from "node:crypto";

import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  COMPLIANCE_RULE_SET_FAILURE_CODES,
  declaresApplicabilityScope,
  type ComplianceRuleSetFailureCode,
  type ComplianceRuleSetPacket,
  type ComplianceRuleSetSourceRef,
  type ComplianceRuleSetValidationFailure,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalEffectStatus } from "@lcsp/contracts/legal-source";

/** Legal status recorded on a chunk whose provision no longer has effect. */
const REPEALED_LEGAL_STATUS = "REPEALED";
const HIERARCHY_SEPARATOR = "::";
const APPLICABILITY_SCOPE_MISSING_DETAIL =
  "applicabilityConditions is empty: state whom or what the source applies this duty to and what triggers it, in the source's own terms, unpacking any defined role, class or category with the source's criteria";

export interface LegalSourceChunkSnapshot {
  id: string;
  documentId: string;
  locator: string;
  contentSha256: string;
  legalStatus: string;
  legalEffectStatus: LegalEffectStatus;
  legalStatusSourceRef: string | null;
  sourceEffectStatus: string;
}

export interface LegalSourceSnapshot {
  legalSourceVersionId: string;
  chunks: LegalSourceChunkSnapshot[];
  retrievalIndexValid: boolean;
}

/** True when `documentId` + `locator` carries `contentSha256` in a legalSource other than the pinned one. */
export type ForeignChunkHashLookup = (
  ref: ComplianceRuleSetSourceRef,
) => boolean;

export interface RuleSetValidationResult {
  failures: ComplianceRuleSetValidationFailure[];
  /** Server-resolved bindings keyed by sourceClaimKey; present only for refs that resolved cleanly. */
  resolved: Map<string, LegalSourceChunkSnapshot>;
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
 * Mechanical integrity validation of one complete rule set packet against the
 * one pinned legalSource: identity, hash, citation, locator, provenance, shape and
 * completeness only. It never classifies, interprets or repairs legal meaning.
 */
export function validateComplianceRuleSetPacket(
  packet: ComplianceRuleSetPacket,
  legalSource: LegalSourceSnapshot,
  isForeignChunkHash: ForeignChunkHashLookup,
): RuleSetValidationResult {
  const failures: ComplianceRuleSetValidationFailure[] = [];
  const resolved = new Map<string, LegalSourceChunkSnapshot>();
  const fail = (
    code: ComplianceRuleSetFailureCode,
    ref: string | null,
    detail: string | null = null,
  ) => failures.push({ code, ref, detail });

  if (!legalSource.retrievalIndexValid) {
    fail(COMPLIANCE_RULE_SET_FAILURE_CODES.RETRIEVAL_INDEX_NOT_VALID, null);
  }
  if (
    packet.legalRequirements.length === 0 ||
    packet.assessmentRules.length === 0
  ) {
    fail(COMPLIANCE_RULE_SET_FAILURE_CODES.EMPTY_RULE_SET, null);
  }

  // --- unique identities (rule set scope) ---------------------------------
  const legalRequirementIds = new Set<string>();
  for (const rule of packet.legalRequirements) {
    if (legalRequirementIds.has(rule.legalRequirementId)) {
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.DUPLICATE_RULE_ID,
        `legalRequirement:${rule.legalRequirementId}`,
      );
    }
    legalRequirementIds.add(rule.legalRequirementId);
  }
  const assessmentRuleIds = new Set<string>();
  for (const rule of packet.assessmentRules) {
    if (assessmentRuleIds.has(rule.assessmentRuleId)) {
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.DUPLICATE_ASSESSMENT_RULE_ID,
        `assessmentRule:${rule.assessmentRuleId}`,
      );
    }
    assessmentRuleIds.add(rule.assessmentRuleId);
    const criterionIds = new Set<string>();
    for (const criterion of rule.criteria) {
      if (criterionIds.has(criterion.criterionId)) {
        fail(
          COMPLIANCE_RULE_SET_FAILURE_CODES.DUPLICATE_ASSESSMENT_RULE_ID,
          `assessmentRule:${rule.assessmentRuleId}`,
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
        COMPLIANCE_RULE_SET_FAILURE_CODES.DUPLICATE_RULE_ID,
        `relation:${relation.relationId}`,
      );
    }
    relationIds.add(relation.relationId);
  }

  // --- source claims resolve to the one pinned legalSource ----------------------
  const chunkByKey = new Map(
    legalSource.chunks.map((chunk) => [sourceClaimKey(chunk), chunk] as const),
  );
  let cleanClaims = 0;
  let foreignClaims = 0;
  const checkedClaims = new Set<string>();
  const checkClaim = (ref: ComplianceRuleSetSourceRef, owner: string) => {
    const key = sourceClaimKey(ref);
    const chunk = chunkByKey.get(key);
    const refLabel = `${owner}|locator:${key}`;
    if (!chunk) {
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE,
        refLabel,
      );
      return;
    }
    if (chunk.contentSha256 !== ref.contentSha256) {
      if (isForeignChunkHash(ref)) foreignClaims += 1;
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.STALE_SOURCE_HASH,
        refLabel,
        "declared hash does not match the pinned legalSource content",
      );
      return;
    }
    if (chunk.legalStatus === REPEALED_LEGAL_STATUS) {
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.REPEALED_SOURCE_REFERENCE,
        refLabel,
      );
      return;
    }
    if (!checkedClaims.has(`${owner}|${key}`)) {
      checkedClaims.add(`${owner}|${key}`);
      cleanClaims += 1;
    }
    resolved.set(key, chunk);
  };
  for (const rule of packet.legalRequirements) {
    for (const ref of rule.sourceRefs)
      checkClaim(ref, `legalRequirement:${rule.legalRequirementId}`);
  }
  for (const rule of packet.assessmentRules) {
    for (const ref of rule.sourceRefs) {
      checkClaim(ref, `assessmentRule:${rule.assessmentRuleId}`);
    }
  }
  for (const relation of packet.contextRelations) {
    if (relation.toSourceRef) {
      checkClaim(relation.toSourceRef, `relation:${relation.relationId}`);
    }
  }
  // Refs that bind to different legalSource versions inside one packet.
  if (foreignClaims > 0 && cleanClaims > 0) {
    fail(
      COMPLIANCE_RULE_SET_FAILURE_CODES.MIXED_SOURCE_VERSION,
      null,
      "source claims bind to more than one legalSource version",
    );
  }

  // --- referential integrity ------------------------------------------------
  const linkedRuleIds = new Set<string>();
  for (const rule of packet.assessmentRules) {
    for (const legalRequirementId of rule.legalRequirementIds) {
      if (!legalRequirementIds.has(legalRequirementId)) {
        fail(
          COMPLIANCE_RULE_SET_FAILURE_CODES.ORPHAN_ASSESSMENT_RULE,
          `assessmentRule:${rule.assessmentRuleId}`,
          `unknown legal rule ${legalRequirementId}`,
        );
      } else {
        linkedRuleIds.add(legalRequirementId);
      }
    }
  }
  for (const relation of packet.contextRelations) {
    const label = `relation:${relation.relationId}`;
    if (!legalRequirementIds.has(relation.fromLegalRequirementId)) {
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.ORPHAN_CONTEXT_RELATION,
        label,
        `unknown source rule ${relation.fromLegalRequirementId}`,
      );
    }
    if (
      relation.toLegalRequirementId &&
      !legalRequirementIds.has(relation.toLegalRequirementId)
    ) {
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.ORPHAN_CONTEXT_RELATION,
        label,
        `unknown target rule ${relation.toLegalRequirementId}`,
      );
    }
  }

  // --- coverage -------------------------------------------------------------
  for (const rule of packet.legalRequirements) {
    const label = `legalRequirement:${rule.legalRequirementId}`;
    if (
      rule.coverage.state === LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE
    ) {
      if (!rule.coverage.nonAssessableReason?.trim()) {
        fail(
          COMPLIANCE_RULE_SET_FAILURE_CODES.NON_ASSESSABLE_REASON_REQUIRED,
          label,
        );
      }
    } else if (!linkedRuleIds.has(rule.legalRequirementId)) {
      fail(COMPLIANCE_RULE_SET_FAILURE_CODES.INCOMPLETE_RULE_COVERAGE, label);
    }
  }
  // An assessable requirement must declare whom or what the source applies it to. Only the
  // declaration is checked; what the scope means is for the authoring agent and the Assessment
  // Root to read from the pinned source.
  for (const rule of packet.legalRequirements) {
    if (
      !declaresApplicabilityScope(
        rule.coverage.state,
        rule.applicabilityConditions,
      )
    ) {
      fail(
        COMPLIANCE_RULE_SET_FAILURE_CODES.APPLICABILITY_SCOPE_MISSING,
        `legalRequirement:${rule.legalRequirementId}`,
        APPLICABILITY_SCOPE_MISSING_DETAIL,
      );
    }
  }
  // Every in-scope provision (non-repealed leaf chunk) is covered by a rule,
  // an AssessmentRule or a context relation: it or one of its ancestors must be
  // referenced. A NON_ASSESSABLE rule that cites it counts as covered.
  const referencedKeys = new Set(resolved.keys());
  const nonLeafKeys = new Set<string>();
  for (const chunk of legalSource.chunks) {
    for (const ancestor of ancestorLocators(chunk.locator)) {
      nonLeafKeys.add(
        sourceClaimKey({ documentId: chunk.documentId, locator: ancestor }),
      );
    }
  }
  for (const chunk of legalSource.chunks) {
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
        COMPLIANCE_RULE_SET_FAILURE_CODES.INCOMPLETE_SOURCE_COVERAGE,
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
