import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  LEGAL_SEMANTIC_RELATION_KINDS,
  type LegalSemanticClaim,
  type LegalSemanticGraph,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  type LegalDocumentGraph,
} from "@lcsp/contracts/legal-source";

type Relation = LegalSemanticGraph["relations"][number];

/**
 * Business purpose: Provide one pinned structural binding rule for review completion and final Rule Set integrity.
 *
 * Business rules:
 * - Relation claims must belong to the same Legal Source Version and exact graph materialization as the resolved reference.
 * - A relation must point from a claim under the reference origin to a distinct claim under the resolved target.
 * - Structural validity does not determine whether the reference is legally material.
 *
 * Execution flow:
 * 1. Index source nodes and explicit reference edges.
 * 2. Expose same-document containment, claim-side lookup, and relation-binding validation helpers.
 * 3. Return a structured detached-binding failure with candidate source/target claim IDs when validation fails.
 *
 * Failure cases:
 * - Missing, ambiguous, unresolved, cross-source, cross-materialization, same-claim, unknown-kind, or directionally detached relations fail binding.
 *
 * Side effects:
 * - None; constructs read-only helpers over the supplied pinned graph.
 */
export function semanticReferenceBindings(
  graph: LegalDocumentGraph,
  legalSourceVersionId = graph.legalSourceVersionId,
  materializationId = graph.materializationId,
) {
  const nodes = new Map(graph.nodes.map((n) => [n.nodeId, n]));
  const references = new Map(graph.references.map((r) => [r.referenceId, r]));
  /**
   * Business purpose: Determine whether a source node is the referenced node or lies beneath it in the same pinned document.
   *
   * Business rules:
   * - Both nodes must belong to the requested Legal Source Version and the same document.
   * - Descendant checks use structural-path boundaries, not text or matching IDs alone.
   *
   * Execution flow:
   * 1. Resolve the node and ancestor from the pinned node index.
   * 2. Verify source and document identity.
   * 3. Accept exact identity or a path beginning with the ancestor path plus a separator.
   *
   * Failure cases:
   * - Missing nodes, wrong source versions, or another document return false.
   *
   * Side effects:
   * - None; reads the indexed graph.
   */
  const within = (nodeId: string, ancestorId: string) => {
    const node = nodes.get(nodeId),
      ancestor = nodes.get(ancestorId);
    return Boolean(
      node &&
      ancestor &&
      node.legalSourceVersionId === legalSourceVersionId &&
      ancestor.legalSourceVersionId === legalSourceVersionId &&
      node.documentId === ancestor.documentId &&
      (nodeId === ancestorId ||
        node.structuralPath.startsWith(ancestor.structuralPath + "/")),
    );
  };
  /**
   * Business purpose: List canonical claims that are source-anchored within one side of a reference edge.
   *
   * Business rules:
   * - A candidate claim must belong to this Legal Source Version and cite a node within the requested structural side.
   * - Results are sorted by claim ID for stable diagnostic feedback.
   *
   * Execution flow:
   * 1. Filter claim records by source version and structural containment of any source anchor.
   * 2. Project claim IDs and sort them.
   *
   * Failure cases:
   * - A missing/invalid node context yields an empty list.
   *
   * Side effects:
   * - None; computes candidate IDs for validation feedback.
   */
  const side = (claims: Map<string, LegalSemanticClaim>, nodeId: string) =>
    [...claims.values()]
      .filter(
        (c) =>
          c.legalSourceVersionId === legalSourceVersionId &&
          c.sourceNodeIds.some((id) => within(id, nodeId)),
      )
      .map((c) => c.claimId)
      .sort();
  /**
   * Business purpose: Reject a semantic relation that is not grounded in its explicit resolved legal reference.
   *
   * Business rules:
   * - The reference and graph pins must match, the edge must resolve, and relation endpoints must be distinct claims from the pinned source.
   * - The from-claim must be structurally under the edge origin and the to-claim under its resolved target.
   * - A structurally valid binding returns null; this helper never assigns legal materiality.
   *
   * Execution flow:
   * 1. Resolve reference and claims by the supplied IDs.
   * 2. Verify pin identity, resolution, relation kind, distinct endpoints, and structural direction.
   * 3. Otherwise return the detached-binding failure with node and candidate-claim details.
   *
   * Failure cases:
   * - Any missing, stale, unresolved, invalid-kind, same-claim, or detached endpoint returns SEMANTIC_DEPENDENCY_DETACHED.
   *
   * Side effects:
   * - None; returns validation data without modifying claims or references.
   */
  const failure = (
    relation: Relation,
    claims: Map<string, LegalSemanticClaim>,
  ) => {
    const reference = references.get(relation.referenceId ?? "");
    const from = claims.get(relation.fromClaimId),
      to = claims.get(relation.toClaimId);
    if (
      graph.legalSourceVersionId === legalSourceVersionId &&
      graph.materializationId === materializationId &&
      reference?.resolutionState === R.RESOLVED &&
      reference.toNodeId &&
      from &&
      to &&
      from.claimId !== to.claimId &&
      from.legalSourceVersionId === legalSourceVersionId &&
      to.legalSourceVersionId === legalSourceVersionId &&
      (Object.values(LEGAL_SEMANTIC_RELATION_KINDS) as string[]).includes(
        relation.kind,
      ) &&
      from.sourceNodeIds.some((id) => within(id, reference.fromNodeId)) &&
      to.sourceNodeIds.some((id) => within(id, reference.toNodeId!))
    )
      return null;
    return {
      code: F.SEMANTIC_DEPENDENCY_DETACHED,
      ref: `claimRelation:${relation.relationId}`,
      detail:
        "Bind distinct claims under the pinned structural reference source and resolved target, in that direction",
      referenceId: relation.referenceId,
      fromNodeId: reference?.fromNodeId ?? null,
      sourceNodeId: reference?.fromNodeId ?? null,
      targetNodeId: reference?.toNodeId ?? null,
      suppliedFromClaimId: relation.fromClaimId,
      suppliedToClaimId: relation.toClaimId,
      sourceClaimIds: side(claims, reference?.fromNodeId ?? "").slice(0, 20),
      targetClaimIds: side(claims, reference?.toNodeId ?? "").slice(0, 20),
      requiredAction: "inspect_semantic_reference_binding",
    };
  };
  return { within, failure };
}

/**
 * Business purpose: Derive material accounting for an explicit source reference from its authored semantic relations.
 *
 * Business rules:
 * - A reference is material here only when at least one relation explicitly names it.
 * - Relation IDs are deduplicated and sorted; a reference with no relation returns null for the caller to supply a non-material reason.
 *
 * Execution flow:
 * 1. Select relations naming the reference and collect unique relation IDs.
 * 2. Return a material accounting record when the set is nonempty.
 *
 * Failure cases:
 * - None; an unreferenced relation set returns null rather than inventing a reason.
 *
 * Side effects:
 * - None; returns an in-memory accounting projection.
 */
export function materialReferenceAccounting(
  referenceId: string,
  relations: Relation[],
) {
  const relationIds = [
    ...new Set(
      relations
        .filter((r) => r.referenceId === referenceId)
        .map((r) => r.relationId),
    ),
  ].sort();
  return relationIds.length
    ? { referenceId, material: true, relationIds, nonMaterialReason: null }
    : null;
}
