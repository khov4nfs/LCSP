import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
  type LegalSourceSummary,
} from "@lcsp/contracts/legal-source";

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
const { LegalSourceLifecycleBadge } =
  await import("../src/features/admin/components/atoms/legal-source-lifecycle-badge.tsx");
const { LegalSourceListCard } =
  await import("../src/features/admin/components/molecules/legal-source-list-card.tsx");

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

describe("Admin Legal Sources UI components (Frames 50-51)", () => {
  it("renders CollectionMetricCard spotlight with proportional distribution segments", () => {
    const el = renderNode(
      createElement(CollectionMetricCard, {
        variant: COLLECTION_METRIC_VARIANTS.spotlight,
        label: "Legal sources",
        value: 184,
        context: "All source documents",
        segments: [
          { key: "active", count: 162, toneClassName: "bg-bento-accent" },
          { key: "draft", count: 12, toneClassName: "bg-status-warning" },
          {
            key: "unconfigured",
            count: 10,
            toneClassName: "bg-muted-foreground/50",
          },
        ],
      }),
    );
    assert.match(el.textContent ?? "", /184/);
    assert.ok(el.querySelector(".from-bento-from"));
    assert.ok(el.querySelector(".bg-bento-accent"));
  });

  it("renders interactive CollectionMetricCard indicator and toggles filter state", () => {
    let clicked = 0;
    const el = renderNode(
      createElement(CollectionMetricCard, {
        variant: COLLECTION_METRIC_VARIANTS.indicator,
        tone: COLLECTION_METRIC_TONES.warning,
        label: "Draft",
        value: 12,
        context: "Open draft version",
        isActive: true,
        onClick: () => {
          clicked += 1;
        },
      }),
    );
    const btn = el.querySelector("button");
    assert.ok(btn);
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.ok(el.querySelector(".text-status-warning"));
    act(() => {
      btn.click();
    });
    assert.equal(clicked, 1);
  });

  it("renders LegalSourceLifecycleBadge with semantic status tokens", () => {
    const activeEl = renderNode(
      createElement(LegalSourceLifecycleBadge, {
        status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
      }),
    );
    assert.ok(activeEl.querySelector(".bg-status-success-bg"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const draftEl = renderNode(
      createElement(LegalSourceLifecycleBadge, {
        status: LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
      }),
    );
    assert.ok(draftEl.querySelector(".bg-status-warning-bg"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const invalidEl = renderNode(
      createElement(LegalSourceLifecycleBadge, {
        status: LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid,
      }),
    );
    assert.ok(invalidEl.querySelector(".bg-status-danger-bg"));
  });

  it("renders LegalSourceListCard with semantic active version pill", () => {
    const source: LegalSourceSummary = {
      id: "src-1",
      slug: "decree-147",
      name: "Decree 147/2024/ND-CP",
      description: "Internet services decree",
      createdAt: "2026-11-20T00:00:00.000Z",
      versionCount: 1,
      activeVersion: {
        id: "ver-1",
        version: "1",
        status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        basedOnVersionId: null,
        documentCount: 2,
        readyDocumentCount: 2,
        chunkCount: 24,
        createdAt: "2026-11-20T00:00:00.000Z",
        activatedAt: "2026-11-21T00:00:00.000Z",
      },
      latestVersion: {
        id: "ver-1",
        version: "1",
        status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        basedOnVersionId: null,
        documentCount: 2,
        readyDocumentCount: 2,
        chunkCount: 24,
        createdAt: "2026-11-20T00:00:00.000Z",
        activatedAt: "2026-11-21T00:00:00.000Z",
      },
    };
    const el = renderNode(createElement(LegalSourceListCard, { source }));
    assert.match(el.textContent ?? "", /Decree 147\/2024\/ND-CP/);
    assert.ok(el.querySelector(".bg-status-success-bg"));
  });
});
