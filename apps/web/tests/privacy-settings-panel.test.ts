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
        // Keep this seeded response authoritative; the stale-query error paths are covered separately below.
        staleTime: Infinity,
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
  for (const preferenceSwitch of [...switches].slice(1)) {
    assert.equal(
      preferenceSwitch.hasAttribute("disabled") ||
        preferenceSwitch.getAttribute("aria-disabled") === "true",
      false,
      "Server-supported privacy preferences remain editable when the query is current",
    );
  }

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
    textContent.includes("Siêu dữ liệu kho mã nguồn"),
    "Contains translated Vietnamese repository metadata title",
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

test("PrivacySettingsPanel marks cached settings stale and disables edits after a failed refresh", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
    },
  });
  queryClient.setQueryData(apiQueryKeys.auth.privacySettings(), {
    retain_repository_telemetry: false,
    enable_audit_export_api: true,
    restricted_assessment_sharing: false,
    purge_agent_memory_on_completion: true,
    improve_models: { enabled: false, enforced: true },
    updated_at: "2026-11-24T12:00:00.000Z",
  });
  // The cached query state starts in refetch-error status while retaining its last confirmed value.
  queryClient
    .getQueryCache()
    .find({ queryKey: apiQueryKeys.auth.privacySettings() })
    ?.setState({
      status: "error",
      error: new Error("synthetic refresh failure"),
      fetchStatus: "idle",
    });
  const container = testWindow.document.createElement("div");
  testWindow.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(PrivacySettingsPanel, { locale: "en" }),
        ),
      );
    });
    // A failed refresh must distinguish cached values from current server state and prevent writes until refresh succeeds.
    const staleStatus = container.querySelector('[data-settings-stale="true"]');
    assert.ok(staleStatus?.textContent?.includes("last confirmed"));
    for (const label of [
      "Repository metadata",
      "Export assessment data",
      "Restricted assessment sharing",
      "Purge agent memory on completion",
    ]) {
      const control = container.querySelector(
        `[role="switch"][aria-label="${label}"]`,
      ) as HTMLElement | null;
      assert.ok(control);
      assert.equal(
        control.getAttribute("aria-disabled") === "true" ||
          (control as HTMLButtonElement).disabled,
        true,
      );
    }
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});

test("PrivacySettingsPanel distinguishes an initial load failure from stale cached values", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { ok: false, problem: { status: 500, code: "INTERNAL_ERROR" } },
      { status: 500 },
    );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(PrivacySettingsPanel, { locale: "en" }),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    // A failed first read has no confirmed value, so it must not render any default switch state.
    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert?.textContent?.includes("Unable to load privacy settings."));
    assert.ok(alert?.textContent?.includes("Retry"));
    assert.equal(container.querySelector('[data-settings-stale="true"]'), null);
    assert.equal(container.querySelectorAll('[data-slot="switch"]').length, 0);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    globalThis.fetch = originalFetch;
  }
});
