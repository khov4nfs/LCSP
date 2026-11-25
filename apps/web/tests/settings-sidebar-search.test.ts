import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const testWindow = dom.window;
for (const name of [
  "window",
  "document",
  "navigator",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Node",
  "Event",
  "KeyboardEvent",
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? testWindow : testWindow[name],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const { createRoot } = await import("react-dom/client");
const { SettingsSidebar } =
  await import(
    "../src/features/settings/components/organisms/settings-sidebar.tsx"
  );
const { SETTINGS_SECTION_IDS } =
  await import("../src/features/settings/types/settings.types.ts");
const { setAppLocale } = await import("../src/lib/locale.ts");
const { LOCALES } = await import("@lcsp/contracts/shared");

test("SettingsSidebar filters tabs by localized label and keywords and supports clearing", async () => {
  setAppLocale(LOCALES[0]);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(SettingsSidebar, {
        activeSection: SETTINGS_SECTION_IDS.general,
        onSectionChange: () => {},
      }),
    );
  });

  const input = container.querySelector(
    'input[aria-label="Search settings"]',
  ) as HTMLInputElement | null;
  assert.ok(input, "Expected enabled search input");
  assert.equal(input.disabled, false);

  const initialButtons = container.querySelectorAll("nav button");
  assert.equal(initialButtons.length, 7);

  // Filter by keyword ("pat" matches Connectors)
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    testWindow.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    nativeInputValueSetter?.call(input, "pat");
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
  });

  const filteredButtons = container.querySelectorAll("nav button");
  assert.equal(filteredButtons.length, 1);
  assert.ok(filteredButtons[0]?.textContent?.includes("Connectors"));

  // Non-matching query renders empty state
  await act(async () => {
    nativeInputValueSetter?.call(input, "nonexistent-xyz");
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
  });
  assert.equal(container.querySelectorAll("nav button").length, 0);
  assert.ok(container.textContent?.includes("No matching settings"));

  // Clear button restores all tabs
  const clearBtn = container.querySelector(
    'button[aria-label="Clear search"]',
  ) as HTMLButtonElement | null;
  assert.ok(clearBtn, "Expected clear search button");
  await act(async () => {
    clearBtn.click();
  });
  assert.equal(container.querySelectorAll("nav button").length, 7);

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
