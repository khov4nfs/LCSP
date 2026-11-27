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

const { QuickActionRow } =
  await import("../src/components/molecules/quick-action-row.tsx");
const { QuickActionsDialog } =
  await import("../src/features/workspace/components/molecules/quick-actions-dialog.tsx");
const { AdminQuickActionsDialog } =
  await import("../src/features/admin/components/molecules/admin-quick-actions-dialog.tsx");

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

describe("Shared Navigation & Quick Actions UI (Cross-module)", () => {
  it("renders QuickActionRow as Link when href is supplied and button when omitted", () => {
    const linkEl = renderNode(
      createElement(QuickActionRow, {
        href: "/assessments/new",
        label: "New assessment",
        description: "Connect a repository",
      }),
    );
    const anchor = linkEl.querySelector("a");
    assert.ok(anchor);
    assert.equal(anchor.getAttribute("href"), "/assessments/new");

    act(() => {
      activeRoot!.unmount();
    });
    activeRoot = null;
    activeContainer?.remove();

    let clicked = 0;
    const btnEl = renderNode(
      createElement(QuickActionRow, {
        label: "Settings",
        description: "Manage preferences",
        onClick: () => {
          clicked += 1;
        },
      }),
    );
    const btn = btnEl.querySelector("button");
    assert.ok(btn);
    act(() => {
      btn.click();
    });
    assert.equal(clicked, 1);
  });

  it("renders customer QuickActionsDialog with QuickActionRow destinations and Settings trigger", () => {
    let settingsOpened = 0;
    let closed = 0;
    renderNode(
      createElement(QuickActionsDialog, {
        open: true,
        onOpenChange: (next) => {
          if (!next) closed += 1;
        },
        onOpenSettings: () => {
          settingsOpened += 1;
        },
      }),
    );
    const rows = document.body.querySelectorAll('[data-component="QuickActionRow"]');
    assert.equal(rows.length, 6);
    const settingsBtn = document.body.querySelector(
      'button[data-component="QuickActionRow"]',
    ) as HTMLButtonElement | null;
    assert.ok(settingsBtn);
    act(() => {
      settingsBtn.click();
    });
    assert.equal(closed, 1);
    assert.equal(settingsOpened, 1);
  });

  it("renders AdminQuickActionsDialog and opens 7 admin QuickActionRow links", () => {
    const el = renderNode(createElement(AdminQuickActionsDialog));
    const trigger = el.querySelector("button");
    assert.ok(trigger);
    act(() => {
      trigger.click();
    });
    const rows = document.body.querySelectorAll('[data-component="QuickActionRow"]');
    assert.equal(rows.length, 7);
  });
});
