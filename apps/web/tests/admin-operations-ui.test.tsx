import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

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

const { AdminEventsTableRow, AdminStatusBadge } =
  await import("../src/features/admin/components/molecules/admin-overview-primitives.tsx");
const { OperationsEventDetailDialog } =
  await import("../src/features/tracking/components/organisms/operations-event-detail-dialog.tsx");

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

describe("Admin Operations UI components (Frames 55, 85)", () => {
  it("renders AdminStatusBadge with semantic status tokens for all variants", () => {
    const el = renderNode(
      createElement(
        "div",
        null,
        createElement(AdminStatusBadge, { label: "Published", variant: "success" }),
        createElement(AdminStatusBadge, { label: "Pending", variant: "warning" }),
        createElement(AdminStatusBadge, { label: "Failed", variant: "danger" }),
        createElement(AdminStatusBadge, { label: "Running", variant: "info" }),
      ),
    );
    assert.ok(el.querySelector(".bg-status-success-bg"));
    assert.ok(el.querySelector(".bg-status-warning-bg"));
    assert.ok(el.querySelector(".bg-status-danger-bg"));
    assert.ok(el.querySelector(".bg-status-info-bg"));
  });

  it("renders AdminEventsTableRow (1682:1255) and invokes onNextAction", () => {
    let clicked = 0;
    const el = renderNode(
      createElement(AdminEventsTableRow, {
        event: "Repository scan",
        area: "Assessment",
        statusBadge: createElement(AdminStatusBadge, {
          label: "Failed",
          variant: "danger",
        }),
        updated: "Today, 14:30",
        nextActionLabel: "Review error",
        onNextAction: () => {
          clicked += 1;
        },
      }),
    );
    assert.match(el.textContent ?? "", /Repository scan/);
    assert.match(el.textContent ?? "", /Assessment/);
    const btn = el.querySelector("button");
    assert.ok(btn);
    act(() => {
      btn.click();
    });
    assert.equal(clicked, 1);
  });

  it("renders OperationsEventDetailDialog (Frame 85) with event metadata", () => {
    const el = renderNode(
      createElement(OperationsEventDetailDialog, {
        event: {
          title: "Repository scan",
          area: "Assessment",
          statusLabel: "Failed",
          statusVariant: "danger",
          timestamp: "2026-11-24T14:30:00.000Z",
          actorOrTarget: "Data export service",
          summary: "Snapshot archive root status missing",
        },
        closeLabel: "Close",
        labels: {
          area: "Area",
          status: "Status",
          timestamp: "Updated",
          target: "Target",
          summary: "Detail",
        },
        onClose: () => {},
      }),
    );
    const bodyText = document.body.textContent ?? "";
    assert.match(bodyText, /Repository scan/);
    assert.match(bodyText, /Data export service/);
    assert.match(bodyText, /Snapshot archive root status missing/);
    assert.ok(el);
  });
});
