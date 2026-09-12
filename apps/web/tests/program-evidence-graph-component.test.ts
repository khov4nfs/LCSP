import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const [key, value] of Object.entries({
  window: dom.window,
  self: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  Node: dom.window.Node,
  React,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});
const { createRoot } = await import("react-dom/client");
const { GraphFirstDetail, GraphDetail } =
  await import("../src/features/assessment-runtime/components/organisms/program-evidence-graph-drawer");
const { normalizeProgramEvidenceGraphDetail } =
  await import("../src/lib/api/evidence-graph-detail-client");
const roots: ReturnType<typeof createRoot>[] = [];

const detail = {
  repository: {
    repository_full_name: "acme/repo",
    branch: "main",
    ref: null,
    pinned_commit: "abc",
    status: "READY",
  },
  overview: {
    modules_analyzed: null,
    code_symbols_indexed: null,
    ai_model_invocations: null,
    evidence_mapped_scope: null,
  },
  paths: {
    nodes: [
      {
        id: "a",
        kind: "HTTP_ROUTE",
        label: "Node A",
        symbol: null,
        file: "src/a.ts",
        line: 1,
      },
      {
        id: "b",
        kind: "FUNCTION",
        label: "Node B",
        symbol: "handleB",
        file: "src/b.ts",
        line: 2,
      },
      {
        id: "c",
        kind: "AI_PROVIDER",
        label: "Node C",
        symbol: "callProvider",
        file: "src/provider.ts",
        line: 9,
      },
      {
        id: "d",
        kind: "AI_MODEL_INVOCATION",
        label: "Node D",
        symbol: null,
        file: null,
        line: null,
      },
    ],
    edges: [
      { id: "e1", source: "a", target: "b", relationship: "CALLS" },
      { id: "e2", source: "a", target: "c", relationship: "SENDS_TO_AI" },
      { id: "e3", source: "b", target: "d", relationship: "FLOWS_TO" },
      { id: "e4", source: "c", target: "d", relationship: "FLOWS_TO" },
    ],
  },
  claims: [],
  provenance: {
    evidence_report_id: "report",
    snapshot_id: "snapshot",
    scan_job_id: "scan",
    generated_at: "2026-01-01T00:00:00.000Z",
    finding: null,
    source: {
      file: "src/risk.ts",
      symbol: "scoreRisk",
      start_line: 42,
      end_line: 42,
      evidence_reference: "opaque-internal-ref-123",
    },
  },
};

test("normalizes missing canonical overview metrics to null", () => {
  const normalized = normalizeProgramEvidenceGraphDetail({
    ...detail,
    overview: {
      modules_analyzed: undefined,
      code_symbols_indexed: null,
      ai_model_invocations: undefined,
      evidence_mapped_scope: null,
    },
  } as unknown as typeof detail);

  assert.deepEqual(normalized.overview, {
    modules_analyzed: null,
    code_symbols_indexed: null,
    ai_model_invocations: null,
    evidence_mapped_scope: null,
  });
});

test("preserves canonical zero overview metrics", () => {
  const normalized = normalizeProgramEvidenceGraphDetail({
    ...detail,
    overview: {
      modules_analyzed: 0,
      code_symbols_indexed: 0,
      ai_model_invocations: 0,
      evidence_mapped_scope: 0,
    },
  });

  assert.deepEqual(normalized.overview, {
    modules_analyzed: 0,
    code_symbols_indexed: 0,
    ai_model_invocations: 0,
    evidence_mapped_scope: 0,
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("renders canonical topology, preserves direction, and updates inspector on node clicks", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      React.createElement(GraphFirstDetail, {
        assessmentId: "assessment-1",
        detail,
      }),
    ),
  );
  for (const label of [
    "Node A",
    "Node B",
    "Node C",
    "Node D",
    "CALLS",
    "SENDS_TO_AI",
    "FLOWS_TO",
  ])
    assert.match(container.textContent ?? "", new RegExp(label));
  const nodeB = container.querySelector("[aria-label='Node B']") as Element;
  assert.ok(nodeB);
  const nodeBRect = nodeB.querySelector("rect");
  assert.ok(nodeBRect);
  assert.match(nodeBRect.getAttribute("class") ?? "", /stroke-border/);
  await act(async () => {
    nodeB.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.match(container.textContent ?? "", /handleB/);
  assert.match(nodeBRect.getAttribute("class") ?? "", /stroke-brand/);
  assert.match(container.textContent ?? "", /src\/b\.ts:2/);
  assert.match(container.textContent ?? "", /← CALLS|→ FLOWS_TO/);
  assert.doesNotMatch(container.textContent ?? "", /opaque-internal-ref-123/);
  const visibleRelationshipLabels = [...container.querySelectorAll("text")]
    .filter((element) => element.getAttribute("visibility") === "visible")
    .map((element) => element.textContent?.trim())
    .filter(Boolean);
  assert.ok(visibleRelationshipLabels.includes("CALLS") || visibleRelationshipLabels.includes("FLOWS_TO"));

  const svg = container.querySelector("svg");
  assert.ok(svg);
  const scene = svg.querySelector("g");
  assert.ok(scene);
  const beforePan = scene.getAttribute("transform");
  await act(async () => {
    svg.dispatchEvent(
      new dom.window.PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
      }),
    );
    svg.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        bubbles: true,
        clientX: 40,
        clientY: 30,
        pointerId: 1,
      }),
    );
    svg.dispatchEvent(
      new dom.window.PointerEvent("pointerup", {
        bubbles: true,
        clientX: 40,
        clientY: 30,
        pointerId: 1,
      }),
    );
  });
  assert.notEqual(scene.getAttribute("transform"), beforePan);
  const zoomIn = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "+",
  );
  assert.ok(zoomIn);
  await act(async () => {
    zoomIn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.match(scene.getAttribute("transform") ?? "", /scale\(1\.15\)/);
});

test("renders the workspace overview before a node is selected", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      React.createElement(GraphFirstDetail, {
        assessmentId: "assessment-1",
        detail,
      }),
    ),
  );
  assert.match(
    container.textContent ?? "",
    /Evidence overview|Tổng quan bằng chứng/,
  );
  assert.doesNotMatch(container.textContent ?? "", /Unavailable/);
  assert.match(
    container.textContent ?? "",
    /Modules analyzed|Mô-đun đã phân tích/,
  );
  assert.match(
    container.textContent ?? "",
    /Code symbols|Thành phần mã đã lập chỉ mục/,
  );
  assert.match(
    container.textContent ?? "",
    /AI model invocations|Lượt gọi mô hình AI/,
  );
  assert.match(
    container.textContent ?? "",
    /Evidence-mapped scope|Độ phủ bằng chứng kỹ thuật/,
  );
  assert.match(container.textContent ?? "", /Open Artifacts|Mở danh sách Artifacts/);
  assert.match(
    container.textContent ?? "",
    /Evidence graph is pinned|Sơ đồ này được tạo từ snapshot/,
  );
});

test("formats evidence scope as a percentage in both graph detail renderers", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const percentageDetail = {
    ...detail,
    overview: {
      ...detail.overview,
      evidence_mapped_scope: 84,
    },
  };

  await act(async () =>
    root.render(
      React.createElement(GraphFirstDetail, {
        assessmentId: "assessment-1",
        detail: percentageDetail,
      }),
    ),
  );
  assert.match(container.textContent ?? "", /84%/);
  assert.doesNotMatch(container.textContent ?? "", />84<|>84<\/dd>/);

  await act(async () =>
    root.render(
      React.createElement(GraphDetail, {
        assessmentId: "assessment-1",
        detail: percentageDetail,
      }),
    ),
  );
  assert.match(container.textContent ?? "", /84%/);
});
