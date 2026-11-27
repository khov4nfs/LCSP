import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AUTHORED_LOCALIZATION_OPERATIONAL_STATES,
  AUTHORED_LOCALIZATION_READINESS_STATES,
} from "@lcsp/contracts/assessment-domain";

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

const { ReviewStatusBadge } =
  await import("../src/features/admin/components/atoms/review-status-badge.tsx");
const { LegalTextComparison } =
  await import("../src/features/admin/components/molecules/legal-text-comparison.tsx");

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

describe("Admin Translation Review UI components (Frames 79-80)", () => {
  it("renders ReviewStatusBadge with semantic status tokens across operational and readiness states", () => {
    const el = renderNode(
      createElement(
        "div",
        null,
        createElement(ReviewStatusBadge, {
          status: AUTHORED_LOCALIZATION_OPERATIONAL_STATES.READY,
        }),
        createElement(ReviewStatusBadge, {
          status: AUTHORED_LOCALIZATION_OPERATIONAL_STATES.PROVIDER_PENDING,
        }),
        createElement(ReviewStatusBadge, {
          status: AUTHORED_LOCALIZATION_OPERATIONAL_STATES.OUTPUT_REVIEW_REQUIRED,
        }),
        createElement(ReviewStatusBadge, {
          status: AUTHORED_LOCALIZATION_OPERATIONAL_STATES.FAILED,
        }),
        createElement(ReviewStatusBadge, {
          status: AUTHORED_LOCALIZATION_READINESS_STATES.PENDING,
        }),
      ),
    );
    assert.ok(el.querySelector(".bg-status-success-bg"));
    assert.ok(el.querySelector(".bg-status-info-bg"));
    assert.ok(el.querySelector(".bg-status-warning-bg"));
    assert.ok(el.querySelector(".bg-status-danger-bg"));
  });

  it("renders LegalTextComparison side-by-side and omits empty candidate panel", () => {
    const bothEl = renderNode(
      createElement(LegalTextComparison, {
        originalLabel: "Original text",
        originalText: "Điều 1. Phạm vi điều chỉnh",
        candidateLabel: "Candidate translation",
        candidateText: "Article 1. Scope of regulation",
      }),
    );
    assert.match(bothEl.textContent ?? "", /Điều 1\. Phạm vi điều chỉnh/);
    assert.match(bothEl.textContent ?? "", /Article 1\. Scope of regulation/);
    assert.ok(bothEl.querySelector(".md\\:grid-cols-2"));

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const origOnlyEl = renderNode(
      createElement(LegalTextComparison, {
        originalLabel: "Original text",
        originalText: "Điều 2. Đối tượng áp dụng",
        candidateLabel: "Candidate translation",
        candidateText: "",
      }),
    );
    assert.match(origOnlyEl.textContent ?? "", /Điều 2\. Đối tượng áp dụng/);
    assert.doesNotMatch(origOnlyEl.textContent ?? "", /Candidate translation/);
  });
});
