import { createHash } from "node:crypto";
import {
  LEGAL_SEMANTIC_AUTHORITIES as AUTH,
  LEGAL_ASSESSABILITIES as ASSESS,
  SEMANTIC_AUDIT,
  SEMANTIC_AUDIT_VERDICTS as V,
  SEMANTIC_RELATION_CONTRACTS,
  SEMANTIC_INTEGRITY_GAP_CODES as G,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_CLAIM_ACCOUNTING_ROLES as ROLE,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  LEGAL_SEMANTIC_RELATION_KINDS as R,
  LEGAL_CLAIM_STATES as S,
  LEGAL_SEMANTIC_GRAPH_VERSION,
  type LegalSemanticGraph,
  type LegalSemanticClaim,
  type SemanticAuditReceipt,
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

/** Bounded explicit neighborhood; this function projects identities and never interprets law. */
export function semanticAuditInput(
  source: LegalDocumentGraph,
  graph: LegalSemanticGraph,
  nodeId: string,
  revision: number,
) {
  const nodes = new Map(source.nodes.map((n) => [n.nodeId, n]));
  const unit = nodes.get(nodeId);
  if (!unit) throw new Error("Unknown semantic review unit");
  const ids = new Set(
    graph.sourceAccounting.find((r) => r.sourceNodeId === nodeId)?.claimIds ??
      graph.claims
        .filter((c) => c.sourceNodeIds.includes(nodeId))
        .map((c) => c.claimId),
  );
  const claims = sorted(
    graph.claims.filter((c) => ids.has(c.claimId)),
    (c) => c.claimId,
  );
  const relations = sorted(
    graph.relations.filter(
      (r) => ids.has(r.fromClaimId) || ids.has(r.toClaimId),
    ),
    (r) => r.relationId,
  );
  const endpointIds = new Set(
    relations.flatMap((r) => [r.fromClaimId, r.toClaimId]),
  );
  const selected = new Set([
    nodeId,
    ...graph.claims
      .filter((c) => ids.has(c.claimId) || endpointIds.has(c.claimId))
      .flatMap((c) => c.sourceNodeIds),
  ]);
  const within = (id: string, root: string) =>
    id === root ||
    !!(
      nodes.get(id) &&
      nodes.get(root) &&
      nodes
        .get(id)!
        .structuralPath.startsWith(nodes.get(root)!.structuralPath + "/")
    );
  const references = sorted(
    source.references
      .filter((r) => [...selected].some((root) => within(r.fromNodeId, root)))
      .map((r) => ({
        referenceId: r.referenceId,
        fromNodeId: r.fromNodeId,
        toNodeId: r.toNodeId,
        text: r.text,
        charStart: r.charStart,
        charEnd: r.charEnd,
        resolutionState: r.resolutionState,
        candidateNodeIds: r.candidateNodeIds,
      })),
    (r) => r.referenceId,
  );
  for (const ref of references)
    if (ref.toNodeId)
      for (const n of source.nodes)
        if (within(n.nodeId, ref.toNodeId)) selected.add(n.nodeId);
  const contextClaims = sorted(
    graph.claims.filter(
      (c) =>
        !ids.has(c.claimId) &&
        (endpointIds.has(c.claimId) ||
          c.sourceNodeIds.some((id) => selected.has(id))),
    ),
    (c) => c.claimId,
  );
  for (const claim of contextClaims)
    for (const id of claim.sourceNodeIds) selected.add(id);
  for (const id of [...selected]) {
    let parent = nodes.get(id)?.parentNodeId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      selected.add(parent);
      parent = nodes.get(parent)?.parentNodeId;
    }
  }
  const sources = sorted(
    source.nodes
      .filter((n) => selected.has(n.nodeId))
      .map((n) => ({
        nodeId: n.nodeId,
        parentNodeId: n.parentNodeId,
        structuralPath: n.structuralPath,
        nodeType: n.nodeType,
        content: n.content,
        legalEffectStatus: n.legalEffectStatus,
        completenessTarget: n.nodeId === nodeId,
      })),
    (n) => n.nodeId,
  );
  const supportedPassages = claims.map((c) => ({
    claimId: c.claimId,
    passages: (c.sourceSupport ?? []).map((s) => ({
      ...s,
      text: nodes.get(s.nodeId)!.content.slice(s.startOffset, s.endOffset),
    })),
  }));
  const input = {
    schemaRevision: SEMANTIC_AUDIT.schemaRevision,
    sourceRevision: source.materializationId,
    inventoryRevision: revision,
    sourceNodeId: nodeId,
    sources,
    claims,
    supportedPassages,
    contextClaims,
    relations,
    references,
  };
  if (JSON.stringify(input).length > SEMANTIC_AUDIT.maxContextCharacters)
    throw new Error(
      "Semantic audit neighborhood exceeds bounded context; split the review material before auditing",
    );
  return input;
}
export function semanticAuditIdentity(
  input: ReturnType<typeof semanticAuditInput>,
) {
  const unit = input.sources.find((n) => n.nodeId === input.sourceNodeId)!;
  return {
    assertionFingerprint: inventoryHash({
      claims: input.claims,
      relations: input.relations,
    }),
    sourceSupportFingerprint: inventoryHash({
      unit: { nodeId: unit.nodeId, contentSha256: sha(unit.content) },
      supports: input.claims.map((c) => ({
        claimId: c.claimId,
        sourceSupport: c.sourceSupport ?? [],
      })),
    }),
    contextFingerprint: inventoryHash({
      sources: input.sources.map(({ content, ...n }) => ({
        ...n,
        contentSha256: sha(content),
      })),
      contextClaims: input.contextClaims,
      references: input.references,
    }),
  };
}
export function semanticCompletenessInput(
  input: ReturnType<typeof semanticAuditInput>,
) {
  return {
    schemaRevision: input.schemaRevision,
    sourceNodeId: input.sourceNodeId,
    source: input.sources.find((n) => n.completenessTarget)!,
    claims: input.claims,
    relations: input.relations,
    contextClaims: input.contextClaims.map((c) => ({
      claimId: c.claimId,
      statement: c.statement,
      operative: c.operative,
      semanticAuthority: c.semanticAuthority ?? null,
    })),
  };
}
export function semanticRelationBatches(
  input: ReturnType<typeof semanticAuditInput>,
) {
  const groups = new Map<string, typeof input.relations>();
  for (const relation of input.relations)
    groups.set(relation.fromClaimId, [
      ...(groups.get(relation.fromClaimId) ?? []),
      relation,
    ]);
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, rows]) => {
      const batches: (typeof rows)[] = [];
      for (let i = 0; i < rows.length; i += SEMANTIC_AUDIT.relationBatchSize)
        batches.push(rows.slice(i, i + SEMANTIC_AUDIT.relationBatchSize));
      return batches;
    });
}
export function semanticRelationInput(
  input: ReturnType<typeof semanticAuditInput>,
  relations: ReturnType<typeof semanticAuditInput>["relations"],
) {
  const sources = new Map(input.sources.map((n) => [n.nodeId, n]));
  const claims = new Map(
    [...input.claims, ...input.contextClaims].map((c) => [c.claimId, c]),
  );
  const describe = (id: string) => {
    const c = claims.get(id)!;
    return {
      claimId: c.claimId,
      claimType: c.claimType,
      statement: c.statement,
      operative: c.operative,
      semanticAuthority: c.semanticAuthority ?? null,
      semanticFrame: c.semanticFrame ?? null,
      assessability: c.assessability ?? null,
      sourceSupport: c.sourceSupport ?? null,
      exactSourceSupport: (c.sourceSupport ?? []).map((s) => ({
        structuralPath: sources.get(s.nodeId)!.structuralPath,
        text: sources.get(s.nodeId)!.content.slice(s.startOffset, s.endOffset),
      })),
    };
  };
  const roots = new Set(
    relations
      .flatMap((r) => [r.fromClaimId, r.toClaimId])
      .flatMap((id) => claims.get(id)!.sourceNodeIds),
  );
  const within = (id: string, root: string) =>
    id === root ||
    !!(
      sources.get(id) &&
      sources.get(root) &&
      sources
        .get(id)!
        .structuralPath.startsWith(sources.get(root)!.structuralPath + "/")
    );
  const references = input.references.filter((r) =>
    [...roots].some((root) => within(r.fromNodeId, root)),
  );
  const selected = new Set(roots);
  for (const ref of references)
    if (ref.toNodeId && sources.has(ref.toNodeId))
      for (const id of sources.keys())
        if (within(id, ref.toNodeId)) selected.add(id);
  for (const id of [...selected]) {
    let parent = sources.get(id)!.parentNodeId;
    const seen = new Set<string>();
    while (parent && sources.has(parent) && !seen.has(parent)) {
      selected.add(parent);
      seen.add(parent);
      parent = sources.get(parent)!.parentNodeId;
    }
  }
  return {
    schemaRevision: input.schemaRevision,
    sourceRevision: input.sourceRevision,
    sources: input.sources
      .filter((n) => selected.has(n.nodeId))
      .map(({ completenessTarget: _, ...n }) => n),
    relationEvidence: relations.map((r) => ({
      ...r,
      kindContract:
        SEMANTIC_RELATION_CONTRACTS[
          r.kind as keyof typeof SEMANTIC_RELATION_CONTRACTS
        ] ?? null,
      fromAssertion: describe(r.fromClaimId),
      toAssertion: describe(r.toClaimId),
    })),
    references,
  };
}
export function semanticAuditReceiptFailures(
  input: ReturnType<typeof semanticAuditInput>,
  receipt: SemanticAuditReceipt | undefined,
): string[] {
  if (!receipt) return [G.UNAUDITED];
  const expected = semanticAuditIdentity(input);
  const identity = {
    ...expected,
    sourceNodeId: input.sourceNodeId,
    sourceRevision: input.sourceRevision,
    inventoryRevision: input.inventoryRevision,
    schemaRevision: SEMANTIC_AUDIT.schemaRevision,
    verifierRole: SEMANTIC_AUDIT.role,
  };
  const stale = Object.entries(identity)
    .filter(([k, v]) => receipt[k as keyof typeof identity] !== v)
    .map(([k]) => `${G.STALE_AUDIT}:${k}`);
  if (stale.length) return stale;
  if (
    receipt.verdict === V.SUPPORTED &&
    (!receipt.completenessAudit ||
      receipt.completenessAudit.inputFingerprint !==
        inventoryHash(semanticCompletenessInput(input)) ||
      receipt.completenessAudit.verdict !== V.SUPPORTED ||
      receipt.completenessAudit.gaps.length)
  )
    return [G.COMPLETENESS_AUDIT_REQUIRED];
  const batches = semanticRelationBatches(input);
  if (
    receipt.verdict === V.SUPPORTED &&
    (batches.length !== receipt.relationAudits.length ||
      batches.some((batch, i) => {
        const audit = receipt.relationAudits[i];
        return (
          audit.verdict !== V.SUPPORTED ||
          audit.gaps.length ||
          inventoryHash(audit.relationIds) !==
            inventoryHash(batch.map((r) => r.relationId)) ||
          audit.inputFingerprint !==
            inventoryHash(semanticRelationInput(input, batch))
        );
      }))
  )
    return [G.RELATION_AUDIT_REQUIRED];
  const check = (
    rows: {
      id: string;
      fingerprint: string;
      verdict: string;
      gapCodes: string[];
      checks: Record<string, string>;
    }[],
    values: object[],
    id: string,
  ) =>
    rows.length === values.length &&
    new Set(rows.map((r) => r.id)).size === rows.length &&
    values.every((value) =>
      rows.some(
        (r) =>
          r.id === (value as Record<string, unknown>)[id] &&
          r.fingerprint === inventoryHash(value) &&
          r.verdict === V.SUPPORTED &&
          r.gapCodes.length === 0 &&
          Object.values(r.checks).every((v) => v === V.SUPPORTED),
      ),
    );
  if (
    receipt.verdict !== V.SUPPORTED ||
    receipt.gaps.length ||
    !check(receipt.assertions, input.claims, "claimId") ||
    !check(receipt.relations, input.relations, "relationId")
  )
    return [
      ...new Set([
        receipt.verdict,
        ...receipt.gaps.map((g) => g.code),
        ...receipt.assertions
          .filter((r) => r.verdict !== V.SUPPORTED)
          .map((r) => r.verdict),
        ...receipt.relations
          .filter((r) => r.verdict !== V.SUPPORTED)
          .map((r) => r.verdict),
      ]),
    ];
  return [];
}

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
    return [V.WRONG_SEMANTIC_AUTHORITY];
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
      gaps.push(`${V.WRONG_RELATION}:${r.relationId}`);
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
        if (id !== c.claimId && operativeClaim(claims.get(id)!)) {
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
  return gaps;
}

export function semanticFreezeFailures(
  graph: LegalSemanticGraph,
  source: LegalDocumentGraph,
  revision: number,
): ComplianceRuleSetValidationFailure[] {
  const failures: ComplianceRuleSetValidationFailure[] = [];
  const fail = (
    code: ComplianceRuleSetValidationFailure["code"],
    ref: string,
    detail: string,
  ) => failures.push({ code, ref, detail });
  if (graph.contractVersion !== LEGAL_SEMANTIC_GRAPH_VERSION)
    fail(
      F.SEMANTIC_AUDIT_REQUIRED,
      "semanticGraph",
      "New inventories require source-supported, independently audited LEGAL_GRAPH_V3; historical V2 remains read-only",
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
  const receipts = new Map(
    (graph.semanticAudits ?? []).map((r) => [r.sourceNodeId, r]),
  );
  if (
    receipts.size !== (graph.semanticAudits ?? []).length ||
    receipts.size !== graph.sourceAccounting.length
  )
    fail(
      F.SEMANTIC_AUDIT_REQUIRED,
      "semanticAudits",
      "Exactly one current independent receipt is required per completed semantic review unit",
    );
  for (const review of graph.sourceAccounting) {
    try {
      for (const gap of semanticAuditReceiptFailures(
        semanticAuditInput(source, graph, review.sourceNodeId, revision),
        receipts.get(review.sourceNodeId),
      ))
        fail(F.SEMANTIC_AUDIT_REQUIRED, `node:${review.sourceNodeId}`, gap);
    } catch (error) {
      fail(
        F.SEMANTIC_AUDIT_REQUIRED,
        `node:${review.sourceNodeId}`,
        error instanceof Error ? error.message : "Audit context unavailable",
      );
    }
  }
  return failures;
}
