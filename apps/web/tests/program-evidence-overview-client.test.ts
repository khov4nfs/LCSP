import assert from "node:assert/strict";
import test from "node:test";

import { getProgramEvidenceGraphOverview } from "../src/lib/api/evidence-graph-overview-client";

test("overview client accepts the unwrapped BFF metric payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: {
          modules_analyzed: 1539,
          code_symbols_indexed: 7113,
          ai_model_invocations: 2,
          evidence_mapped_scope: 99,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    assert.deepEqual(
      await getProgramEvidenceGraphOverview("assessment-1"),
      {
        modules_analyzed: 1539,
        code_symbols_indexed: 7113,
        ai_model_invocations: 2,
        evidence_mapped_scope: 99,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
