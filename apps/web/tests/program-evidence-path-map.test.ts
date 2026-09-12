import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bestSafeLabelSegment,
  findLabelPlacement,
  polylineIntersectsObstacles,
  fitGraphToViewport,
  longestHorizontalSegment,
  routeGraphEdge,
  selectEvidenceTopology,
  zoomAtPoint,
} from "../src/features/assessment-runtime/utils/program-evidence-path-map";

test("routes edges from node boundaries", () => {
  const points = routeGraphEdge({ x: 10, y: 20 }, { x: 240, y: 20 });
  assert.deepEqual(points, [{ x: 160, y: 20 }, { x: 240, y: 20 }]);
});

test("uses direction-aware ports for reverse and vertical edges", () => {
  const reverse = routeGraphEdge({ x: 300, y: 20 }, { x: 10, y: 20 });
  assert.deepEqual(reverse[0], { x: 300, y: 20 });
  assert.deepEqual(reverse[reverse.length - 1], { x: 160, y: 20 });
  const down = routeGraphEdge({ x: 20, y: 20 }, { x: 20, y: 180 });
  assert.deepEqual(down[0], { x: 95, y: 42 });
  assert.deepEqual(down[down.length - 1], { x: 95, y: 158 });
});

test("detects complete polyline intersection with expanded obstacles", () => {
  assert.equal(
    polylineIntersectsObstacles(
      [{ x: 0, y: 0 }, { x: 200, y: 0 }],
      [{ x: 80, y: -20, width: 40, height: 40 }],
    ),
    true,
  );
});

test("chooses the longest safe horizontal label segment", () => {
  const segment = longestHorizontalSegment(
    [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 60 }, { x: 180, y: 60 }],
    80,
  );
  assert.deepEqual(segment, { x: 110, y: 60, length: 140 });
  assert.equal(longestHorizontalSegment([{ x: 0, y: 0 }, { x: 20, y: 0 }], 40), null);
});

test("anchors labels inside the safe interval with arrowhead clearance", () => {
  const segment = bestSafeLabelSegment(
    [{ x: 0, y: 0 }, { x: 180, y: 0 }],
    60,
    14,
    6,
  );
  assert.deepEqual(segment, { x: 90, y: 0, length: 92 });
  assert.equal(bestSafeLabelSegment([{ x: 0, y: 0 }, { x: 70, y: 0 }], 60), null);
});

test("places labels on two-point horizontal routes when the gap is sufficient", () => {
  const point = findLabelPlacement(
    [{ x: 160, y: 100 }, { x: 360, y: 100 }],
    60,
    [
      { x: 10, y: 78, width: 150, height: 44 },
      { x: 360, y: 78, width: 150, height: 44 },
    ],
  );
  assert.deepEqual(point, { x: 260, y: 100 });
});

test("falls back above or below a short horizontal route", () => {
  const point = findLabelPlacement(
    [{ x: 160, y: 100 }, { x: 230, y: 100 }],
    60,
    [
      { x: 10, y: 78, width: 150, height: 44 },
      { x: 230, y: 78, width: 150, height: 44 },
    ],
  );
  assert.ok(point);
  assert.notEqual(point?.y, 100);
});

test("supports diagonal and vertical label fallbacks", () => {
  assert.ok(findLabelPlacement([{ x: 0, y: 0 }, { x: 120, y: 80 }], 40, []));
  assert.ok(findLabelPlacement([{ x: 100, y: 0 }, { x: 100, y: 160 }], 40, []));
});

test("moves a colliding label to a deterministic alternate placement", () => {
  const route = [{ x: 160, y: 100 }, { x: 420, y: 100 }];
  const first = findLabelPlacement(route, 60, []);
  assert.deepEqual(first, { x: 290, y: 100 });
  const second = findLabelPlacement(route, 60, [], 16, [
    { x: first!.x - 34, y: first!.y - 12, width: 68, height: 24 },
  ]);
  assert.ok(second);
  assert.notDeepEqual(second, first);
  assert.ok(Math.abs(second!.y - 100) <= 40);
});

test("provides a deterministic fallback label point for non-horizontal routes", () => {
  const point = bestSafeLabelSegment(
    [{ x: 10, y: 10 }, { x: 90, y: 90 }],
    24,
  );
  assert.equal(point?.x, 50);
  assert.equal(point?.y, 50);
  assert.ok((point?.length ?? 0) > 24);
});

test("fits actual node bounds and allows useful zoom above 100%", () => {
  const positions = new Map([
    ["a", { x: 100, y: 250 }],
    ["b", { x: 300, y: 250 }],
  ]);
  const fit = fitGraphToViewport(positions, { width: 900, height: 620 });
  assert.ok(fit.zoom > 1);
  const centerX = fit.pan.x + 275 * fit.zoom;
  const centerY = fit.pan.y + 250 * fit.zoom;
  assert.ok(Math.abs(centerX - 450) < 1);
  assert.ok(Math.abs(centerY - 274) < 1);
});

test("centers non-zero scene bounds in the usable viewport", () => {
  const positions = new Map([
    ["a", { x: 140, y: 90 }],
    ["b", { x: 420, y: 260 }],
  ]);
  const viewport = { width: 900, height: 620 };
  const fit = fitGraphToViewport(positions, viewport);
  const minX = 140;
  const maxX = 420 + 150;
  const minY = 90 - 22;
  const maxY = 260 + 22;
  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;
  const screenCenterX = fit.pan.x + contentCenterX * fit.zoom;
  const screenCenterY = fit.pan.y + contentCenterY * fit.zoom;
  assert.ok(Math.abs(screenCenterX - 450) < 1);
  assert.ok(Math.abs(screenCenterY - 274) < 1);
});

const node = (id: string, kind: string) => ({
  id,
  kind,
  label: id,
  symbol: null,
  file: null,
  line: null,
});

test("graph-first topology preserves branching, cross-links, and edge direction", () => {
  const nodes = [
    node("a", "HTTP_ROUTE"),
    node("b", "FUNCTION"),
    node("c", "AI_PROVIDER"),
    node("d", "AI_MODEL_INVOCATION"),
    node("noise", "MODULE"),
  ];
  const edges = [
    { id: "e1", source: "a", target: "b", relationship: "CALLS" },
    { id: "e2", source: "a", target: "c", relationship: "SENDS_TO_AI" },
    { id: "e3", source: "c", target: "d", relationship: "INVOKES_BOUNDARY" },
  ];
  const topology = selectEvidenceTopology(nodes, edges);
  assert.deepEqual(
    topology.edges.map((edge) => [edge.source, edge.target]),
    [
      ["a", "b"],
      ["a", "c"],
      ["c", "d"],
    ],
  );
  assert.equal(
    topology.nodes.some((item) => item.id === "noise"),
    true,
  );
  assert.equal(topology.positions.size, 5);
  assert.equal(new Set([...topology.positions.values()].map(({ x, y }) => `${x}:${y}`)).size, topology.nodes.length);
  assert.ok(topology.nodes.every((item) => topology.positions.has(item.id)));
});

test("keeps supplemental lane nodes uniquely placed and rendered", () => {
  const nodes = Array.from({ length: 16 }, (_, index) =>
    node(`node-${index}`, index === 0 ? "HTTP_ROUTE" : "FUNCTION"),
  );
  const edges = Array.from({ length: 12 }, (_, index) => ({
    id: `edge-${index}`,
    source: `node-${index}`,
    target: `node-${index + 1}`,
    relationship: "CALLS",
  }));
  const topology = selectEvidenceTopology(nodes, edges);
  const coordinates = new Set(
    [...topology.positions.values()].map(({ x, y }) => `${x}:${y}`),
  );
  assert.equal(topology.nodes.length, 16);
  assert.equal(topology.edges.length, 12);
  assert.equal(coordinates.size, topology.nodes.length);
  assert.equal(topology.paths.flatMap((path) => path.nodeIds).length > 0, true);
});

test("preserves the complete bounded API topology without a second UI cap", () => {
  const nodes = Array.from({ length: 40 }, (_, index) =>
    node(`node-${index}`, index === 0 ? "HTTP_ROUTE" : "FUNCTION"),
  );
  const edges = Array.from({ length: 39 }, (_, index) => ({
    id: `edge-${index}`,
    source: `node-${index}`,
    target: `node-${index + 1}`,
    relationship: "CALLS",
  }));
  const topology = selectEvidenceTopology(nodes, edges);
  assert.equal(topology.nodes.length, 40);
  assert.equal(topology.edges.length, 39);
});

test("keeps the scene point under the cursor while zooming", () => {
  const before = { zoom: 1, pan: { x: 100, y: 80 } };
  const point = { x: 400, y: 300 };
  const after = zoomAtPoint(before, point, 2);
  assert.equal(
    (point.x - before.pan.x) / before.zoom,
    (point.x - after.pan.x) / after.zoom,
  );
  assert.equal(
    (point.y - before.pan.y) / before.zoom,
    (point.y - after.pan.y) / after.zoom,
  );
});
