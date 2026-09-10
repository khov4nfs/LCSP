export async function proxyEventStream(
  url: string | URL,
  headers: HeadersInit,
  signal: AbortSignal,
): Promise<Response> {
  const upstream = new AbortController();
  const abort = () => upstream.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const cleanup = () => {
    signal.removeEventListener("abort", abort);
    upstream.abort();
  };
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: upstream.signal,
    });
  } catch {
    cleanup();
    return new Response(null, { status: 503 });
  }
  if (!response.ok || !response.body) {
    cleanup();
    return new Response(null, { status: response.ok ? 503 : response.status });
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (!result.done) {
          controller.enqueue(result.value);
          return;
        }
      } catch {
        // End the SSE connection cleanly so EventSource can reconnect.
      }
      cleanup();
      try {
        controller.close();
      } catch {
        // Downstream may already have cancelled while read was pending.
      }
    },
    async cancel() {
      cleanup();
      await reader.cancel().catch(() => undefined);
    },
  });
  return new Response(body, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
}
