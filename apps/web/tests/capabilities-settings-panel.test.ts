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
const { CapabilitiesSettingsPanel } =
  await import(
    "../src/features/settings/components/organisms/capabilities-settings-panel.tsx"
  );
const {
  CAPABILITY_POLICY_REASONS,
  DOMAIN_ALLOWLIST_MODES,
  TOOL_ACCESS_MODES,
} = await import("@lcsp/contracts/auth");
const { LOCALES } = await import("@lcsp/contracts/shared");

test("CapabilitiesSettingsPanel renders configurable controls and locked platform policies from backend state", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
    },
  });
  queryClient.setQueryData(apiQueryKeys.auth.capabilitySettings(), {
    tool_access_mode: TOOL_ACCESS_MODES.guided,
    connector_search: false,
    artifacts: true,
    cloud_code_execution: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.platformRestricted,
    },
    network_egress: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
    },
    domain_allowlist: {
      mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
      custom_domains_supported: false,
      allowed_domains: ["registry.npmjs.org", "pypi.org"],
    },
    updated_at: "2026-11-25T10:00:00.000Z",
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(CapabilitiesSettingsPanel, { locale: LOCALES[0] }),
      ),
    );
  });

  const text = container.textContent ?? "";
  assert.ok(text.includes("Guided"));
  assert.ok(text.includes("Configurable"));
  assert.ok(text.includes("System policy"));
  assert.ok(text.includes("Unsupported"));
  assert.ok(text.includes("Package managers only"));

  const cloudSwitch = container.querySelector(
    '[role="switch"][aria-label="Cloud code execution"]',
  ) as HTMLElement | null;
  assert.ok(cloudSwitch);
  assert.equal(
    cloudSwitch.getAttribute("aria-disabled") === "true" ||
      (cloudSwitch as HTMLButtonElement).disabled === true,
    true,
  );
  assert.equal(cloudSwitch.getAttribute("aria-checked"), "false");

  const networkSwitch = container.querySelector(
    '[role="switch"][aria-label="Allow network egress"]',
  ) as HTMLElement | null;
  assert.ok(networkSwitch);
  assert.equal(
    networkSwitch.getAttribute("aria-disabled") === "true" ||
      (networkSwitch as HTMLButtonElement).disabled === true,
    true,
  );
  assert.equal(networkSwitch.getAttribute("aria-checked"), "false");

  for (const label of ["Connector search", "Artifacts"]) {
    const preferenceSwitch = container.querySelector(
      `[role="switch"][aria-label="${label}"]`,
    ) as HTMLElement | null;
    assert.ok(preferenceSwitch);
    assert.equal(
      preferenceSwitch.getAttribute("aria-disabled") === "true" ||
        preferenceSwitch.hasAttribute("disabled"),
      false,
    );
  }

  await act(async () => {
    root.unmount();
  });
  queryClient.clear();
  container.remove();
});

test("CapabilitiesSettingsPanel displays contract domains without unsupported editing controls", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
    },
  });
  queryClient.setQueryData(apiQueryKeys.auth.capabilitySettings(), {
    tool_access_mode: TOOL_ACCESS_MODES.guided,
    connector_search: false,
    artifacts: true,
    cloud_code_execution: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.platformRestricted,
    },
    network_egress: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
    },
    domain_allowlist: {
      mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
      custom_domains_supported: false,
      allowed_domains: ["registry.npmjs.org", "pypi.org"],
    },
    updated_at: "2026-11-25T10:00:00.000Z",
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
          createElement(CapabilitiesSettingsPanel, { locale: LOCALES[0] }),
        ),
      );
    });

    // The contract only exposes a fixed allowlist, so show its returned values instead of disabled add-domain controls.
    const allowedDomains = container.querySelector(
      '[data-component="AllowedPackageManagerDomains"]',
    );
    assert.ok(allowedDomains?.textContent?.includes("registry.npmjs.org"));
    assert.ok(allowedDomains?.textContent?.includes("pypi.org"));
    assert.equal(container.querySelector("#settings-domain-input"), null);
    assert.equal(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Add",
      ),
      false,
    );
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});

test("CapabilitiesSettingsPanel renders error alert with retry when query fails", async () => {
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
          createElement(CapabilitiesSettingsPanel, { locale: LOCALES[0] }),
        ),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert, "Expected error alert to be rendered");
    assert.ok(alert.textContent?.includes("Retry"));
  } finally {
    await act(async () => {
      root.unmount();
    });
    queryClient.clear();
    container.remove();
    globalThis.fetch = originalFetch;
  }
});

test("CapabilitiesSettingsPanel marks cached settings stale and disables edits after a failed refresh", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
    },
  });
  queryClient.setQueryData(apiQueryKeys.auth.capabilitySettings(), {
    tool_access_mode: TOOL_ACCESS_MODES.guided,
    connector_search: false,
    artifacts: true,
    cloud_code_execution: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.platformRestricted,
    },
    network_egress: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
    },
    domain_allowlist: {
      mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
      custom_domains_supported: false,
      allowed_domains: ["registry.npmjs.org", "pypi.org"],
    },
    updated_at: "2026-11-25T10:00:00.000Z",
  });
  // The cached query state starts in refetch-error status while retaining its last confirmed value.
  queryClient
    .getQueryCache()
    .find({ queryKey: apiQueryKeys.auth.capabilitySettings() })
    ?.setState({
      status: "error",
      error: new Error("synthetic refresh failure"),
      fetchStatus: "idle",
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
          createElement(CapabilitiesSettingsPanel, { locale: LOCALES[0] }),
        ),
      );
    });
    // A failed refresh must not present cached capability values as current or allow writes against them.
    const staleStatus = container.querySelector('[data-settings-stale="true"]');
    assert.ok(staleStatus?.textContent?.includes("last confirmed"));
    for (const label of ["Connector search", "Artifacts"]) {
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

test("CapabilitiesSettingsPanel explains an empty authoritative allowlist without sample domains", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
  });
  queryClient.setQueryData(apiQueryKeys.auth.capabilitySettings(), {
    tool_access_mode: TOOL_ACCESS_MODES.guided,
    connector_search: false,
    artifacts: true,
    cloud_code_execution: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.platformRestricted,
    },
    network_egress: {
      enabled: false,
      enforced: true,
      policy: CAPABILITY_POLICY_REASONS.runtimePolicyRestricted,
    },
    domain_allowlist: {
      mode: DOMAIN_ALLOWLIST_MODES.packageManagersOnly,
      custom_domains_supported: false,
      allowed_domains: [],
    },
    updated_at: "2026-11-25T10:00:00.000Z",
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
          createElement(CapabilitiesSettingsPanel, { locale: LOCALES[0] }),
        ),
      );
    });

    // Empty policy data must stay empty rather than implying that example domains are authorized.
    const status = container.querySelector('[role="status"]');
    assert.ok(status?.textContent?.includes("No package-manager domains are currently reported by policy."));
    assert.equal(container.querySelector('[data-component="AllowedPackageManagerDomains"]'), null);
    assert.equal(container.textContent?.includes("registry.npmjs.org"), false);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});
