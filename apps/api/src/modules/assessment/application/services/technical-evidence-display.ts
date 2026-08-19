import type { TechnicalEvidenceDisplayDto } from "../contracts/assessment/assessment-detail.contract.js";

const MAX_TECHNICAL_EVIDENCE_DISPLAY_ITEMS = 12;

type JsonRecord = Record<string, unknown>;

export function resolveTechnicalEvidenceDisplays(
  evidencePayload: unknown,
  evidenceRefs: string[],
  projectedEvidence?: unknown,
): TechnicalEvidenceDisplayDto[] {
  // The scanner persists only a compact evidence-graph descriptor; its full graph
  // lives in a worker-local artifact path and is intentionally not readable by the
  // API process. New ClassificationResult rows therefore carry a bounded, source-free
  // location projection produced while the full graph is still in worker memory.
  const projected = projectedDisplays(projectedEvidence);
  if (projected.length > 0) return projected;

  // Compatibility for historical reports that still embedded graph nodes/anchors.
  const payload = asRecord(evidencePayload);
  const graph = asRecord(payload?.evidence_graph ?? payload?.evidenceGraph);
  if (!graph) return [];

  const nodes = asRecords(graph.nodes);
  const edges = asRecords(graph.edges);
  const anchors = asRecords(graph.source_anchors ?? graph.sourceAnchors);
  const nodeById = new Map<string, JsonRecord>();
  const edgeById = new Map<string, JsonRecord>();
  const anchorById = new Map<string, JsonRecord>();
  const nodesByEvidenceRef = new Map<string, JsonRecord[]>();

  for (const node of nodes) {
    const id = text(node.node_id ?? node.nodeId);
    if (id) nodeById.set(id, node);
    for (const ref of strings(node.evidence_refs ?? node.evidenceRefs)) {
      const matches = nodesByEvidenceRef.get(ref) ?? [];
      matches.push(node);
      nodesByEvidenceRef.set(ref, matches);
    }
  }
  for (const edge of edges) {
    const id = text(edge.edge_id ?? edge.edgeId);
    if (id) edgeById.set(id, edge);
  }
  for (const anchor of anchors) {
    const id = text(anchor.anchor_id ?? anchor.anchorId);
    if (id) anchorById.set(id, anchor);
  }

  const displays = new Map<string, TechnicalEvidenceDisplayDto>();
  const add = (item: TechnicalEvidenceDisplayDto | null) => {
    if (!item) return;
    const key = `${item.kind}|${item.label}|${item.file_path ?? ""}|${item.symbol_ref ?? ""}|${item.start_line ?? ""}|${item.end_line ?? ""}`;
    if (!displays.has(key)) displays.set(key, item);
  };

  for (const ref of evidenceRefs) {
    const node = nodeById.get(ref);
    if (node) {
      add(fromNode(node));
      continue;
    }
    const anchor = anchorById.get(ref);
    if (anchor) {
      const linkedNodeId = text(anchor.graph_node_id ?? anchor.graphNodeId);
      add(
        fromAnchor(
          anchor,
          linkedNodeId ? nodeById.get(linkedNodeId) : undefined,
        ),
      );
      continue;
    }
    const edge = edgeById.get(ref);
    if (edge) {
      add(fromEdge(edge, nodeById));
      continue;
    }
    for (const match of nodesByEvidenceRef.get(ref) ?? []) add(fromNode(match));
  }

  return Array.from(displays.values()).slice(
    0,
    MAX_TECHNICAL_EVIDENCE_DISPLAY_ITEMS,
  );
}

function projectedDisplays(value: unknown): TechnicalEvidenceDisplayDto[] {
  const displays = new Map<string, TechnicalEvidenceDisplayDto>();
  for (const row of asRecords(value)) {
    const kind = text(row.kind);
    const label = text(row.label);
    if (!kind || !label) continue;
    const item: TechnicalEvidenceDisplayDto = {
      kind,
      label,
      file_path: sourcePath(text(row.file_path ?? row.filePath)),
      symbol_ref: text(row.symbol_ref ?? row.symbolRef),
      start_line: integer(row.start_line ?? row.startLine),
      end_line: integer(row.end_line ?? row.endLine),
    };
    const key = `${item.kind}|${item.label}|${item.file_path ?? ""}|${item.symbol_ref ?? ""}|${item.start_line ?? ""}|${item.end_line ?? ""}`;
    if (!displays.has(key)) displays.set(key, item);
  }
  return Array.from(displays.values()).slice(
    0,
    MAX_TECHNICAL_EVIDENCE_DISPLAY_ITEMS,
  );
}

function fromNode(node: JsonRecord): TechnicalEvidenceDisplayDto {
  const source = asRecord(node.source) ?? {};
  return {
    kind: text(node.node_type ?? node.nodeType) ?? "TECHNICAL_EVIDENCE",
    label:
      text(node.label) ??
      text(source.symbol_ref ?? source.symbolRef) ??
      "Repository evidence",
    file_path: sourcePath(text(source.file_path ?? source.filePath)),
    symbol_ref: text(source.symbol_ref ?? source.symbolRef),
    start_line: integer(source.start_line ?? source.startLine),
    end_line: integer(source.end_line ?? source.endLine),
  };
}

function fromAnchor(
  anchor: JsonRecord,
  node?: JsonRecord,
): TechnicalEvidenceDisplayDto {
  const base = node ? fromNode(node) : null;
  return {
    kind: base?.kind ?? "SOURCE_LOCATION",
    label:
      base?.label ??
      text(anchor.symbol_ref ?? anchor.symbolRef) ??
      fileName(text(anchor.file_path ?? anchor.filePath)) ??
      "Repository source location",
    file_path: sourcePath(
      text(anchor.file_path ?? anchor.filePath) ?? base?.file_path ?? null,
    ),
    symbol_ref:
      text(anchor.symbol_ref ?? anchor.symbolRef) ?? base?.symbol_ref ?? null,
    start_line:
      integer(anchor.start_line ?? anchor.startLine) ??
      base?.start_line ??
      null,
    end_line:
      integer(anchor.end_line ?? anchor.endLine) ?? base?.end_line ?? null,
  };
}

function fromEdge(
  edge: JsonRecord,
  nodeById: Map<string, JsonRecord>,
): TechnicalEvidenceDisplayDto | null {
  const sourceId = text(edge.source_node_id ?? edge.sourceNodeId);
  const targetId = text(edge.target_node_id ?? edge.targetNodeId);
  const source = sourceId ? nodeById.get(sourceId) : undefined;
  const target = targetId ? nodeById.get(targetId) : undefined;
  if (!source && !target) return null;
  const sourceDisplay = source ? fromNode(source) : null;
  const targetDisplay = target ? fromNode(target) : null;
  const labels = [sourceDisplay?.label, targetDisplay?.label].filter(
    (value): value is string => Boolean(value),
  );
  const location = sourceDisplay?.file_path ? sourceDisplay : targetDisplay;
  return {
    kind: text(edge.edge_type ?? edge.edgeType) ?? "STATIC_FLOW",
    label:
      labels.length > 1 ? labels.join(" → ") : (labels[0] ?? "Repository flow"),
    file_path: location?.file_path ?? null,
    symbol_ref: location?.symbol_ref ?? null,
    start_line: location?.start_line ?? null,
    end_line: location?.end_line ?? null,
  };
}

function sourcePath(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length > 1 && /-[0-9a-f]{7,40}$/i.test(parts[0] ?? ""))
    return parts.slice(1).join("/");
  return normalized;
}

function fileName(value: string | null): string | null {
  if (!value) return null;
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
