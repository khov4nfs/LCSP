import type { SourceReviewPayload } from "@lcsp/contracts/compliance-rule-set";
import type {
  LegalDocumentGraph,
  LegalDocumentNode,
} from "@lcsp/contracts/legal-source";
import {
  LEGAL_DOCUMENT_NODE_TYPES,
  SOURCE_REVIEW_STATES as S,
} from "@lcsp/contracts/legal-source";
import { LEGAL_STRUCTURE_HEADINGS } from "../../legal-source/domain/document-structure.config.js";
import { inventoryHash } from "./claim-inventory.js";
import { materialReferenceAccounting } from "./semantic-reference-binding.js";

/**
 * Business purpose: Identify source-graph nodes belonging to documents reserved for reference context rather than claim evidence.
 *
 * Business rules:
 * - Only document IDs explicitly marked reference-only exclude their nodes from review-unit ownership.
 * - The graph's node IDs remain unchanged.
 *
 * Execution flow:
 * 1. Build the set of reference-only document IDs.
 * 2. Return node IDs whose document belongs to that set.
 *
 * Failure cases:
 * - A missing optional reference-only list is treated as an empty set.
 *
 * Side effects:
 * - None; returns a new in-memory set.
 */
export function referenceOnlyNodeIds(
  graph: Pick<LegalDocumentGraph, "nodes" | "referenceOnlyDocumentIds">,
) {
  const documents = new Set(graph.referenceOnlyDocumentIds ?? []);
  return new Set(
    graph.nodes.filter((n) => documents.has(n.documentId)).map((n) => n.nodeId),
  );
}

/**
 * Business purpose: Select deterministic source nodes that each require an independent legal-source review.
 *
 * Business rules:
 * - Reference-only nodes and empty nodes are not claim-review units; Article nodes remain units because their headings can identify an addressee.
 * - Recognized single-line structural headings act as ancestor context, while unrecognized leaf/content nodes remain reviewable.
 * - Node traversal and sibling ordering are stable so the frontier can be fingerprinted and resumed.
 *
 * Execution flow:
 * 1. Select eligible nonempty nodes using structural type, heading, leaf, and reference-only rules.
 * 2. Group children by parent and sort siblings by document, ordinal, and structural path.
 * 3. Traverse roots in preorder and collect selected nodes.
 *
 * Failure cases:
 * - Duplicate traversal, cycles, or nodes unreachable from a structural root throw an invalid-hierarchy error.
 *
 * Side effects:
 * - None; derives review units from a pinned graph without editing it.
 */
export function sourceReviewUnits(
  graph: Pick<LegalDocumentGraph, "nodes" | "referenceOnlyDocumentIds">,
): LegalDocumentNode[] {
  const referenceOnly = referenceOnlyNodeIds(graph);
  const parents = new Set(graph.nodes.map((n) => n.parentNodeId));
  const selected = new Set(
    graph.nodes
      .filter((node) => {
        if (referenceOnly.has(node.nodeId)) return false;
        const lines = node.content
          .trim()
          .split(/\r?\n/u)
          .filter((line) => line.trim());
        if (!lines.length) return false;
        if (node.nodeType === LEGAL_DOCUMENT_NODE_TYPES.ARTICLE) return true;
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
  /**
   * Business purpose: Visit one structural node once and add it to the review queue when selected.
   *
   * Business rules:
   * - A node cannot be visited twice; repeated reachability indicates a malformed hierarchy.
   * - Selected parents precede their descendants, preserving deterministic source review order.
   *
   * Execution flow:
   * 1. Mark the node as seen or reject a repeated node.
   * 2. Append it when selected, then recursively visit its sorted children.
   *
   * Failure cases:
   * - Throws when the hierarchy revisits a node through a cycle or duplicate parent path.
   *
   * Side effects:
   * - Updates only the traversal's local seen set and result array.
   */
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
/**
 * Business purpose: Bind a review frontier definition to its exact source materialization and expansion revision.
 *
 * Business rules:
 * - Source revision and frontier revision are part of identity; node input order does not change the fingerprint.
 *
 * Execution flow:
 * 1. Sort the supplied review unit IDs.
 * 2. Hash them with the source and frontier revisions.
 *
 * Failure cases:
 * - Canonicalization or hashing errors propagate without substituting another revision.
 *
 * Side effects:
 * - None; computes an in-memory fingerprint.
 */
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
/**
 * Business purpose: Fingerprint the completed review decisions attached to a specific frontier definition.
 *
 * Business rules:
 * - Review state, disposition, reason, claims, and completion fingerprint contribute to the result.
 * - Items and claim IDs are sorted so database iteration order cannot change the reviewed snapshot identity.
 *
 * Execution flow:
 * 1. Project each review row onto the decision fields that define completion.
 * 2. Sort rows and claim IDs by stable identifiers.
 * 3. Hash the projection together with the frontier definition fingerprint.
 *
 * Failure cases:
 * - Invalid row data or canonical hashing errors propagate.
 *
 * Side effects:
 * - None; computes a completion fingerprint without changing review records.
 */
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

/**
 * Business purpose: Assign a structural reference to an eligible review unit when one exists, preserving a null owner otherwise.
 *
 * Business rules:
 * - References originating in reference-only documents or containers without eligible descendant units have a null review owner.
 * - A review unit owns its own references; otherwise ownership passes to the first eligible descendant in structural order.
 *
 * Execution flow:
 * 1. Build unit, reference-only, node, and ordered-child indexes.
 * 2. Resolve each reference's origin through the local owner traversal.
 * 3. Return the reference-ID to owner-node mapping.
 *
 * Failure cases:
 * - A structural ownership cycle throws rather than assigning duplicate or unstable work.
 *
 * Side effects:
 * - None; derives reference ownership from the graph.
 */
export function reviewReferenceOwners(graph: LegalDocumentGraph) {
  const units = new Set(sourceReviewUnits(graph).map((n) => n.nodeId));
  const referenceOnly = referenceOnlyNodeIds(graph);
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
  /**
   * Business purpose: Find the first eligible review unit that owns a structural node's outgoing references.
   *
   * Business rules:
   * - Reference-only nodes have no owner, and a node already selected as a review unit owns itself.
   * - Container nodes delegate ownership to the first ordered descendant review unit.
   * - Cached results are reused; recursion cannot loop through a cycle.
   *
   * Execution flow:
   * 1. Return null for reference-only nodes or the cached result when present.
   * 2. Reject a node already on the recursion stack.
   * 3. Return the node itself when it is a unit, otherwise resolve its children in order and cache the result.
   *
   * Failure cases:
   * - Throws on a document hierarchy cycle; a container without an eligible descendant resolves to null.
   *
   * Side effects:
   * - Mutates only the local ownership cache and recursion guard.
   */
  const owner = (id: string): string | null => {
    if (referenceOnly.has(id)) return null;
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
/**
 * Business purpose: Update the frontier's aggregate review-state digest when one unit changes.
 *
 * Business rules:
 * - The accumulator is a fixed-width 256-bit hexadecimal value and combines individual fingerprints by XOR.
 *
 * Execution flow:
 * 1. Parse both fingerprints as hexadecimal integers.
 * 2. XOR them and left-pad the result to 64 hexadecimal characters.
 *
 * Failure cases:
 * - Invalid hexadecimal inputs fail during integer parsing rather than producing a fabricated digest.
 *
 * Side effects:
 * - None; computes a new accumulator value.
 */
export const xorReviewHash = (a: string, b: string) =>
  (BigInt("0x" + a) ^ BigInt("0x" + b)).toString(16).padStart(64, "0");
/**
 * Business purpose: Bind one frontier row's review decision and semantic payload to the aggregate state fingerprint.
 *
 * Business rules:
 * - Unit identity, workflow state, disposition, reason presence, claim IDs, blocked references, and payload contribute to the fingerprint.
 * - Claim IDs and blocked reference IDs are sorted; only whether optional reasons exist is included for claim/reference reason fields.
 *
 * Execution flow:
 * 1. Use the supplied payload or the canonical empty review payload.
 * 2. Normalize claim and reference reason fields to presence markers and sort set-like identifiers.
 * 3. Hash the resulting review-state projection.
 *
 * Failure cases:
 * - Invalid payload shapes or canonical hashing errors propagate to the caller.
 *
 * Side effects:
 * - None; computes an in-memory fingerprint.
 */
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

/**
 * Business purpose: Canonicalize an Agent review payload before persistence, replay comparison, or dependency validation.
 *
 * Business rules:
 * - Claim source anchors, claims, relations, reference accounting, relation IDs, and invalidated IDs use stable ordering.
 * - Existing invalidated relations remain represented, while invalidated IDs are excluded when deriving material reference accounting.
 * - Missing dependency fingerprint maps default to empty maps; material accounting is derived from non-invalidated relations.
 *
 * Execution flow:
 * 1. Collect invalidated relation IDs and derive the non-invalidated relation view.
 * 2. Sort claims, relations, anchors, and accounting rows into canonical order.
 * 3. Preserve explicit non-material accounting and derive material reference rows where applicable.
 *
 * Failure cases:
 * - Malformed payload values propagate through property access or hashing helpers; this function does not repair semantic bindings.
 *
 * Side effects:
 * - None; returns a normalized payload copy without mutating the supplied review.
 */
export function normalizeReviewPayload(
  payload: SourceReviewPayload,
): SourceReviewPayload {
  const invalid = new Set(payload.invalidatedRelationIds ?? []);
  const relations = payload.relations.filter((r) => !invalid.has(r.relationId));
  return {
    ...payload,
    dependencyFingerprints: payload.dependencyFingerprints ?? {},
    blockedEndpointFingerprints: payload.blockedEndpointFingerprints ?? {},
    invalidatedRelationIds: [...invalid].sort(),
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
          relations.flatMap((r) => (r.referenceId ? [r.referenceId] : [])),
        ),
      ]
        .filter(
          (id) =>
            !payload.referenceAccounting.some(
              (r) => r.referenceId === id && !r.material,
            ),
        )
        .map((id) => materialReferenceAccounting(id, relations)!),
    ]
      .map((r) => ({ ...r, relationIds: [...r.relationIds].sort() }))
      .sort((a, b) => a.referenceId.localeCompare(b.referenceId)),
  };
}

/**
 * Business purpose: Identify the substantive completion request for one source review unit and support idempotent replay.
 *
 * Business rules:
 * - Disposition, reason, claim IDs, normalized payload, and explicit reference IDs define completion intent.
 * - Dynamic blocked-endpoint snapshots and the invalidated-ID bookkeeping field do not change the request's completion identity.
 *
 * Execution flow:
 * 1. Copy the payload and remove runtime-dependent endpoint snapshots and invalidated-ID bookkeeping.
 * 2. Sort claim IDs and hash the remaining intent with its disposition and reference IDs.
 *
 * Failure cases:
 * - Invalid payload values or canonical hashing errors propagate.
 *
 * Side effects:
 * - None; computes an idempotency fingerprint.
 */
export function reviewCompletionFingerprint(input: {
  disposition?: string;
  reason?: string;
  claimIds?: string[];
  payload: SourceReviewPayload;
  referenceIds?: string[];
}) {
  const intent = { ...input.payload };
  delete intent.blockedEndpointFingerprints;
  delete intent.invalidatedRelationIds;
  return inventoryHash({
    disposition: input.disposition,
    reason: input.reason ?? null,
    claimIds: [...(input.claimIds ?? [])].sort(),
    payload: intent,
    referenceIds: input.referenceIds ?? [],
  });
}
