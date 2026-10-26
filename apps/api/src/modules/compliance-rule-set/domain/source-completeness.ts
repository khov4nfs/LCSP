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
const has = (values: readonly string[], value: string) =>
  values.includes(value);
const norm = new Set<string>([C.DUTY, C.PROHIBITION, C.PERMISSION]);
export const operativeClaim = (c: LegalSemanticClaim | undefined) =>
  !!c &&
  c.state === S.RELEVANT &&
  c.semanticAuthority === AUTH.LEGAL_NORMATIVE &&
  norm.has(c.claimType);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sorted = <T>(rows: T[], key: (r: T) => string) =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b)));

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

export function semanticFreezeFailures(
  graph: LegalSemanticGraph,
  source: LegalDocumentGraph,
): ComplianceRuleSetValidationFailure[] {
  const failures: ComplianceRuleSetValidationFailure[] = [];
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
