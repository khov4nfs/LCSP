import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { ProgramEvidenceGraphDetail } from "../src/lib/api/evidence-graph-detail-client";

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
const {
  getProgramEvidenceGraphDetailState,
  PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES,
} = await import("../src/lib/api/evidence-graph-detail-client");
const roots: ReturnType<typeof createRoot>[] = [];

const detail: ProgramEvidenceGraphDetail = {
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
        ai_usage_role: "ROUTE_HANDLER_FEATURE",
        evidence_state: null,
        resolution_state: "OBSERVED",
      },
      {
        id: "b",
        kind: "FUNCTION",
        label: "Node B",
        symbol: "handleB",
        file: "src/b.ts",
        line: 2,
        ai_usage_role: "SERVICE_CLIENT",
        evidence_state: null,
        resolution_state: "OBSERVED",
      },
      {
        id: "c",
        kind: "AI_PROVIDER",
        label: "Node C",
        symbol: "callProvider",
        file: "src/provider.ts",
        line: 9,
        ai_usage_role: "AI_PROVIDER",
        evidence_state: "AI_PROVIDER_REFERENCE",
        resolution_state: "CORROBORATED",
      },
      {
        id: "d",
        kind: "AI_MODEL_INVOCATION",
        label: "Node D",
        symbol: null,
        file: null,
        line: null,
        ai_usage_role: "AI_SDK_INVOCATION",
        evidence_state: "CONFIRMED_AI_CALL",
        resolution_state: "OBSERVED",
      },
    ],
    edges: [
      {
        id: "e1",
        source: "a",
        target: "b",
        relationship: "CALLS",
        evidence_state: null,
        resolution_state: "OBSERVED",
      },
      {
        id: "e2",
        source: "a",
        target: "c",
        relationship: "SENDS_TO_AI",
        evidence_state: "AI_PROVIDER_REFERENCE",
        resolution_state: "CORROBORATED",
      },
      {
        id: "e3",
        source: "b",
        target: "d",
        relationship: "FLOWS_TO",
        evidence_state: "CONFIRMED_AI_CALL",
        resolution_state: "OBSERVED",
      },
      {
        id: "e4",
        source: "c",
        target: "d",
        relationship: "FLOWS_TO",
        evidence_state: "CONFIRMED_AI_CALL",
        resolution_state: "OBSERVED",
      },
    ],
    usage_flow_count: 2,
    rendered_usage_flow_count: 2,
    omitted_usage_flow_count: 0,
    usage_group_count: 0,
    rendered_usage_group_count: 0,
    omitted_usage_group_count: 0,
    usage_flow_groups: [],
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

for (const [code, status, expectedState] of [
  [EVIDENCE_ERROR_CODES.notReady, 202, "pending"],
  [EVIDENCE_ERROR_CODES.buildFailed, 409, "failed"],
  [EVIDENCE_ERROR_CODES.notFound, 404, "notFound"],
  ["ASSESSMENT_NOT_FOUND", 404, "unavailable"],
] as const) {
  test(`maps evidence graph ${code} problem to ${expectedState} state`, async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          problem: { code, status, requiredAction: REQUIRED_ACTIONS.none },
        }),
        { status, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    try {
      const result =
        await getProgramEvidenceGraphDetailState("assessment-graph");
      assert.deepEqual(result, {
        state: PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES[expectedState],
        detail: null,
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}

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
  assert.ok(
    visibleRelationshipLabels.includes("CALLS") ||
      visibleRelationshipLabels.includes("FLOWS_TO"),
  );

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
  assert.match(
    container.textContent ?? "",
    /Open Artifacts|Mở danh sách Artifacts/,
  );
  assert.match(
    container.textContent ?? "",
    /Evidence graph is pinned|Sơ đồ này được tạo từ snapshot/,
  );
});

test("renders the governed no-AI usage empty state without graph noise", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      React.createElement(GraphFirstDetail, {
        assessmentId: "assessment-1",
        detail: {
          ...detail,
          paths: { nodes: [], edges: [] },
        },
      }),
    ),
  );

  assert.match(
    container.textContent ?? "",
    /No governed AI usage path|chưa có đường dẫn sử dụng AI/,
  );
  assert.doesNotMatch(container.textContent ?? "", /Node A|Node B/);
});

test("renders AI usage roles and unresolved evidence states", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      React.createElement(GraphFirstDetail, {
        assessmentId: "assessment-1",
        detail: {
          ...detail,
          paths: {
            nodes: [
              {
                id: "route",
                kind: "HTTP_ROUTE",
                label: "POST /ai",
                symbol: null,
                file: null,
                line: null,
                ai_usage_role: "ROUTE_HANDLER_FEATURE",
                evidence_state: null,
                resolution_state: "OBSERVED",
              },
              {
                id: "gateway",
                kind: "AI_API_CANDIDATE",
                label: "custom model gateway",
                symbol: null,
                file: null,
                line: null,
                ai_usage_role: "AI_API_ENDPOINT",
                evidence_state: "POSSIBLE_AI_CALL",
                resolution_state: "UNRESOLVED",
              },
            ],
            edges: [
              {
                id: "edge",
                source: "route",
                target: "gateway",
                relationship: "CALLS_EXTERNAL",
                evidence_state: "POSSIBLE_AI_CALL",
                resolution_state: "UNRESOLVED",
              },
            ],
          },
        },
      }),
    ),
  );

  assert.match(
    container.textContent ?? "",
    /REST\/API AI endpoint|Endpoint AI REST\/API/,
  );
  assert.match(container.textContent ?? "", /Unresolved|Chưa phân giải/);
  assert.doesNotMatch(container.textContent ?? "", /OPENAI|ANTHROPIC/);
});

test("renders omitted AI usage metadata when the projection reports overflow", async () => {
  const container = await renderGraphFirstDetailWithPaths({
    omitted_usage_flow_count: 3,
    usage_group_count: 10,
    rendered_usage_group_count: 4,
    omitted_usage_group_count: 6,
    usage_flow_groups: [
      renderedOverflowGroup(0),
      ...Array.from({ length: 4 }, (_, index) => omittedGroupPreview(index)),
    ],
  });

  assert.match(
    container.textContent ?? "",
    /Additional governed AI usage paths|Có thêm đường dẫn sử dụng AI/,
  );
  assert.match(container.textContent ?? "", /Module B -> AI_MODEL_INVOCATION/);
  assert.match(container.textContent ?? "", /5 hidden flows|5 luồng đang ẩn/);
  assert.match(
    container.textContent ?? "",
    /3 more hidden groups|3 nhóm ẩn khác/,
  );
});

test("counts all omitted groups when rendered overflow consumes every visible preview slot", async () => {
  const container = await renderGraphFirstDetailWithPaths({
    omitted_usage_flow_count: 10,
    usage_group_count: 14,
    rendered_usage_group_count: 4,
    omitted_usage_group_count: 6,
    usage_flow_groups: [
      ...Array.from({ length: 4 }, (_, index) => renderedOverflowGroup(index)),
      ...Array.from({ length: 4 }, (_, index) => omittedGroupPreview(index)),
    ],
  });

  assert.match(
    container.textContent ?? "",
    /Module B 3 -> AI_MODEL_INVOCATION/,
  );
  assert.doesNotMatch(
    container.textContent ?? "",
    /Hidden module 0 -> AI_MODEL_INVOCATION/,
  );
  assert.match(
    container.textContent ?? "",
    /6 more hidden groups|6 nhóm ẩn khác/,
  );
});

test("subtracts only visible fully omitted group previews from the remaining group count", async () => {
  const container = await renderGraphFirstDetailWithPaths({
    omitted_usage_flow_count: 10,
    usage_group_count: 10,
    rendered_usage_group_count: 0,
    omitted_usage_group_count: 6,
    usage_flow_groups: Array.from({ length: 4 }, (_, index) =>
      omittedGroupPreview(index),
    ),
  });

  assert.match(
    container.textContent ?? "",
    /Hidden module 3 -> AI_MODEL_INVOCATION/,
  );
  assert.match(
    container.textContent ?? "",
    /2 more hidden groups|2 nhóm ẩn khác/,
  );
});

async function renderGraphFirstDetailWithPaths(
  paths: Partial<ProgramEvidenceGraphDetail["paths"]>,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      React.createElement(GraphFirstDetail, {
        assessmentId: "assessment-1",
        detail: {
          ...detail,
          paths: {
            ...detail.paths,
            ...paths,
          },
        },
      }),
    ),
  );
  return container;
}

function renderedOverflowGroup(
  index: number,
): NonNullable<
  ProgramEvidenceGraphDetail["paths"]["usage_flow_groups"]
>[number] {
  return {
    key: `module-b-${index}`,
    label:
      index === 0
        ? "Module B -> AI_MODEL_INVOCATION"
        : `Module B ${index} -> AI_MODEL_INVOCATION`,
    source_node_id: `module:b-${index}`,
    source_label: index === 0 ? "Module B" : `Module B ${index}`,
    provider_label: null,
    gateway_label: null,
    usage_flow_count: 6,
    rendered_usage_flow_count: 1,
    omitted_usage_flow_count: 5,
  };
}

function omittedGroupPreview(
  index: number,
): NonNullable<
  ProgramEvidenceGraphDetail["paths"]["usage_flow_groups"]
>[number] {
  return {
    key: `hidden-${index}`,
    label: `Hidden module ${index} -> AI_MODEL_INVOCATION`,
    source_node_id: `module:hidden-${index}`,
    source_label: `Hidden module ${index}`,
    provider_label: null,
    gateway_label: null,
    usage_flow_count: 1,
    rendered_usage_flow_count: 0,
    omitted_usage_flow_count: 1,
  };
}

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
