import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import type { ComplianceRuleSetHistory } from "@lcsp/contracts/compliance-rule-set";

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
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const {
  COLLECTION_METRIC_TONES,
  COLLECTION_METRIC_VARIANTS,
  CollectionMetricCard,
} = await import("../src/components/molecules/collection-metric-card.tsx");
const { ComplianceRuleSetHistoryTable } =
  await import("../src/features/admin/components/organisms/compliance-rule-set-history-table.tsx");

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

describe("Admin Compliance Rule Sets UI components (Frames 52-54, 81, 94, 97)", () => {
  it("renders CollectionMetricCard with danger tone and spotlight distribution", () => {
    const spotlightEl = renderNode(
      createElement(CollectionMetricCard, {
        variant: COLLECTION_METRIC_VARIANTS.spotlight,
        label: "Compliance Rule Sets",
        value: 4,
        context: "Rule set versions",
        segments: [
          { key: "active", count: 1, toneClassName: "bg-bento-accent" },
          {
            key: "superseded",
            count: 3,
            toneClassName: "bg-muted-foreground/50",
          },
        ],
      }),
    );
    assert.match(spotlightEl.textContent ?? "", /4/);
    assert.ok(spotlightEl.querySelector(".from-bento-from"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const dangerEl = renderNode(
      createElement(CollectionMetricCard, {
        variant: COLLECTION_METRIC_VARIANTS.indicator,
        tone: COLLECTION_METRIC_TONES.danger,
        label: "Failed",
        value: 2,
        context: "Preparation",
      }),
    );
    assert.ok(dangerEl.querySelector(".text-status-danger"));
  });

  it("renders ComplianceRuleSetHistoryTable with semantic status tokens and empty state", () => {
    const emptyEl = renderNode(
      createElement(ComplianceRuleSetHistoryTable, { ruleSets: [] }),
    );
    assert.equal(emptyEl.querySelectorAll("tbody tr").length, 0);

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const ruleSets: ComplianceRuleSetHistory["ruleSets"] = [
      {
        ruleSetVersionId: "rs-1",
        version: "2026.11.p1",
        legalSourceVersionId: "src-1",
        legalSourceVersion: "2026.11",
        ruleSetDigest: "a".repeat(64),
        lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
        activatedAt: "2026-11-24T00:00:00.000Z",
        supersededAt: null,
        createdAt: "2026-11-24T00:00:00.000Z",
        legalRequirementCount: 37,
        assessmentRuleCount: 62,
      },
      {
        ruleSetVersionId: "rs-2",
        version: "2026.10.p1",
        legalSourceVersionId: "src-1",
        legalSourceVersion: "2026.10",
        ruleSetDigest: "b".repeat(64),
        lifecycleState: ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
        activatedAt: "2026-10-11T00:00:00.000Z",
        supersededAt: "2026-11-24T00:00:00.000Z",
        createdAt: "2026-10-11T00:00:00.000Z",
        legalRequirementCount: 31,
        assessmentRuleCount: 51,
      },
    ];
    const popEl = renderNode(
      createElement(ComplianceRuleSetHistoryTable, { ruleSets }),
    );
    assert.equal(popEl.querySelectorAll("tbody tr").length, 2);
    assert.ok(popEl.querySelector(".bg-status-success-bg"));
    assert.match(popEl.textContent ?? "", /2026\.11\.p1/);
    assert.match(popEl.textContent ?? "", /37/);
    assert.match(popEl.textContent ?? "", /62/);
  });
});
