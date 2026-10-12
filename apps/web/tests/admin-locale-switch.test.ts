import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import {
  APP_LOCALE_COOKIE,
  getAppLocaleSnapshot,
  setAppLocale,
} from "../src/lib/locale.ts";

const dom = new JSDOM("<!doctype html><html lang=\"vi\"><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/admin/overview",
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
Object.defineProperty(globalThis, "self", {
  configurable: true,
  value: testWindow,
});
for (const name of ["requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: testWindow[name].bind(testWindow),
  });
}
type IdleCb = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
const idlePolyfill = (cb: IdleCb) =>
  setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 1);
const cancelIdlePolyfill = (id: number) => clearTimeout(id);
Object.defineProperty(globalThis, "requestIdleCallback", {
  configurable: true,
  value: idlePolyfill,
});
Object.defineProperty(globalThis, "cancelIdleCallback", {
  configurable: true,
  value: cancelIdlePolyfill,
});
Object.defineProperty(testWindow, "requestIdleCallback", {
  configurable: true,
  value: idlePolyfill,
});
Object.defineProperty(testWindow, "cancelIdleCallback", {
  configurable: true,
  value: cancelIdlePolyfill,
});

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
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);
const { AdminShell } = await import(
  "../src/features/admin/components/templates/admin-shell.tsx"
);
const { AdminOverviewPage } = await import(
  "../src/features/admin/components/organisms/admin-overview-page.tsx"
);

test("setAppLocale synchronizes cookie, appLocale, and document.documentElement.lang", () => {
  setAppLocale("en");
  assert.equal(getAppLocaleSnapshot(), "en");
  assert.equal(document.documentElement.lang, "en");
  assert.match(document.cookie, new RegExp(`${APP_LOCALE_COOKIE}=en`));

  setAppLocale("vi");
  assert.equal(getAppLocaleSnapshot(), "vi");
  assert.equal(document.documentElement.lang, "vi");
  assert.match(document.cookie, new RegExp(`${APP_LOCALE_COOKIE}=vi`));
});

test("AdminShell and page body update simultaneously when setAppLocale is triggered", async () => {
  setAppLocale("vi");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          AdminShell,
          { adminName: "Admin User", adminEmail: "admin@example.com" },
          createElement(AdminOverviewPage),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
  });

  // Verify Vietnamese labels in both sidebar and page content
  assert.match(container.innerHTML, /Tài khoản người dùng/);
  assert.match(
    container.innerHTML,
    /Số liệu thống kê cấp hệ thống về người dùng/,
  );
  assert.match(container.innerHTML, /30 ngày qua/);

  // Switch to English live
  await act(async () => {
    setAppLocale("en");
    await new Promise((r) => setTimeout(r, 10));
  });

  // Verify English labels in both sidebar and page content
  assert.match(container.innerHTML, /User accounts/);
  assert.match(
    container.innerHTML,
    /System-level statistics across users/,
  );
  assert.match(container.innerHTML, /Last 30 days/);
  assert.equal(document.documentElement.lang, "en");

  // Switch back to Vietnamese live
  await act(async () => {
    setAppLocale("vi");
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.match(container.innerHTML, /Tài khoản người dùng/);
  assert.match(
    container.innerHTML,
    /Số liệu thống kê cấp hệ thống về người dùng/,
  );
  assert.match(container.innerHTML, /30 ngày qua/);
  assert.equal(document.documentElement.lang, "vi");

  await act(async () => {
    root.unmount();
  });
});

