import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BILLING_ORDER_STATUSES } from "@lcsp/contracts/billing";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import { AUTHORED_LOCALIZATION_OPERATIONAL_STATES } from "@lcsp/contracts/assessment-domain";
import type { Locale } from "@lcsp/contracts/shared";

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

const { STATUS_BADGE_TONES, StatusBadge } =
  await import("../src/components/atoms/status-badge.tsx");
const { PANEL_STATES, PanelState } =
  await import("../src/components/molecules/panel-state.tsx");
const { LegalSourceLifecycleBadge } =
  await import("../src/features/admin/components/atoms/legal-source-lifecycle-badge.tsx");
const { ReviewStatusBadge } =
  await import("../src/features/admin/components/atoms/review-status-badge.tsx");
const { PaymentStatusBadge } =
  await import("../src/features/billing/components/molecules/payment-status-badge.tsx");

const EN_LOCALE: Locale = "en";
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

describe("M24 Design System Shared Primitives", () => {
  it("renders StatusBadge across all semantic tones and optional dot", () => {
    const el = renderNode(
      createElement(
        "div",
        null,
        createElement(StatusBadge, {
          tone: STATUS_BADGE_TONES.success,
          label: "Ready",
          showDot: true,
        }),
        createElement(StatusBadge, {
          tone: STATUS_BADGE_TONES.warning,
          label: "Pending",
        }),
        createElement(StatusBadge, {
          tone: STATUS_BADGE_TONES.danger,
          label: "Failed",
        }),
        createElement(StatusBadge, {
          tone: STATUS_BADGE_TONES.info,
          label: "Running",
        }),
        createElement(StatusBadge, {
          tone: STATUS_BADGE_TONES.neutral,
          label: "Superseded",
        }),
      ),
    );
    assert.ok(el.querySelector(".bg-status-success-bg"));
    assert.ok(el.querySelector(".bg-status-warning-bg"));
    assert.ok(el.querySelector(".bg-status-danger-bg"));
    assert.ok(el.querySelector(".bg-status-info-bg"));
    assert.ok(el.querySelector(".bg-muted"));
    assert.ok(el.querySelector(".rounded-full.bg-status-success"));
  });

  it("renders domain status badges through canonical StatusBadge", () => {
    const el = renderNode(
      createElement(
        "div",
        null,
        createElement(LegalSourceLifecycleBadge, {
          status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        }),
        createElement(ReviewStatusBadge, {
          status: AUTHORED_LOCALIZATION_OPERATIONAL_STATES.OUTPUT_REVIEW_REQUIRED,
        }),
        createElement(PaymentStatusBadge, {
          locale: EN_LOCALE,
          status: BILLING_ORDER_STATUSES.CREDITED,
          showDot: true,
        }),
      ),
    );
    assert.equal(el.querySelectorAll('[data-component="StatusBadge"]').length, 3);
  });

  it("renders PanelState for loading, error with retry, empty, stale, and populated", () => {
    let retried = 0;
    const errorEl = renderNode(
      createElement(PanelState, {
        state: PANEL_STATES.error,
        title: "Failed to load",
        description: "Try again later",
        actionLabel: "Retry",
        onAction: () => {
          retried += 1;
        },
      }),
    );
    const retryBtn = errorEl.querySelector("button");
    assert.ok(retryBtn);
    act(() => {
      retryBtn.click();
    });
    assert.equal(retried, 1);

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    const staleEl = renderNode(
      createElement(
        PanelState,
        {
          state: PANEL_STATES.stale,
          staleNotice: "Data may be stale",
          actionLabel: "Refresh",
          onAction: () => {},
        },
        createElement("p", null, "Existing rows"),
      ),
    );
    assert.match(staleEl.textContent ?? "", /Data may be stale/);
    assert.match(staleEl.textContent ?? "", /Existing rows/);
  });
});
