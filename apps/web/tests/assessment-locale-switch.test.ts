import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act, createElement } from "react";
import { setAppLocale } from "../src/lib/locale.ts";

const dom = new JSDOM(
  '<!doctype html><html lang="vi"><body><div id="root"></div></body></html>',
  {
    url: "http://localhost/workspace",
    pretendToBeVisual: true,
  },
);
const testWindow = dom.window;
Object.defineProperty(globalThis, "React", {
  configurable: true,
  value: React,
});
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
type IdleCb = (deadline: {
  didTimeout: boolean;
  timeRemaining: () => number;
}) => void;
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
    matches: true,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
});

class MockEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
Object.defineProperty(globalThis, "EventSource", {
  configurable: true,
  value: MockEventSource,
});
Object.defineProperty(testWindow, "EventSource", {
  configurable: true,
  value: MockEventSource,
});

const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { AppShell } =
  await import("../src/features/workspace/components/organisms/app-shell.tsx");
const { AssessmentTranscript } =
  await import(
    "../src/features/workspace/components/organisms/assessment-transcript.tsx"
  );
const { ThinkingLine } =
  await import(
    "../src/features/workspace/components/molecules/agent-turn.tsx"
  );

test("AssessmentAppShell, navigation, and workspace presentation tree update live on locale switch without reload", async () => {
  setAppLocale("vi");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          AppShell,
          null,
          createElement(
            AssessmentTranscript,
            null,
            createElement(ThinkingLine, null),
          ),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 20));
  });

  // 1. Initial VI assertions
  assert.match(container.innerHTML, /Tổng quan/);
  assert.match(container.innerHTML, /Gần đây/);
  assert.match(container.innerHTML, /Đang suy nghĩ\.\.\./);
  assert.match(container.innerHTML, /data-locale="vi"/);
  assert.equal(document.documentElement.lang, "vi");

  // 2. Switch live to EN without reload
  await act(async () => {
    setAppLocale("en");
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.match(container.innerHTML, /Overview/);
  assert.match(container.innerHTML, /Recents/);
  assert.match(container.innerHTML, /Thinking\.\.\./);
  assert.match(container.innerHTML, /data-locale="en"/);
  assert.equal(document.documentElement.lang, "en");

  // 3. Switch live back to VI without reload
  await act(async () => {
    setAppLocale("vi");
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.match(container.innerHTML, /Tổng quan/);
  assert.match(container.innerHTML, /Gần đây/);
  assert.match(container.innerHTML, /Đang suy nghĩ\.\.\./);
  assert.match(container.innerHTML, /data-locale="vi"/);
  assert.equal(document.documentElement.lang, "vi");

  await act(async () => {
    root.unmount();
  });
});
