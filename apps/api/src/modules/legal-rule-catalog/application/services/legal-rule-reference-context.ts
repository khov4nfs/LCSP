import {
  LEGAL_RULE_REFERENCE_PREVIEW_LIMITS as LIMITS,
  type LegalRuleSourceProvision,
  type LegalRuleSourceReferenceContext,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  LEGAL_DOCUMENT_NODE_TYPES as N,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  type LegalDocumentGraph,
  type LegalDocumentNode,
  type LegalDocumentReference,
} from "@lcsp/contracts/legal-source";

// A preview needs structural text and identity from the pinned graph, without retrieval windows.
type ReferenceNode = Pick<
  LegalDocumentNode,
  | "nodeId"
  | "documentId"
  | "nodeType"
  | "parentNodeId"
  | "ordinal"
  | "structuralPath"
  | "title"
  | "content"
>;
type ReferenceEdge = Pick<
  LegalDocumentReference,
  | "referenceId"
  | "text"
  | "charStart"
  | "fromNodeId"
  | "toNodeId"
  | "resolutionState"
>;

/**
 * Business purpose: Preview the source text of a uniquely resolved provision cited in the catalog picker.
 * Business rules:
 * - A reference retains its original resolution state and wording. Only a resolved target contributes text.
 * - An Article or Clause includes its own text and descendant text in source order. References inside that target are not followed.
 * Execution flow:
 * 1. Find the resolved target and its document title in the pinned graph.
 * 2. Walk its subtree and collect source text up to the preview character limit.
 * 3. Return the structural locator and excerpt, marking any omitted text.
 * Failure cases:
 * - Missing, ambiguous or unresolved targets carry no excerpt.
 * Side effects:
 * - Pure projection. The source graph and evidence text are left intact.
 */
function preview(
  ref: ReferenceEdge,
  nodes: Map<string, ReferenceNode>,
  children: Map<string, ReferenceNode[]>,
  titles: Map<string, string>,
): LegalRuleSourceReferenceContext {
  const base = {
    referenceId: ref.referenceId,
    text: ref.text,
    resolutionState: ref.resolutionState,
  };
  const target =
    ref.resolutionState === R.RESOLVED && ref.toNodeId
      ? nodes.get(ref.toNodeId)
      : undefined;
  if (!target) return { ...base, target: null };

  // Use only enough source text to detect truncation, including when the target has descendants.
  const stack = [target];
  let body = "";
  while (stack.length && body.length <= LIMITS.excerptCharacters) {
    const node = stack.pop()!;
    const content = node.content.trim();
    if (content)
      body +=
        (body ? "\n" : "") + content.slice(0, LIMITS.excerptCharacters + 1);
    const descendants = children.get(node.nodeId) ?? [];
    for (let index = descendants.length - 1; index >= 0; index--)
      stack.push(descendants[index]);
  }
  const excerpt = body
    .slice(0, LIMITS.excerptCharacters)
    .replace(/[\uD800-\uDBFF]$/u, "");
  return {
    ...base,
    target: {
      documentId: target.documentId,
      documentTitle: titles.get(target.documentId) ?? target.documentId,
      locator: target.structuralPath,
      excerpt,
      truncated: excerpt.length < body.length,
    },
  };
}

/**
 * Business purpose: Attach direct legal-reference context to the catalog provisions on the current page.
 * Business rules:
 * - Start at the exact selected chunk nodes. A structural ancestor contributes only wording present in the composed preview.
 * - The pinned source graph owns target resolution. Display context never becomes an import citation.
 * Execution flow:
 * 1. Index chunk mappings, outgoing references and document structure from the pinned graph.
 * 2. Collect direct references for the page's selected provision parts and applicable ancestors.
 * 3. Deduplicate and return bounded previews, prioritizing the selected provision over its ancestors.
 * Failure cases:
 * - A chunk without a graph mapping has no preview. Unresolved and ambiguous references remain visible.
 * Side effects:
 * - None. Returns new provision views without changing source chunks or rules.
 */
export function attachLegalRuleReferenceContext(
  items: LegalRuleSourceProvision[],
  chunkIdsByLocator: Map<string, string>,
  graph: {
    nodes: ReferenceNode[];
    references: ReferenceEdge[];
    chunkMappings: LegalDocumentGraph["chunkMappings"];
  },
): LegalRuleSourceProvision[] {
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const titles = new Map<string, string>();
  const children = new Map<string, ReferenceNode[]>();
  const mappedNodes = new Map(
    graph.chunkMappings.map(({ chunkId, legalDocumentNodeId }) => [
      chunkId,
      legalDocumentNodeId,
    ]),
  );
  const outgoing = new Map<string, ReferenceEdge[]>();

  // Index once per page so repeated ancestor and target lookups share the same source snapshot.
  for (const node of graph.nodes) {
    if (node.nodeType === N.DOCUMENT) titles.set(node.documentId, node.title);
    if (node.parentNodeId) {
      const siblings = children.get(node.parentNodeId) ?? [];
      siblings.push(node);
      children.set(node.parentNodeId, siblings);
    }
  }
  for (const siblings of children.values())
    siblings.sort((left, right) => left.ordinal - right.ordinal);
  for (const ref of graph.references) {
    const refs = outgoing.get(ref.fromNodeId) ?? [];
    refs.push(ref);
    outgoing.set(ref.fromNodeId, refs);
  }
  for (const refs of outgoing.values())
    refs.sort(
      (left, right) =>
        left.charStart - right.charStart ||
        left.referenceId.localeCompare(right.referenceId),
    );

  return items.map((item) => {
    const selectedNodes = new Set<string>();
    for (const { locator } of item.citationLocatorRefs) {
      // Exact part locators identify the chosen provision independently of its ancestor citations.
      if (locator.replace(/::part-\d+$/u, "") !== item.locator) continue;
      const chunkId = chunkIdsByLocator.get(locator);
      const nodeId = chunkId && mappedNodes.get(chunkId);
      if (nodeId) selectedNodes.add(nodeId);
    }
    const refs = new Map<string, ReferenceEdge>();
    const description = item.description.replace(/\s+/gu, " ");
    for (const id of selectedNodes) {
      let node = nodes.get(id);
      while (
        node &&
        [N.ARTICLE, N.CLAUSE, N.PARAGRAPH, N.POINT].some(
          (kind) => kind === node?.nodeType,
        )
      ) {
        for (const ref of outgoing.get(node.nodeId) ?? []) {
          // Match the whole ancestor source line so an identical locator in the
          // leaf cannot accidentally pull a different reference from its parent.
          const lineStart =
            node.content.lastIndexOf("\n", ref.charStart - 1) + 1;
          const nextBreak = node.content.indexOf(
            "\n",
            ref.charStart + ref.text.length,
          );
          const sourceLine = node.content
            .slice(lineStart, nextBreak < 0 ? undefined : nextBreak)
            .trim()
            .replace(/\s+/gu, " ");
          if (
            selectedNodes.has(node.nodeId) ||
            (sourceLine && description.includes(sourceLine))
          )
            refs.set(ref.referenceId, ref);
        }
        node = node.parentNodeId ? nodes.get(node.parentNodeId) : undefined;
      }
    }
    return {
      ...item,
      referenceContext: [...refs.values()]
        .slice(0, LIMITS.references)
        .map((ref) => preview(ref, nodes, children, titles)),
    };
  });
}
