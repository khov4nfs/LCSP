import type { SourceReviewPayload } from "@lcsp/contracts/compliance-rule-set";
import type {
  LegalDocumentGraph,
  LegalDocumentNode,
} from "@lcsp/contracts/legal-source";
import { SOURCE_REVIEW_STATES as S } from "@lcsp/contracts/legal-source";
import { LEGAL_STRUCTURE_HEADINGS } from "../../legal-source/domain/document-structure.config.js";
import { inventoryHash } from "./claim-inventory.js";
import { materialReferenceAccounting } from "./semantic-reference-binding.js";

/** Structural headings remain ancestor context; no legal meaning is inferred from source words. */
export function sourceReviewUnits(
  graph: Pick<LegalDocumentGraph, "nodes">,
): LegalDocumentNode[] {
  const parents = new Set(graph.nodes.map((n) => n.parentNodeId));
  const selected = new Set(
    graph.nodes
      .filter((node) => {
        const lines = node.content
          .trim()
          .split(/\r?\n/u)
          .filter((line) => line.trim());
        if (!lines.length) return false;
        if (!parents.has(node.nodeId) || lines.length !== 1) return true;
        return !LEGAL_STRUCTURE_HEADINGS.some((spec) => {
          if (spec.type !== node.nodeType) return false;
          const match = spec.pattern.exec(
            lines[0].replace(/^\s*#{1,6}\s+/u, "").trim(),
          );
          return (
            match?.[1] === node.label &&
            (match[2] ?? "").trim() === node.title.trim()
          );
        });
      })
      .map((n) => n.nodeId),
  );
  const children = new Map<string | null, LegalDocumentNode[]>();
  for (const node of graph.nodes) {
    const siblings = children.get(node.parentNodeId) ?? [];
    siblings.push(node);
    children.set(node.parentNodeId, siblings);
  }
  for (const siblings of children.values())
    siblings.sort(
      (a, b) =>
        a.documentId.localeCompare(b.documentId) ||
        a.ordinal - b.ordinal ||
        a.structuralPath.localeCompare(b.structuralPath),
    );
  const result: LegalDocumentNode[] = [];
  const seen = new Set<string>();
  const visit = (node: LegalDocumentNode) => {
    if (seen.has(node.nodeId)) throw new Error("Invalid structural hierarchy");
    seen.add(node.nodeId);
    if (selected.has(node.nodeId)) result.push(node);
    for (const child of children.get(node.nodeId) ?? []) visit(child);
  };
  for (const node of children.get(null) ?? []) visit(node);
  if (seen.size !== graph.nodes.length)
    throw new Error("Invalid structural root or cycle");
  return result;
}

export const completedReviewStates = [
  S.REVIEWED_WITH_CLAIMS,
  S.REVIEWED_NO_CLAIMS,
];
export function frontierDefinitionFingerprint(
  sourceRevision: string,
  revision: number,
  nodeIds: string[],
) {
  return inventoryHash({
    sourceRevision,
    revision,
    nodeIds: [...nodeIds].sort(),
  });
}
export function reviewedFrontierFingerprint(
  definitionFingerprint: string,
  items: {
    sourceNodeId: string;
    state: string;
    claimIds: string[];
    disposition: string | null;
    reason: string | null;
    completionFingerprint: string | null;
  }[],
) {
  return inventoryHash({
    definitionFingerprint,
    items: items
      .map((item) => ({
        sourceNodeId: item.sourceNodeId,
        state: item.state,
        claimIds: [...item.claimIds].sort(),
        disposition: item.disposition,
        reason: item.reason,
        completionFingerprint: item.completionFingerprint,
      }))
      .sort((a, b) => a.sourceNodeId.localeCompare(b.sourceNodeId)),
  });
}

/** Assign container-heading references to one descendant work item without duplicating work. */
export function reviewReferenceOwners(graph: LegalDocumentGraph) {
  const units = new Set(sourceReviewUnits(graph).map((n) => n.nodeId));
  const children = new Map<string, string[]>();
  const byId = new Map(graph.nodes.map((n) => [n.nodeId, n]));
  for (const n of graph.nodes)
    if (n.parentNodeId) {
      const siblings = children.get(n.parentNodeId) ?? [];
      siblings.push(n.nodeId);
      children.set(n.parentNodeId, siblings);
    }
  for (const siblings of children.values())
    siblings.sort(
      (a, b) =>
        byId.get(a)!.ordinal - byId.get(b)!.ordinal || a.localeCompare(b),
    );
  const cache = new Map<string, string | null>();
  const visiting = new Set<string>();
  const owner = (id: string): string | null => {
    if (cache.has(id)) return cache.get(id)!;
    if (visiting.has(id)) throw new Error("Invalid document hierarchy cycle");
    visiting.add(id);
    const value = units.has(id)
      ? id
      : ((children.get(id) ?? []).map(owner).find(Boolean) ?? null);
    visiting.delete(id);
    cache.set(id, value);
    return value;
  };
  return new Map(
    graph.references.map((ref) => [ref.referenceId, owner(ref.fromNodeId)]),
  );
}

export const emptyReviewPayload = {
  claims: [],
  identities: {},
  relations: [],
  referenceAccounting: [],
};
export const zeroReviewAccumulator = "0".repeat(64);
export const xorReviewHash = (a: string, b: string) =>
  (BigInt("0x" + a) ^ BigInt("0x" + b)).toString(16).padStart(64, "0");
export function reviewItemStateFingerprint(item: {
  sourceNodeId: string;
  state: string;
  disposition?: string | null;
  reason?: string | null;
  claimIds?: string[];
  blockedReferenceIds?: string[];
  payload?: unknown;
}) {
  const payload = (item.payload ?? emptyReviewPayload) as SourceReviewPayload;
  return inventoryHash({
    sourceNodeId: item.sourceNodeId,
    state: item.state,
    disposition: item.disposition ?? null,
    reason: !!item.reason,
    claimIds: [...(item.claimIds ?? [])].sort(),
    blockedReferenceIds: [...(item.blockedReferenceIds ?? [])].sort(),
    payload: {
      ...payload,
      claims: payload.claims.map((claim) => ({
        ...claim,
        nonOperativeReason: !!claim.nonOperativeReason,
      })),
      referenceAccounting: payload.referenceAccounting.map((reference) => ({
        ...reference,
        nonMaterialReason: !!reference.nonMaterialReason,
      })),
    },
  });
}

export function normalizeReviewPayload(
  payload: SourceReviewPayload,
): SourceReviewPayload {
  return {
    ...payload,
    claims: payload.claims
      .map((c) => ({ ...c, sourceNodeIds: [...c.sourceNodeIds].sort() }))
      .sort((a, b) => a.claimId.localeCompare(b.claimId)),
    relations: [...payload.relations].sort((a, b) =>
      a.relationId.localeCompare(b.relationId),
    ),
    referenceAccounting: [
      ...payload.referenceAccounting.filter((r) => !r.material),
      ...[
        ...new Set(
          payload.relations.flatMap((r) =>
            r.referenceId ? [r.referenceId] : [],
          ),
        ),
      ]
        .filter(
          (id) =>
            !payload.referenceAccounting.some(
              (r) => r.referenceId === id && !r.material,
            ),
        )
        .map((id) => materialReferenceAccounting(id, payload.relations)!),
    ]
      .map((r) => ({ ...r, relationIds: [...r.relationIds].sort() }))
      .sort((a, b) => a.referenceId.localeCompare(b.referenceId)),
  };
}
