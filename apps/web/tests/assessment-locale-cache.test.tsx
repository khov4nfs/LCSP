import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, settle } from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import {
  useAssessmentReportQuery,
  useAssessmentDetailQuery,
} from "../src/lib/api/assessment-domain-queries.ts";
import { assessmentDetailSchema } from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";

test("mounted detail query partitions accepted decision narratives across EN/VI/EN", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/localized-assessment-detail.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const en = assessmentDetailSchema.parse(wire.en);
  const vi = assessmentDetailSchema.parse(wire.vi);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    Response.json({
      ok: true,
      data: new Headers(init?.headers).get("x-lcsp-locale") === "vi" ? vi : en,
    });
  function Consumer() {
    const result = useAssessmentDetailQuery(en.assessment_id);
    return (
      <output>
        {result.data ? JSON.stringify(result.data.case?.decisions) : "loading"}
      </output>
    );
  }
  try {
    setAppLocale("en");
    const mounted = render(
      <QueryClientProvider client={client}>
        <Consumer />
      </QueryClientProvider>,
    );
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(en.case?.decisions));
    act(() => setAppLocale("vi"));
    assert.equal(mounted.textContent, "loading");
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(vi.case?.decisions));
    act(() => setAppLocale("en"));
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(en.case?.decisions));
    assert.equal(
      en.case?.decisions[0].decisionId,
      vi.case?.decisions[0].decisionId,
    );
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test("mounted report query switches EN/VI/EN and rejects late narratives", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/localized-assessment-wire.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const en = assessmentFinalReportArtifactVersionedSchema.parse(
    wire.reports["ASSESSMENT_FINAL_REPORT_V2:en"],
  );
  const vi = assessmentFinalReportArtifactVersionedSchema.parse(
    wire.reports["ASSESSMENT_FINAL_REPORT_V2:vi"],
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  const pending: Array<{
    locale: string;
    resolve: (response: Response) => void;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const locale = new Headers(init?.headers).get("x-lcsp-locale")!;
    assert.match(document.cookie, new RegExp(`lcsp_locale=${locale}`));
    return new Promise<Response>((resolve) =>
      pending.push({ locale, resolve }),
    );
  };
  function Consumer() {
    const result = useAssessmentReportQuery(en.assessmentId, en.artifactId);
    return (
      <output>
        {result.data
          ? JSON.stringify(result.data)
          : result.isError
            ? "unavailable"
            : "loading"}
      </output>
    );
  }
  try {
    setAppLocale("en");
    const mounted = render(
      <QueryClientProvider client={client}>
        <Consumer />
      </QueryClientProvider>,
    );
    await settle();
    pending.shift()!.resolve(Response.json({ ok: true, data: en }));
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(en));
    act(() => setAppLocale("vi"));
    await settle();
    assert.equal(mounted.textContent, "loading");
    const slowVi = pending.shift()!;
    assert.equal(slowVi.locale, "vi");
    act(() => setAppLocale("en"));
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(en));
    slowVi.resolve(Response.json({ ok: true, data: vi }));
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(en));
    act(() => setAppLocale("vi"));
    await settle();
    assert.equal(mounted.textContent, "loading");
    pending.shift()!.resolve(Response.json({ ok: true, data: vi }));
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(vi));
    assert.equal(en.assessmentId, vi.assessmentId);
    assert.equal(en.decisionFingerprint, vi.decisionFingerprint);
    assert.deepEqual(en.pins, vi.pins);
    act(() => setAppLocale("en"));
    await settle();
    assert.equal(mounted.textContent, JSON.stringify(en));
  } finally {
    globalThis.fetch = originalFetch;
    for (const request of pending)
      request.resolve(Response.json({ ok: false }, { status: 503 }));
    client.clear();
  }
});
