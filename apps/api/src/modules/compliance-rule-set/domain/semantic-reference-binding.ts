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

/** One structural rule for COMPLETE and final integrity; never interprets legal materiality. */
export function semanticReferenceBindings(
  graph: LegalDocumentGraph,
  legalSourceVersionId = graph.legalSourceVersionId,
  materializationId = graph.materializationId,
) {
  const nodes = new Map(graph.nodes.map((n) => [n.nodeId, n]));
  const references = new Map(graph.references.map((r) => [r.referenceId, r]));
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
  const side = (claims: Map<string, LegalSemanticClaim>, nodeId: string) =>
    [...claims.values()]
      .filter(
        (c) =>
          c.legalSourceVersionId === legalSourceVersionId &&
          c.sourceNodeIds.some((id) => within(id, nodeId)),
      )
      .map((c) => c.claimId)
      .sort();
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
