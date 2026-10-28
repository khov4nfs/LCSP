import { createHash } from "node:crypto";
import {
  LEGAL_SEMANTIC_AUTHORITIES as AUTH,
  LEGAL_ASSESSABILITIES as ASSESS,
  SEMANTIC_INTEGRITY_GAP_CODES as G,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  LEGAL_CLAIM_STATES as S,
  LEGAL_SEMANTIC_GRAPH_VERSION,
  type LegalSemanticGraph,
  type LegalSemanticClaim,
  type ComplianceRuleSetValidationFailure,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalDocumentGraph } from "@lcsp/contracts/legal-source";
import { inventoryHash } from "./claim-inventory.js";
/**
 * Business purpose: Test whether an allowed semantic kind is present in a closed rule set.
 *
 * Business rules:
 * - Membership uses exact string equality; unknown relation or claim kinds are not coerced.
 *
 * Execution flow:
 * 1. Check the supplied allowed values for the requested kind.
 *
 * Failure cases:
 * - None; an absent value returns false.
 *
 * Side effects:
 * - None; performs a read-only membership check.
 */
const has = (values: readonly string[], value: string) =>
  values.includes(value);
const norm = new Set<string>([C.DUTY, C.PROHIBITION, C.PERMISSION]);
/**
 * Business purpose: Identify a relevant legal normative claim that can anchor a Requirement closure.
 *
 * Business rules:
 * - A claim is operative only when it is relevant, has LEGAL_NORMATIVE authority, and is a duty, prohibition, or permission.
 * - Claim type alone cannot establish an operative proposition.
 *
 * Execution flow:
 * 1. Reject an absent claim.
 * 2. Require relevant state, normative authority, and membership in the operative-type set.
 *
 * Failure cases:
 * - Returns false for absent, excluded, non-normative, or non-operative claims.
 *
 * Side effects:
 * - None; classifies only already-authored claim metadata.
 */
export const operativeClaim = (c: LegalSemanticClaim | undefined) =>
  !!c &&
  c.state === S.RELEVANT &&
  c.semanticAuthority === AUTH.LEGAL_NORMATIVE &&
  norm.has(c.claimType);
/**
 * Business purpose: Compute the SHA-256 digest of a source-support text slice for the caller's comparison.
 *
 * Business rules:
 * - Hash the supplied string without normalization; the caller owns span bounds and comparison with the recorded digest.
 *
 * Execution flow:
 * 1. Feed the source slice into SHA-256.
 * 2. Return the hexadecimal digest for source-support comparison.
 *
 * Failure cases:
 * - Hashing errors propagate; no fallback digest is used.
 *
 * Side effects:
 * - None; hashes text in memory.
 */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/**
 * Business purpose: Produce deterministic ordering for claim closures and validation projections.
 *
 * Business rules:
 * - The caller-provided key defines ordering; input rows are not reordered in place.
 *
 * Execution flow:
 * 1. Copy the rows.
 * 2. Sort the copy by locale-comparison of each derived key.
 *
 * Failure cases:
 * - Key or comparison errors propagate from the supplied key function/runtime.
 *
 * Side effects:
 * - None; returns a sorted copy.
 */
const sorted = <T>(rows: T[], key: (r: T) => string) =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b)));

/**
 * Business purpose: Verify that a semantic claim's declared evidence spans and semantic frame are structurally supported by the pinned document graph.
 *
 * Business rules:
 * - Support spans must cover every claim anchor without extra anchors; each span must be nonempty, unique, bounded, and hash-matched to the pinned node text.
 * - Effect targets and dates must be structurally coherent; definitions need definition authority, and mixed assessability must name both evidence aspects.
 * - This validator checks cited structure and metadata; it does not decide what legal meaning the source text carries.
 *
 * Execution flow:
 * 1. Require source spans, semantic frame, authority, and assessability, then match span anchors to claim source nodes.
 * 2. Validate effect targets, duplicate spans, integer bounds, Unicode boundaries, exact span hashes, and nonblank source text.
 * 3. Check definition authority and mixed-assessability evidence fields.
 *
 * Failure cases:
 * - Returns the first applicable typed gap for missing support, anchor mismatch, malformed source span/effect, wrong authority, or incomplete mixed assessability.
 *
 * Side effects:
 * - None; reads claim and pinned source nodes only.
 */
export function sourceSupportFailures(
  claim: LegalSemanticClaim,
  source: LegalDocumentGraph,
): string[] {
  const supports = claim.sourceSupport;
  if (
    !supports?.length ||
    !claim.semanticFrame ||
    !claim.semanticAuthority ||
    !claim.assessability
  )
    return [G.SOURCE_SUPPORT_AND_FRAME_REQUIRED];
  if (
    new Set(supports.map((s) => s.nodeId)).size !==
      claim.sourceNodeIds.length ||
    claim.sourceNodeIds.some((id) => !supports.some((s) => s.nodeId === id))
  )
    return [G.SOURCE_SUPPORT_ANCHOR_MISMATCH];
  const seen = new Set<string>();
  const effect = claim.semanticFrame.legalEffect;
  if (
    effect &&
    (effect.targets.length + effect.unresolvedTargets.length === 0 ||
      new Set(effect.targets.map((t) => t.nodeId)).size !==
        effect.targets.length ||
      effect.targets.some(
        (t) => !source.nodes.some((n) => n.nodeId === t.nodeId),
      ) ||
      (effect.effectiveFrom &&
        effect.effectiveUntil &&
        effect.effectiveFrom >= effect.effectiveUntil))
  )
    return [F.SOURCE_SUPPORT_INVALID];
  for (const span of supports) {
    const node = source.nodes.find((n) => n.nodeId === span.nodeId);
    const key = `${span.nodeId}:${span.startOffset}:${span.endOffset}`;
    if (
      !node ||
      !claim.sourceNodeIds.includes(span.nodeId) ||
      seen.has(key) ||
      !Number.isInteger(span.startOffset) ||
      !Number.isInteger(span.endOffset) ||
      span.startOffset < 0 ||
      span.endOffset <= span.startOffset ||
      span.endOffset > node.content.length ||
      /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(
        node.content.slice(span.startOffset, span.endOffset),
      ) ||
      sha(node.content.slice(span.startOffset, span.endOffset)) !==
        span.contentSha256 ||
      !node.content.slice(span.startOffset, span.endOffset).trim()
    )
      return [F.SOURCE_SUPPORT_INVALID];
    seen.add(key);
  }
  if (
    claim.claimType === C.DEFINITION &&
    claim.semanticAuthority !== AUTH.DEFINITION
  )
    return [G.WRONG_SEMANTIC_AUTHORITY];
  if (
    claim.assessability === ASSESS.MIXED &&
    (!claim.semanticFrame.repositoryObservableAspect ||
      !claim.semanticFrame.externalFulfillmentAspect)
  )
    return [G.MIXED_ASSESSABILITY_ASPECTS_REQUIRED];
  return [];
}

const modifierKinds: Record<string, string[]> = {
  [C.CONDITION]: [R.CONDITION_OF],
  [C.SCOPE]: [R.CONDITION_OF],
  [C.QUALIFIER]: [R.QUALIFIES],
  [C.EXCEPTION]: [R.EXCEPTION_TO],
  [C.TEMPORAL_RULE]: [R.TEMPORALLY_APPLIES_TO],
  [C.TRANSITION_RULE]: [R.TEMPORALLY_APPLIES_TO],
};
const inward = new Set<string>([
  R.CONDITION_OF,
  R.QUALIFIES,
  R.EXCEPTION_TO,
  R.TEMPORALLY_APPLIES_TO,
  R.EVIDENCE_SLICE_OF,
  R.PRESERVES,
  R.CONTEXT_FOR,
]);
/**
 * Business purpose: Find incomplete or directionally invalid relationships in the authored semantic claim graph.
 *
 * Business rules:
 * - Relevant modifiers and guidance claims require their permitted relation kinds.
 * - Relation endpoints must exist and their types/authorities must support the declared direction.
 * - Each relevant modifier must reach a normative operative anchor through the accepted inward relation set; a cycle alone is insufficient.
 *
 * Execution flow:
 * 1. Index claims and detect unlinked modifiers and free-floating guidance.
 * 2. Validate each relation endpoint and allowed kind/authority pairing.
 * 3. Traverse inward relationships from each modifier and report modifiers without a normative anchor.
 *
 * Failure cases:
 * - Returns stable gap codes identifying missing links, unknown endpoints, wrong relation direction/type, or unanchored modifiers.
 *
 * Side effects:
 * - None; computes topology failures without altering the graph.
 */
export function semanticTopologyFailures(graph: LegalSemanticGraph): string[] {
  const claims = new Map(graph.claims.map((c) => [c.claimId, c]));
  const gaps: string[] = [];
  for (const c of claims.values()) {
    if (c.state !== S.RELEVANT) continue;
    const kinds = modifierKinds[c.claimType];
    if (
      kinds &&
      !graph.relations.some(
        (r) => r.fromClaimId === c.claimId && kinds.includes(r.kind),
      )
    )
      gaps.push(`${G.FREE_FLOATING_MODIFIER}:${c.claimId}`);
    if (
      [AUTH.EVIDENCE_GUIDANCE, AUTH.ASSESSMENT_GUIDANCE].includes(
        c.semanticAuthority as never,
      ) &&
      !graph.relations.some(
        (r) => r.fromClaimId === c.claimId && r.kind === R.EVIDENCE_SLICE_OF,
      )
    )
      gaps.push(`${G.FREE_FLOATING_GUIDANCE}:${c.claimId}`);
  }
  for (const r of graph.relations) {
    const from = claims.get(r.fromClaimId),
      to = claims.get(r.toClaimId);
    if (!from || !to) {
      gaps.push(`${G.UNKNOWN_ENDPOINT}:${r.relationId}`);
      continue;
    }
    const expected = modifierKinds[from.claimType];
    if (
      (has([R.QUALIFIES, R.EXCEPTION_TO, R.TEMPORALLY_APPLIES_TO], r.kind) &&
        (!expected?.includes(r.kind) || !operativeClaim(to))) ||
      (r.kind === R.CONDITION_OF &&
        (!has([C.CONDITION, C.SCOPE], from.claimType) ||
          !(operativeClaim(to) || !!modifierKinds[to.claimType]))) ||
      (r.kind === R.DEFINED_BY && to.semanticAuthority !== AUTH.DEFINITION) ||
      (r.kind === R.PRESERVES &&
        (!operativeClaim(to) ||
          from.semanticAuthority !== AUTH.LEGAL_NORMATIVE)) ||
      (r.kind === R.EVIDENCE_SLICE_OF &&
        (!(
          from.semanticAuthority === AUTH.EVIDENCE_GUIDANCE ||
          from.semanticAuthority === AUTH.ASSESSMENT_GUIDANCE
        ) ||
          !operativeClaim(to)))
    )
      gaps.push(`${G.WRONG_RELATION}:${r.relationId}`);
  }
  // Every modifier must reach a normative anchor, including condition chains. Cycles alone prove nothing.
  for (const c of claims.values())
    if (c.state === S.RELEVANT && modifierKinds[c.claimType]) {
      const seen = new Set<string>(),
        queue = [c.claimId];
      let anchored = false;
      while (queue.length) {
        const id = queue.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (id !== c.claimId && operativeClaim(claims.get(id))) {
          anchored = true;
          break;
        }
        for (const r of graph.relations)
          if (r.fromClaimId === id && inward.has(r.kind))
            queue.push(r.toClaimId);
      }
      if (!anchored) gaps.push(`${G.UNANCHORED_MODIFIER}:${c.claimId}`);
    }
  return gaps;
}

/**
 * Business purpose: Compute the authored semantic claim closure around one operative proposition; separate gates validate source support.
 *
 * Business rules:
 * - Only a relevant legal normative duty, prohibition, or permission can anchor a closure.
 * - Closure follows inward semantic modifiers/context and outward definitions, incorporation, or cross-reference dependencies while preserving branch-local conditions.
 * - Conflicting non-context accounting roles are rejected instead of flattening incompatible meanings.
 *
 * Execution flow:
 * 1. Validate and assign the operative role to the anchor.
 * 2. Traverse the permitted relation directions, assigning each relevant claim its context, definition, applicability, exception, or qualifier role.
 * 3. Return claims, internal relation IDs, and operative reference dependencies in deterministic order.
 *
 * Failure cases:
 * - Throws when the anchor is absent/non-operative or when a claim receives conflicting closure roles.
 *
 * Side effects:
 * - None; computes an in-memory closure and does not interpret unrepresented source prose.
 */
export function semanticClosure(graph: LegalSemanticGraph, anchorId: string) {
  const claims = new Map(graph.claims.map((c) => [c.claimId, c]));
  const anchor = claims.get(anchorId);
  if (!anchor || !operativeClaim(anchor))
    throw new Error("Verified legal normative operative anchor required");
  const roles = new Map<string, string>([
    [anchorId, ROLE.OPERATIVE_PROPOSITION],
  ]);
  const queue = [anchorId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of graph.relations) {
      const incoming = r.toClaimId === id && inward.has(r.kind);
      const outgoing =
        r.fromClaimId === id &&
        has([R.DEFINED_BY, R.INCORPORATES, R.CROSS_REFERENCE], r.kind);
      if (!incoming && !outgoing) continue;
      const target = incoming ? r.fromClaimId : r.toClaimId,
        c = claims.get(target);
      if (!c || c.state !== S.RELEVANT || operativeClaim(c)) continue;
      // A branch-local condition stays with its modifier; flattening it into global applicability would turn alternatives into conjunctions.
      const role =
        r.kind === R.PRESERVES ||
        r.kind === R.EVIDENCE_SLICE_OF ||
        r.kind === R.CONTEXT_FOR ||
        (r.kind === R.CONDITION_OF && !operativeClaim(claims.get(id)))
          ? ROLE.CONTEXT
          : c.semanticAuthority === AUTH.DEFINITION
            ? ROLE.DEFINITION
            : has([C.CONDITION, C.SCOPE], c.claimType)
              ? ROLE.APPLICABILITY_CONDITION
              : c.claimType === C.EXCEPTION
                ? ROLE.EXCEPTION
                : has(
                      [C.QUALIFIER, C.TEMPORAL_RULE, C.TRANSITION_RULE],
                      c.claimType,
                    )
                  ? ROLE.QUALIFIER
                  : ROLE.CONTEXT;
      if (roles.has(target)) {
        const existing = roles.get(target)!;
        if (existing === role || role === ROLE.CONTEXT) continue;
        if (existing !== ROLE.CONTEXT)
          throw new Error(`${G.CONFLICTING_CLOSURE_ROLE}:${target}`);
        roles.set(target, role);
        continue;
      }
      roles.set(target, role);
      queue.push(target);
    }
  }
  return {
    anchorId,
    claims: sorted(
      [...roles].map(([claimId, role]) => ({ claimId, role })),
      (c) => c.claimId,
    ),
    relationIds: graph.relations
      .filter((r) => roles.has(r.fromClaimId) && roles.has(r.toClaimId))
      .map((r) => r.relationId)
      .sort(),
    referenceDependencies: sorted(
      graph.relations.filter(
        (r) =>
          roles.has(r.fromClaimId) &&
          r.toClaimId !== anchorId &&
          operativeClaim(claims.get(r.toClaimId)) &&
          has([R.INCORPORATES, R.CROSS_REFERENCE, R.PRESERVES], r.kind),
      ),
      (r) => r.relationId,
    ),
  };
}
/**
 * Business purpose: Confirm that a LegalRequirement accounts for the complete semantic closure of its operative propositions.
 *
 * Business rules:
 * - At least one valid operative anchor is required, and aggregated anchors must have compatible actor, modality, assessability, and modifier profiles.
 * - Supplied claim-role bindings must equal the permitted closures: no outside binding and no omitted semantic condition, exception, qualifier, or context.
 * - External/non-assessable operative duties must be explicitly marked as non-repository and non-assessable; repository-verifiable duties cannot be marked that way.
 *
 * Execution flow:
 * 1. Resolve operative bindings and derive each anchor's semantic closure.
 * 2. Compare anchor profiles and the supplied role pairs against the union of allowed closures.
 * 3. Check that duty coverage metadata agrees with the anchors' assessability.
 *
 * Failure cases:
 * - Returns gap codes for missing anchors, incompatible aggregation, incomplete/outside closure bindings, or inconsistent duty coverage.
 * - A conflicting role discovered while deriving a closure propagates from semanticClosure; it is never accepted as a valid closure.
 *
 * Side effects:
 * - None; validates supplied bindings and metadata.
 */
export function requirementClosureFailures(
  graph: LegalSemanticGraph,
  bindings: { claimId: string; role: string }[],
  nonRepositoryDuty: boolean,
  nonAssessable: boolean,
): string[] {
  const anchors = bindings
    .filter((b) => b.role === ROLE.OPERATIVE_PROPOSITION)
    .map((b) => graph.claims.find((c) => c.claimId === b.claimId));
  if (!anchors.length || anchors.some((c) => !c || !operativeClaim(c)))
    return [G.LEGAL_NORMATIVE_ANCHOR_REQUIRED];
  const closures = anchors.map((c) => semanticClosure(graph, c!.claimId));
  /**
   * Business purpose: Create the comparison key used to decide whether multiple operative anchors can share one Requirement.
   *
   * Business rules:
   * - Compatibility includes actor, modality, assessability, and closure modifiers that affect applicability or obligation shape.
   * - Claim prose outside those structured semantic fields does not make an incompatible profile compatible.
   *
   * Execution flow:
   * 1. Read the selected operative anchor and its closure.
   * 2. Hash its structured profile and modifier bindings.
   *
   * Failure cases:
   * - Invalid anchor indexing or closure calculation errors propagate to the parent validator.
   *
   * Side effects:
   * - None; computes a comparison digest.
   */
  const profile = (i: number) =>
    inventoryHash({
      actor: anchors[i]!.operative?.actor,
      modality: anchors[i]!.operative?.modality,
      assessability: anchors[i]!.assessability,
      modifiers: closures[i].claims.filter((c) =>
        [ROLE.APPLICABILITY_CONDITION, ROLE.QUALIFIER, ROLE.EXCEPTION].includes(
          c.role as never,
        ),
      ),
    });
  if (anchors.some((_, i) => profile(i) !== profile(0)))
    return [G.INCOMPATIBLE_OPERATIVE_AGGREGATION];
  const allowed = new Set(
    closures.flatMap((c) => c.claims.map((b) => `${b.claimId}:${b.role}`)),
  );
  const supplied = new Set(bindings.map((b) => `${b.claimId}:${b.role}`));
  const gaps: string[] = [...supplied].some((key) => !allowed.has(key))
    ? [G.BINDING_OUTSIDE_SEMANTIC_CLOSURE]
    : [];
  if ([...allowed].some((key) => !supplied.has(key)))
    gaps.push(G.INCOMPLETE_SEMANTIC_CLOSURE);
  if (
    anchors.some((c) =>
      [ASSESS.EXTERNAL_FULFILLMENT, ASSESS.NON_ASSESSABLE].includes(
        c!.assessability as never,
      ),
    ) &&
    (!nonRepositoryDuty || !nonAssessable)
  )
    gaps.push(G.EXTERNAL_FULFILLMENT_NOT_REPOSITORY_PROVEN);
  if (
    anchors.some((c) =>
      [ASSESS.REPOSITORY_VERIFIABLE, ASSESS.MIXED].includes(
        c!.assessability as never,
      ),
    ) &&
    (nonRepositoryDuty || nonAssessable)
  )
    gaps.push(G.REPOSITORY_ASSESSABLE_DUTY_NOT_COVERED);
  return gaps;
}

/**
 * Business purpose: Gate a new frozen semantic inventory on current graph contract, evidence provenance, and coherent semantic closure.
 *
 * Business rules:
 * - New inventories must use the current semantic graph contract; historical graph versions are not silently upgraded.
 * - Every claim must pass pinned source-support and topology validation.
 * - Every operative claim must yield a non-conflicting semantic closure before freeze.
 *
 * Execution flow:
 * 1. Check semantic graph contract version and collect source-support gaps for every claim.
 * 2. Add graph topology failures.
 * 3. Attempt each operative closure and record any closure exception as a validation failure.
 *
 * Failure cases:
 * - Returns all discovered contract, support, topology, and closure failures; it does not suppress earlier failures when another gate fails.
 *
 * Side effects:
 * - None; creates an in-memory validation result.
 */
export function semanticFreezeFailures(
  graph: LegalSemanticGraph,
  source: LegalDocumentGraph,
): ComplianceRuleSetValidationFailure[] {
  const failures: ComplianceRuleSetValidationFailure[] = [];
  /**
   * Business purpose: Append one typed semantic-freeze failure with its affected reference and explanation.
   *
   * Business rules:
   * - Failure codes and references are preserved exactly as supplied by the responsible validation gate.
   *
   * Execution flow:
   * 1. Accept the failure code, reference, and explanatory detail.
   * 2. Append one structured failure to the current result.
   *
   * Failure cases:
   * - Invalid result construction propagates as an ordinary in-memory error.
   *
   * Side effects:
   * - Mutates only the local failures array; no persistence or external action occurs.
   */
  const fail = (
    code: ComplianceRuleSetValidationFailure["code"],
    ref: string,
    detail: string,
  ) => failures.push({ code, ref, detail });
  if (graph.contractVersion !== LEGAL_SEMANTIC_GRAPH_VERSION)
    fail(
      F.SOURCE_SUPPORT_INVALID,
      "semanticGraph",
      "New inventories require source-supported LEGAL_GRAPH_V3; historical V2 remains read-only",
    );
  for (const claim of graph.claims)
    for (const gap of sourceSupportFailures(claim, source))
      fail(F.SOURCE_SUPPORT_INVALID, `claim:${claim.claimId}`, gap);
  for (const gap of semanticTopologyFailures(graph))
    fail(F.SEMANTIC_CLOSURE_INVALID, "semanticGraph", gap);
  for (const claim of graph.claims.filter(operativeClaim)) {
    try {
      semanticClosure(graph, claim.claimId);
    } catch (error) {
      fail(
        F.SEMANTIC_CLOSURE_INVALID,
        `claim:${claim.claimId}`,
        error instanceof Error ? error.message : "Incoherent semantic closure",
      );
    }
  }
  return failures;
}
import {
  LEGAL_EFFECT_KINDS,
  LEGAL_EFFECT_TARGET_SCOPES,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_SOURCE_CHUNK_STATUSES } from "@lcsp/contracts/legal-source";

/** Project authored effects on the existing pinned AST; never mutate the original text/status. */
/**
 * Business purpose: Resolve a pinned document node's effective legal status from persisted status and authored, date-bound effect claims.
 *
 * Business rules:
 * - Only non-reference effects that target the node (or its same-document subtree) and are active at the inventory target date are considered.
 * - Conditional, unresolved, undated, or conflicting effects remain UNKNOWN rather than being treated as effective.
 * - Repeal/suspension yields REPEALED; amendment/replacement remains UNKNOWN unless the effect claim is supported by the supplied source nodes.
 * - The original source status is retained whenever no unambiguous applicable effect establishes a change.
 *
 * Execution flow:
 * 1. Resolve the requested node and target date, falling back to persisted status or UNKNOWN when unavailable.
 * 2. Select date-applicable effects that target this node or an enclosing subtree.
 * 3. Return UNKNOWN for unresolved effect conditions/targets or mixed effect kinds; otherwise apply the determinate status rule.
 *
 * Failure cases:
 * - Missing node/date returns the persisted node status when available, otherwise UNKNOWN; it never fabricates current effectiveness.
 *
 * Side effects:
 * - None; derives a status projection without changing the pinned source text or status.
 */
export function effectiveSourceStatus(
  source: LegalDocumentGraph,
  graph: LegalSemanticGraph,
  nodeId: string,
  supportingNodeIds: readonly string[] = [],
) {
  const node = source.nodes.find((n) => n.nodeId === nodeId);
  if (!node || !graph.targetDate)
    return node?.legalEffectStatus ?? LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN;
  const at = graph.targetDate;
  const affected = graph.claims.flatMap((c) => {
    const effect = c.semanticFrame?.legalEffect;
    if (!effect || effect.kind === LEGAL_EFFECT_KINDS.REFERENCES) return [];
    const targets = effect.targets.some((t) => {
      const target = source.nodes.find((n) => n.nodeId === t.nodeId);
      return (
        t.nodeId === nodeId ||
        (t.scope === LEGAL_EFFECT_TARGET_SCOPES.SUBTREE &&
          target?.documentId === node.documentId &&
          node.structuralPath.startsWith(target.structuralPath + "/"))
      );
    });
    if (
      !targets ||
      (effect.effectiveFrom && effect.effectiveFrom > at) ||
      (effect.effectiveUntil && effect.effectiveUntil <= at)
    )
      return [];
    return [{ claim: c, effect }];
  });
  if (!affected.length) return node.legalEffectStatus;
  if (
    affected.some(
      ({ effect }) =>
        !effect.effectiveFrom ||
        effect.conditions ||
        effect.unresolvedTargets.length,
    )
  )
    return LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN;
  const kinds = new Set(affected.map(({ effect }) => effect.kind));
  if (kinds.size > 1) return LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN;
  if (
    kinds.has(LEGAL_EFFECT_KINDS.REPEALS) ||
    kinds.has(LEGAL_EFFECT_KINDS.SUSPENDS)
  )
    return LEGAL_SOURCE_CHUNK_STATUSES.REPEALED;
  if (
    (kinds.has(LEGAL_EFFECT_KINDS.AMENDS) ||
      kinds.has(LEGAL_EFFECT_KINDS.REPLACES)) &&
    affected.some(
      ({ claim }) =>
        !claim.sourceNodeIds.some((id) => supportingNodeIds.includes(id)),
    )
  )
    return LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN;
  return node.legalEffectStatus;
}
