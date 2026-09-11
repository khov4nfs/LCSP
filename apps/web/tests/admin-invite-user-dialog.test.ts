import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import {
  ADMIN_ACCOUNT_ERRORS,
  AUTH_USER_ROLES,
  type AdminUserDetail,
} from "@lcsp/contracts/auth";

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

// Browser-dependent libraries must initialize after the DOM is installed.
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { AdminInviteUserDialog } =
  await import("../src/features/admin/components/organisms/admin-invite-user-dialog.tsx");

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
}

async function changeInput(id: string, value: string) {
  const input = testWindow.document.getElementById(id);
  assert.ok(input instanceof testWindow.HTMLInputElement);
  const setter = Object.getOwnPropertyDescriptor(
    testWindow.HTMLInputElement.prototype,
    "value",
  )?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
    input.dispatchEvent(new testWindow.Event("change", { bubbles: true }));
    await settle();
  });
}

async function submit() {
  const form = testWindow.document.querySelector("form");
  assert.ok(form);
  await act(async () => {
    form.dispatchEvent(
      new testWindow.Event("submit", { bubbles: true, cancelable: true }),
    );
    await settle();
  });
}

test("invitation submit is event-owned and preserves idempotency across failed retries", async (context) => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../src/public/assets/mocks/lcsp299-account-lifecycle.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AdminUserDetail;
  const calls: Array<{ url: string; body: unknown; key: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      key: new Headers(init?.headers).get("idempotency-key"),
    });
    return Response.json(
      {
        ok: false,
        problem: { code: ADMIN_ACCOUNT_ERRORS.invitationDeliveryFailed },
      },
      { status: 503 },
    );
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false, gcTime: Infinity },
      queries: { retry: false, gcTime: Infinity },
    },
  });
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  const root = createRoot(container);
  context.after(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    globalThis.fetch = originalFetch;
    testWindow.close();
  });
  const render = () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AdminInviteUserDialog, { open: true, onClose() {} }),
        ),
      ),
    );
  await act(async () => {
    render();
    await settle();
  });
  assert.equal(calls.length, 0, "rendering must never send an invitation");
  await submit();
  assert.equal(calls.length, 0, "invalid form must not create an invitation");

  await changeInput("invite-name", fixture.fullName);
  await changeInput("invite-email", fixture.email);
  await submit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/users");
  assert.ok(calls[0].key);
  assert.deepEqual(calls[0].body, {
    displayName: fixture.fullName,
    email: fixture.email,
    role: AUTH_USER_ROLES.customer,
  });

  await act(async () => {
    render();
    await settle();
  });
  assert.equal(calls.length, 1, "rerender must not retry the failed mutation");
  await submit();
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].key,
    calls[0].key,
    "unchanged input reuses its retry key",
  );

  await changeInput("invite-name", `${fixture.fullName} updated`);
  await submit();
  assert.equal(calls.length, 3);
  assert.notEqual(
    calls[2].key,
    calls[0].key,
    "changed input starts a distinct command",
  );
});
