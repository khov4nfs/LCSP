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
  "HTMLFormElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "window" ? testWindow : testWindow[name],
  });
}
for (const name of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: testWindow[name].bind(testWindow),
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
Object.defineProperty(testWindow, "matchMedia", {
  configurable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
});

const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { apiQueryKeys } = await import("../src/lib/api/query-keys.ts");
const { PrivacySettingsPanel } =
  await import(
    "../src/features/settings/components/organisms/privacy-settings-panel.tsx"
  );

test("PrivacySettingsPanel renders 5 rows with improve_models policy-enforced", async () => {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  const root = createRoot(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });

  queryClient.setQueryData(apiQueryKeys.auth.privacySettings(), {
    retain_repository_telemetry: false,
    enable_audit_export_api: true,
    restricted_assessment_sharing: false,
    purge_agent_memory_on_completion: true,
    improve_models: {
      enabled: false,
      enforced: true,
    },
    updated_at: "2026-11-24T12:00:00.000Z",
  });

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(PrivacySettingsPanel, { locale: "en" }),
      ),
    );
  });

  const panel = container.querySelector(
    '[data-component="PrivacySettingsPanel"]',
  );
  assert.ok(panel, "PrivacySettingsPanel rendered in DOM");

  // Check that policy badge is present
  const textContent = container.textContent ?? "";
  assert.ok(
    textContent.includes("Enforced by Policy"),
    "Contains Enforced by Policy badge text",
  );
  assert.ok(
    textContent.includes("Improve models with workspace data"),
    "Contains improve models title",
  );
  assert.ok(
    textContent.includes("Repository metadata"),
    "Contains repository metadata title",
  );
  assert.ok(
    textContent.includes("Export assessment data"),
    "Contains export data title",
  );
  assert.ok(
    textContent.includes("Restricted assessment sharing"),
    "Contains restricted assessment sharing title",
  );
  assert.ok(
    textContent.includes("Purge agent memory on completion"),
    "Contains memory preferences title",
  );

  // Check switches
  const switches = container.querySelectorAll('[data-slot="switch"]');
  assert.equal(switches.length, 5, "Has 5 switches for the 5 capability areas");

  // First switch is improve_models: must be disabled
  const improveModelsSwitch = switches[0];
  assert.ok(
    improveModelsSwitch.getAttribute("data-disabled") !== null ||
      improveModelsSwitch.hasAttribute("disabled") ||
      improveModelsSwitch.className.includes("data-disabled"),
    "First switch (improve_models) is disabled",
  );

  await act(async () => {
    root.unmount();
  });
  queryClient.clear();
  container.remove();
});

test("PrivacySettingsPanel renders Vietnamese localized copy", async () => {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  const root = createRoot(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });

  queryClient.setQueryData(apiQueryKeys.auth.privacySettings(), {
    retain_repository_telemetry: false,
    enable_audit_export_api: true,
    restricted_assessment_sharing: false,
    purge_agent_memory_on_completion: true,
    improve_models: {
      enabled: false,
      enforced: true,
    },
    updated_at: "2026-11-24T12:00:00.000Z",
  });

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(PrivacySettingsPanel, { locale: "vi" }),
      ),
    );
  });

  const textContent = container.textContent ?? "";
  assert.ok(
    textContent.includes("Chính sách bắt buộc"),
    "Contains Vietnamese badge text for policy enforcement",
  );
  assert.ok(
    textContent.includes("Cải thiện model bằng dữ liệu workspace"),
    "Contains Vietnamese improve models title",
  );
  assert.ok(
    textContent.includes("Metadata repository"),
    "Contains Vietnamese repository metadata title",
  );
  assert.ok(
    textContent.includes("Xuất dữ liệu assessment"),
    "Contains Vietnamese export data title",
  );
  assert.ok(
    textContent.includes("Giới hạn chia sẻ assessment"),
    "Contains Vietnamese restricted assessment sharing title",
  );
  assert.ok(
    textContent.includes("Xóa bộ nhớ agent khi hoàn tất"),
    "Contains Vietnamese memory preferences title",
  );

  await act(async () => {
    root.unmount();
  });
  queryClient.clear();
  container.remove();
});
