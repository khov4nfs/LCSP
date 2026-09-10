import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { proxyEventStream } from "../src/lib/server/proxy-event-stream";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("upstream read failures end the stream without rejecting downstream", async () => {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          input = controller;
        },
      }),
    );
  const response = await proxyEventStream(
    "http://localhost/events",
    {},
    new AbortController().signal,
  );
  const reader = response.body!.getReader();
  input.enqueue(new TextEncoder().encode("data: ready\n\n"));
  assert.equal((await reader.read()).done, false);
  input.error(new Error("API restarted"));
  assert.equal((await reader.read()).done, true);
});

test("downstream cancellation aborts upstream and cancels its reader", async () => {
  let signal!: AbortSignal;
  let cancelled = false;
  globalThis.fetch = async (_url, init) => {
    signal = init!.signal!;
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    );
  };
  const response = await proxyEventStream(
    "http://localhost/events",
    {},
    new AbortController().signal,
  );
  await response.body!.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("request abort propagates upstream and unavailable API returns 503", async () => {
  const request = new AbortController();
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  const pending = proxyEventStream(
    "http://localhost/events",
    {},
    request.signal,
  );
  request.abort();
  assert.equal((await pending).status, 503);
});

test("upstream authentication failures preserve their HTTP status", async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 });
  assert.equal(
    (
      await proxyEventStream(
        "http://localhost/events",
        {},
        new AbortController().signal,
      )
    ).status,
    401,
  );
});
