import type { ProgramEvidenceGraphDetail } from "@/lib/api/evidence-graph-detail-client";

type Node = ProgramEvidenceGraphDetail["paths"]["nodes"][number];
type Edge = ProgramEvidenceGraphDetail["paths"]["edges"][number];
export type EvidenceTopology = {
  nodes: Node[];
  edges: Edge[];
  positions: Map<string, { x: number; y: number }>;
  /** Presentation-only ordered path membership for lane placement. */
  paths: Array<{ nodeIds: string[]; edgeIds: string[] }>;
};

export type ViewportState = { zoom: number; pan: { x: number; y: number } };
export const GRAPH_NODE_WIDTH = 150;
export const GRAPH_NODE_HEIGHT = 44;
export const EDGE_NODE_CLEARANCE = 8;
export const LABEL_NODE_CLEARANCE = 4;
export const LABEL_TO_LABEL_CLEARANCE = 8;

export type GraphPoint = { x: number; y: number };

export type GraphRect = { x: number; y: number; width: number; height: number };

export function expandedNodeBounds(rect: GraphRect, clearance = EDGE_NODE_CLEARANCE): GraphRect {
  return { x: rect.x - clearance, y: rect.y - clearance, width: rect.width + clearance * 2, height: rect.height + clearance * 2 };
}

function segmentIntersectsRect(a: GraphPoint, b: GraphPoint, rect: GraphRect) {
  const bounds = expandedNodeBounds(rect);
  if (Math.abs(a.y - b.y) < 1) {
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    return right > bounds.x && left < bounds.x + bounds.width && a.y > bounds.y && a.y < bounds.y + bounds.height;
  }
  if (Math.abs(a.x - b.x) < 1) {
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    return bottom > bounds.y && top < bounds.y + bounds.height && a.x > bounds.x && a.x < bounds.x + bounds.width;
  }
  return false;
}

export function polylineIntersectsObstacles(points: GraphPoint[], obstacles: GraphRect[]) {
  return points.slice(0, -1).some((point, index) => obstacles.some((rect) => segmentIntersectsRect(point, points[index + 1], rect)));
}

export function fitGraphToViewport(
  positions: Map<string, GraphPoint>,
  viewport: { width: number; height: number },
  insets = { top: 24, right: 36, bottom: 96, left: 36 },
) {
  const points = [...positions.values()];
  if (!points.length) return { zoom: 1, pan: { x: 0, y: 0 } };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x + GRAPH_NODE_WIDTH));
  const minY = Math.min(...points.map((point) => point.y - GRAPH_NODE_HEIGHT / 2));
  const maxY = Math.max(...points.map((point) => point.y + GRAPH_NODE_HEIGHT / 2));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const zoom = Math.min(3.5, Math.max(0.45, Math.min(
    (viewport.width - insets.left - insets.right) / contentWidth,
    (viewport.height - insets.top - insets.bottom) / contentHeight,
  )));
  const center = {
    x: insets.left + (viewport.width - insets.left - insets.right) / 2,
    y: insets.top + (viewport.height - insets.top - insets.bottom) / 2,
  };
  return {
    zoom,
    pan: {
      x: center.x - (minX + contentWidth / 2) * zoom,
      y: center.y - (minY + contentHeight / 2) * zoom,
    },
  };
}

export function longestHorizontalSegment(points: GraphPoint[], minimumLength: number) {
  return points
    .slice(0, -1)
    .map((start, index) => ({ start, end: points[index + 1] }))
    .filter(({ start, end }) => Math.abs(start.y - end.y) < 1)
    .map(({ start, end }) => {
      const left = Math.min(start.x, end.x);
      const right = Math.max(start.x, end.x);
      return { x: (left + right) / 2, y: start.y, length: right - left };
    })
    .filter((segment) => segment.length >= minimumLength)
    .sort((a, b) => b.length - a.length || a.x - b.x)[0] ?? null;
}

export function bestSafeLabelSegment(
  points: GraphPoint[],
  labelWidth: number,
  endpointClearance = 14,
  labelPadding = 6,
) {
  const horizontal = points
    .slice(0, -1)
    .map((start, index) => ({ start, end: points[index + 1] }))
    .filter(({ start, end }) => Math.abs(start.y - end.y) < 1)
    .map(({ start, end }) => {
      // Reserve half the plate width at each endpoint; otherwise a centered
      // label can still overlap a node even when the center is clear.
      const halfLabel = labelWidth / 2;
      const left = Math.min(start.x, end.x) + endpointClearance + halfLabel;
      const right = Math.max(start.x, end.x) - endpointClearance - halfLabel;
      return { x: (left + right) / 2, y: start.y, length: right - left };
    })
    .filter((segment) => segment.length >= labelWidth + labelPadding * 2)
    .sort((a, b) => b.length - a.length || a.x - b.x)[0];
  if (horizontal) return horizontal;
  const fallback = points
    .slice(0, -1)
    .map((start, index) => ({ start, end: points[index + 1] }))
    .map(({ start, end }) => {
      const length = Math.hypot(end.x - start.x, end.y - start.y) - endpointClearance * 2;
      return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, length };
    })
    .filter((segment) => segment.length >= labelWidth + labelPadding * 2)
    .sort((a, b) => b.length - a.length || a.x - b.x)[0];
  return fallback ?? null;
}

export function findLabelPlacement(
  points: GraphPoint[],
  labelWidth: number,
  obstacles: GraphRect[],
  labelHeight = 16,
  labelObstacles: GraphRect[] = [],
) {
  const candidates: GraphPoint[] = [];
  const horizontal = bestSafeLabelSegment(points, labelWidth);
  if (horizontal) candidates.push({ x: horizontal.x, y: horizontal.y });

  // Support short horizontal, vertical, and diagonal routes without rotating text.
  points.slice(0, -1).forEach((start, index) => {
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (Math.abs(dy) < 1) {
      candidates.push({ ...midpoint, y: midpoint.y - 40 }, { ...midpoint, y: midpoint.y + 40 });
    } else if (Math.abs(dx) < 1) {
      candidates.push({ ...midpoint, x: midpoint.x - 28 }, { ...midpoint, x: midpoint.x + 28 });
    } else {
      const nx = -dy / length;
      const ny = dx / length;
      candidates.push(
        { x: midpoint.x + nx * 24, y: midpoint.y + ny * 24 },
        { x: midpoint.x - nx * 24, y: midpoint.y - ny * 24 },
      );
    }
  });

  return candidates.find((candidate) => ![...obstacles, ...labelObstacles].some((rect) => {
    const left = candidate.x - labelWidth / 2;
    const right = candidate.x + labelWidth / 2;
    const top = candidate.y - labelHeight / 2;
    const bottom = candidate.y + labelHeight / 2;
    return right > rect.x - LABEL_NODE_CLEARANCE &&
      left < rect.x + rect.width + LABEL_NODE_CLEARANCE &&
      bottom > rect.y - LABEL_NODE_CLEARANCE &&
      top < rect.y + rect.height + LABEL_NODE_CLEARANCE;
  })) ?? null;
}

/** Routes an existing canonical edge from node boundaries without changing its direction. */
export function routeGraphEdge(
  from: GraphPoint,
  to: GraphPoint,
  occupied: GraphRect[] = [],
) {
  const sourceRect: GraphRect = { x: from.x, y: from.y - 22, width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
  const targetRect: GraphRect = { x: to.x, y: to.y - 22, width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
  const horizontal = to.x >= from.x;
  const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
  const source = vertical
    ? { x: from.x + GRAPH_NODE_WIDTH / 2, y: to.y > from.y ? from.y + 22 : from.y - 22 }
    : { x: horizontal ? from.x + GRAPH_NODE_WIDTH : from.x, y: from.y };
  const target = vertical
    ? { x: to.x + GRAPH_NODE_WIDTH / 2, y: to.y > from.y ? to.y - 22 : to.y + 22 }
    : { x: horizontal ? to.x : to.x + GRAPH_NODE_WIDTH, y: to.y };
  const obstacles = occupied.filter(
    (rect) => !(rect.x === sourceRect.x && rect.y === sourceRect.y) && !(rect.x === targetRect.x && rect.y === targetRect.y),
  );
  const direct = [source, target];
  if (!polylineIntersectsObstacles(direct, obstacles)) return direct;
  const channels = vertical
    ? [source.x + 42, source.x - 42, target.x + 42, target.x - 42]
    : [source.y + 42, source.y - 42, target.y + 42, target.y - 42];
  for (const channel of channels) {
    const candidate = vertical
      ? [source, { x: source.x, y: channel }, { x: target.x, y: channel }, target]
      : [source, { x: channel, y: source.y }, { x: channel, y: target.y }, target];
    if (!polylineIntersectsObstacles(candidate, obstacles)) return candidate;
  }
  return vertical
    ? [source, { x: source.x, y: (source.y + target.y) / 2 }, { x: target.x, y: (source.y + target.y) / 2 }, target]
    : [source, { x: (source.x + target.x) / 2, y: source.y }, { x: (source.x + target.x) / 2, y: target.y }, target];
}

export function zoomAtPoint(
  state: ViewportState,
  point: { x: number; y: number },
  requestedZoom: number,
  bounds = { min: 0.45, max: 3.5 },
): ViewportState {
  const nextZoom = Math.min(bounds.max, Math.max(bounds.min, requestedZoom));
  const sceneX = (point.x - state.pan.x) / state.zoom;
  const sceneY = (point.y - state.pan.y) / state.zoom;
  return {
    zoom: nextZoom,
    pan: {
      x: point.x - sceneX * nextZoom,
      y: point.y - sceneY * nextZoom,
    },
  };
}
const PRIORITY_KINDS = [
  "HTTP_ROUTE",
  "ENTRYPOINT",
  "BUSINESS_ACTION",
  "AI_MODEL_INVOCATION",
  "AI_PROVIDER",
  "AGENT_BOUNDARY_SOURCE",
  "EXTERNAL_SERVICE",
  "AI_INPUT",
  "AI_OUTPUT",
  "FUNCTION",
  "METHOD",
  "CALL_SITE",
];

const OVERVIEW_NODE_TARGET = 12;
const OVERVIEW_NODE_HARD_MAX = 16;
const FUNCTION_DETAIL_LIMIT = 12;
const EXECUTION_RELATIONSHIPS = new Set([
  "CALLS",
  "CALLS_API",
  "FLOWS_TO",
  "HANDLED_BY",
  "INVOKES_BOUNDARY",
  "SENDS_TO_AI",
]);
const ENDPOINT_KINDS = new Set([
  "HTTP_ROUTE",
  "ENTRYPOINT",
  "BUSINESS_ACTION",
  "AI_MODEL_INVOCATION",
  "AI_PROVIDER",
  "AGENT_BOUNDARY_SOURCE",
  "EXTERNAL_SERVICE",
]);

export function buildEvidenceGraphOverview(nodes: Node[], edges: Edge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!EXECUTION_RELATIONSHIPS.has(edge.relationship.toUpperCase())) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const starts = nodes.filter((node) => ["HTTP_ROUTE", "ENTRYPOINT"].includes(node.kind.toUpperCase())).sort((a, b) => a.id.localeCompare(b.id));
  const paths: Edge[][] = [];
  const walk = (nodeId: string, path: Edge[], seen: Set<string>) => {
    if (path.length > 4 || paths.length >= 24) return;
    const nextEdges = (outgoing.get(nodeId) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    for (const edge of nextEdges) {
      if (seen.has(edge.target)) continue;
      const next = [...path, edge];
      const target = nodeById.get(edge.target);
      if (target && ENDPOINT_KINDS.has(target.kind.toUpperCase()) && next.length >= 2) paths.push(next);
      walk(edge.target, next, new Set(seen).add(edge.target));
    }
  };
  for (const start of starts) walk(start.id, [], new Set([start.id]));
  const sourceArea = (path: Edge[]) => {
    const first = path[0] ? nodeById.get(path[0].source) : undefined;
    const file = first?.file?.replaceAll("\\", "/") ?? "";
    return file.split("/").slice(0, 2).join("/") || first?.kind || "unknown";
  };
  const endpointScore = (path: Edge[]) => {
    const target = path.length ? nodeById.get(path[path.length - 1].target) : undefined;
    return target && ENDPOINT_KINDS.has(target.kind.toUpperCase()) ? 4 : 0;
  };
  const pathScore = (path: Edge[]) =>
    path.length * 2 +
    endpointScore(path) +
    path.filter((edge) => EXECUTION_RELATIONSHIPS.has(edge.relationship.toUpperCase())).length;
  paths.sort(
    (a, b) =>
      pathScore(b) - pathScore(a) ||
      a.map((edge) => edge.id).join().localeCompare(b.map((edge) => edge.id).join()),
  );
  const selected = new Set<string>();
  const selectedEdges = new Set<string>();
  const coveredAreas = new Set<string>();
  const remainingPaths = [...paths];
  let selectedPathCount = 0;
  while (remainingPaths.length && selectedPathCount < 4) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    remainingPaths.forEach((path, index) => {
      const area = sourceArea(path);
      const score = pathScore(path) + (coveredAreas.has(area) ? -3 : 6);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    const [path] = remainingPaths.splice(bestIndex, 1);
    if (!path) break;
    const pathNodes = new Set<string>();
    if (path[0]) {
      pathNodes.add(path[0].source);
      for (const edge of path) pathNodes.add(edge.target);
    }
    const hasUseful = [...pathNodes].some((id) => {
      const node = nodeById.get(id);
      return node && ENDPOINT_KINDS.has(node.kind.toUpperCase());
    });
    if (!hasUseful) continue;
    for (const id of pathNodes) selected.add(id);
    for (const edge of path) selectedEdges.add(edge.id);
    coveredAreas.add(sourceArea(path));
    selectedPathCount += 1;
    if (selected.size >= OVERVIEW_NODE_TARGET || selectedEdges.size >= 24) break;
  }
  if (!selected.size) {
    for (const node of nodes.filter((item) => ENDPOINT_KINDS.has(item.kind.toUpperCase())).sort((a, b) => a.id.localeCompare(b.id))) {
      selected.add(node.id);
      if (selected.size >= OVERVIEW_NODE_TARGET) break;
    }
  }
  let overviewNodes = nodes.filter((node) => selected.has(node.id));
  let overviewEdges = edges.filter(
    (edge) => selectedEdges.has(edge.id) || (selected.has(edge.source) && selected.has(edge.target) && EXECUTION_RELATIONSHIPS.has(edge.relationship.toUpperCase())),
  );
  // If endpoint matching yields isolated anchors, recover a real bounded
  // connected fragment using weighted canonical edges (never synthetic).
  if (overviewNodes.length > 1 && overviewEdges.length === 0) {
    const weighted = [...edges].sort((a, b) => {
      const cost = (edge: Edge) => {
        const relation = edge.relationship.toUpperCase();
        if (EXECUTION_RELATIONSHIPS.has(relation)) return 0;
        if (relation.includes("DECLARE") || relation.includes("CONTAIN")) return 2;
        if (relation.includes("IMPORT") || relation.includes("DEPEND")) return 4;
        return 1;
      };
      return cost(a) - cost(b) || a.id.localeCompare(b.id);
    });
    selected.clear();
    for (const edge of weighted) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      if (priority(source.kind) > 8 && priority(target.kind) > 8) continue;
      selected.add(source.id);
      selected.add(target.id);
      if (selected.size >= OVERVIEW_NODE_HARD_MAX) break;
    }
    overviewNodes = nodes.filter((node) => selected.has(node.id));
    overviewEdges = edges.filter(
      (edge) => selected.has(edge.source) && selected.has(edge.target),
    );
  }
  return { nodes: overviewNodes, edges: overviewEdges };
}

export function buildEvidenceGraphNeighborhood(
  selectedId: string,
  nodes: Node[],
  edges: Edge[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = edges
    .filter((edge) => edge.source === selectedId || edge.target === selectedId)
    .flatMap((edge) => [edge.source, edge.target])
    .filter((id) => id !== selectedId);
  const unique = [...new Set(adjacent)]
    .map((id) => nodeById.get(id))
    .filter((node): node is Node => Boolean(node))
    .sort((a, b) => priority(a.kind) - priority(b.kind) || a.id.localeCompare(b.id))
    .slice(0, FUNCTION_DETAIL_LIMIT);
  const ids = new Set([selectedId, ...unique.map((node) => node.id)]);
  return {
    nodes: nodes.filter((node) => ids.has(node.id)),
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

export function selectEvidenceTopology(
  nodes: Node[],
  edges: Edge[],
): EvidenceTopology {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  // The API already provides the bounded, customer-safe projection. Preserve
  // that topology intact; viewport navigation handles dense graphs.
  const projectedNodes = [...nodes].sort(compareNodes);
  const ids = new Set(projectedNodes.map((node) => node.id));
  const projectedEdges = validEdges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .sort((a, b) => a.id.localeCompare(b.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of projectedNodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of projectedEdges) {
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const layers = new Map<string, number>();
  const queue = projectedNodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id)
    .sort();
  while (queue.length) {
    const id = queue.shift()!;
    const layer = layers.get(id) ?? 0;
    for (const target of outgoing.get(id) ?? []) {
      layers.set(target, Math.max(layers.get(target) ?? 0, layer + 1));
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
    queue.sort();
  }
  // Cyclic components are assigned deterministic semantic layers without
  // changing edge direction or graph data.
  projectedNodes.forEach((node) => {
    if (!layers.has(node.id)) layers.set(node.id, priority(node.kind));
  });
  const pathByNode = new Map<string, number>();
  const pathStepByNode = new Map<string, number>();
  const presentationPaths: Array<{ nodeIds: string[]; edgeIds: string[] }> = [];
  const incomingIds = new Set(projectedEdges.map((edge) => edge.target));
  const starts = projectedNodes.filter((node) => !incomingIds.has(node.id));
  let lane = 0;
  for (const start of starts) {
    let current: string | undefined = start.id;
    let step = 0;
    const seen = new Set<string>();
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    while (current && !seen.has(current)) {
      seen.add(current);
      nodeIds.push(current);
      if (!pathByNode.has(current)) {
        pathByNode.set(current, lane % 4);
        pathStepByNode.set(current, step);
      }
      const nextEdge = (projectedEdges
        .filter((edge) => edge.source === current)
        .sort((a, b) => a.id.localeCompare(b.id))[0]);
      const next: string | undefined = nextEdge?.target;
      if (nextEdge) edgeIds.push(nextEdge.id);
      current = next;
      step += 1;
      if (step > projectedNodes.length) break;
    }
    if (nodeIds.length > 1) presentationPaths.push({ nodeIds, edgeIds });
    lane += 1;
  }
  // Assign disconnected/cyclic leftovers to deterministic lanes.
  for (const node of projectedNodes) {
    if (!pathByNode.has(node.id)) {
      pathByNode.set(node.id, lane % 4);
      pathStepByNode.set(node.id, 0);
      presentationPaths.push({ nodeIds: [node.id], edgeIds: [] });
      lane += 1;
    }
  }
  const positions = new Map<string, { x: number; y: number }>();
  const occupied = new Set<string>();
  projectedNodes.forEach((node) => {
    const laneIndex = pathByNode.get(node.id) ?? 0;
    let step = pathStepByNode.get(node.id) ?? 0;
    // Branches and supplemental nodes can share a lane-step. Advance only
    // the colliding presentation slot; canonical membership and edges stay
    // unchanged.
    while (occupied.has(`${laneIndex}:${step}`)) step += 1;
    occupied.add(`${laneIndex}:${step}`);
    positions.set(node.id, { x: 90 + step * 230, y: 70 + laneIndex * 105 });
  });
  return {
    nodes: projectedNodes,
    edges: projectedEdges,
    positions,
    paths: presentationPaths,
  };
}

function priority(kind: string) {
  const index = PRIORITY_KINDS.indexOf(kind.toUpperCase());
  return index === -1 ? PRIORITY_KINDS.length : index;
}
function compareNodes(a: Node, b: Node) {
  return priority(a.kind) - priority(b.kind) || a.id.localeCompare(b.id);
}
