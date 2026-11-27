import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UsageMetricsProps } from "../src/features/admin/types/admin-usage.types.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

for (const key of [
  "window",
  "self",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLButtonElement",
  "Node",
  "Event",
  "MouseEvent",
  "MutationObserver",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "window" ? dom.window : dom.window[key],
  });
}
for (const key of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key].bind(dom.window),
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const { AdminUsageMetrics } =
  await import("../src/features/admin/components/molecules/admin-usage-metrics.tsx");
const { AdminUsageInvocations } =
  await import("../src/features/admin/components/organisms/admin-usage-invocations.tsx");

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function renderNode(node: ReturnType<typeof createElement>) {
  activeContainer = document.createElement("div");
  document.body.appendChild(activeContainer);
  activeRoot = createRoot(activeContainer);
  act(() => {
    activeRoot!.render(node);
  });
  return activeContainer;
}

afterEach(() => {
  if (activeRoot) {
    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
  }
  activeContainer?.remove();
  activeContainer = null;
});

function makeSummary(
  inputKnown = "960000",
  outputKnown = "280000",
): UsageMetricsProps["summary"] {
  const totalKnown = String(BigInt(inputKnown) + BigInt(outputKnown));
  return {
    calls: 84,
    successfulResponses: 82,
    failedAttempts: 2,
    unresolvedAttempts: 0,
    usageUnknownInvocations: 0,
    unpricedInvocations: 0,
    incompleteCostInvocations: 0,
    estimatedCostUsd: "12.40",
    knownEstimatedCostUsd: "12.40",
    tokens: {
      inputTokens: { known: inputKnown, unknownInvocations: 0 },
      outputTokens: { known: outputKnown, unknownInvocations: 0 },
      totalTokens: { known: totalKnown, unknownInvocations: 0 },
      inputTokensIncludingCache: { known: inputKnown, unknownInvocations: 0 },
      cachedInputTokens: { known: "0", unknownInvocations: 0 },
      cacheWriteTokens: { known: "0", unknownInvocations: 0 },
      cacheWrite5mTokens: { known: "0", unknownInvocations: 0 },
      cacheWrite1hTokens: { known: "0", unknownInvocations: 0 },
      visibleOutputTokens: { known: outputKnown, unknownInvocations: 0 },
      reasoningTokens: { known: "0", unknownInvocations: 0 },
    },
  };
}

describe("Admin AI Usage UI components (Frame 56)", () => {
  it("renders AdminUsageMetrics with NextMetricCard embedded cards and token composition bar", () => {
    const el = renderNode(
      createElement(AdminUsageMetrics, { summary: makeSummary() }),
    );
    assert.equal(el.querySelectorAll(".bg-bento-card").length, 3);
    assert.match(el.textContent ?? "", /1240000/);
    assert.match(el.textContent ?? "", /77\.4%/);
    assert.match(el.textContent ?? "", /22\.6%/);
  });

  it("omits token composition bar when known input + output is zero", () => {
    const el = renderNode(
      createElement(AdminUsageMetrics, { summary: makeSummary("0", "0") }),
    );
    assert.equal(el.querySelectorAll(".bg-bento-card").length, 3);
    assert.doesNotMatch(el.textContent ?? "", /%/);
  });

  it("renders AdminUsageInvocations empty state", () => {
    const el = renderNode(createElement(AdminUsageInvocations, { items: [] }));
    assert.equal(el.querySelectorAll("tbody tr").length, 0);
  });
});
