import { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { Root } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const [key, value] of Object.entries({
  window: dom.window,
  self: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLDetailsElement: dom.window.HTMLDetailsElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  Event: dom.window.Event,
  MessageEvent: dom.window.MessageEvent,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  React,
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const { createRoot } = await import("react-dom/client");
const roots: Root[] = [];

after(() => {
  dom.window.close();
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

export function render(node: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(node);
  });
  return container;
}

/** Lets pending promises (queries, form validation) and their re-renders settle. */
export async function settle(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

export function click(element: Element | null) {
  assert(element, "element to click was not found");
  act(() => {
    element.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

export function buttons(container: ParentNode) {
  return [...container.querySelectorAll("button")];
}

export function byText<T extends Element>(
  container: ParentNode,
  selector: string,
  text: string | RegExp,
): T | null {
  return (
    ([...container.querySelectorAll(selector)] as T[]).find((element) =>
      typeof text === "string"
        ? element.textContent?.trim() === text
        : text.test(element.textContent ?? ""),
    ) ?? null
  );
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export type FetchCall = { url: string; method: string; body: string | null };

/** Stubs `fetch` with envelope responses keyed by "METHOD /path" (query string ignored). */
export function installFetch(routes: Record<string, unknown>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const key = `${method} ${url.split("?")[0]}`;
    if (!(key in routes))
      return Response.json(
        { ok: false, problem: { code: "NOT_STUBBED", status: 404 } },
        { status: 404 },
      );
    const response = routes[key];
    return response instanceof Response
      ? response.clone()
      : Response.json({ ok: true, data: response });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ) {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ) {
    if (listener) this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.(new dom.window.Event("open"));
  }

  emit(type: string, payload: unknown) {
    const event = new dom.window.MessageEvent(type, {
      data: JSON.stringify(payload),
    });
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
}

export function installFakeEventSource() {
  const original = globalThis.EventSource;
  FakeEventSource.instances = [];
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeEventSource as unknown as typeof EventSource,
  });
  return {
    instances: FakeEventSource.instances,
    restore: () => {
      if (original === undefined)
        delete (globalThis as { EventSource?: unknown }).EventSource;
      else
        Object.defineProperty(globalThis, "EventSource", {
          configurable: true,
          value: original,
        });
      FakeEventSource.instances = [];
    },
  };
}
