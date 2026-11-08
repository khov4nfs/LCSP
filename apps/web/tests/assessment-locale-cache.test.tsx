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
  useHumanRequestsQuery,
} from "../src/lib/api/assessment-domain-queries.ts";
import { RuleAuditPicker } from "../src/features/assessment-runtime/components/organisms/rule-audit-picker.tsx";
import { AssessmentConversation } from "../src/features/assessment-runtime/components/organisms/assessment-conversation.tsx";
import { projectConversation } from "../src/features/assessment-runtime/utils/conversation-projection.ts";
import { copy } from "../src/features/assessment-runtime/utils/conversation-copy.ts";
import {
  assessmentDetailSchema,
  assessmentHumanRequestsResultSchema,
  ruleAuditCatalogSchema,
  AUTHORED_LOCALIZATION_CODES,
} from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";

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

test("mounted HITL human requests query switches EN/VI/EN, preserves request/choice/answer identities, and rejects delayed or incomplete responses", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/localized-assessment-detail.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const assessmentId = wire.en.assessment_id as string;
  const en = assessmentHumanRequestsResultSchema.parse(wire.humanRequests.en);
  const vi = assessmentHumanRequestsResultSchema.parse(wire.humanRequests.vi);
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
    return new Promise<Response>((resolve) =>
      pending.push({ locale, resolve }),
    );
  };
  function Consumer() {
    const result = useHumanRequestsQuery(assessmentId);
    if (result.isError) return <output>error</output>;
    if (!result.data) return <output>loading</output>;
    const projected = projectConversation({
      assessmentId,
      events: [],
      detail: assessmentDetailSchema.parse(wire.en),
      requests: result.data.requests,
      repository: null,
    });
    return (
      <div>
        <output data-slot="raw-requests">{JSON.stringify(result.data)}</output>
        <AssessmentConversation
          projection={projected}
          answerPending={false}
          answerFailed={false}
          onAnswer={() => undefined}
        />
      </div>
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
    assert.equal(
      mounted.querySelector('[data-slot="raw-requests"]')?.textContent,
      JSON.stringify(en),
    );
    assert.match(
      mounted.textContent ?? "",
      /EN: Which customer data retention period is configured\?/,
    );
    assert.ok(
      (mounted.textContent ?? "").includes(
        copy("question.whyAsking", undefined, "en"),
      ),
    );
    assert.match(
      mounted.textContent ?? "",
      /EN: Retention duration is not declared in repository config\./,
    );
    assert.match(
      mounted.textContent ?? "",
      /EN: Determines whether personal data retention satisfies Article 27\./,
    );
    assert.match(
      mounted.textContent ?? "",
      /EN: Checked config\/retention\.json and infra\/storage\.tf\./,
    );
    assert.match(mounted.textContent ?? "", /EN: 30 days/);

    // Switch EN -> VI, delay VI, switch back to EN before VI resolves
    act(() => setAppLocale("vi"));
    await settle();
    assert.equal(mounted.textContent, "loading");
    const delayedVi = pending.shift()!;
    assert.equal(delayedVi.locale, "vi");
    act(() => setAppLocale("en"));
    await settle();
    assert.equal(
      mounted.querySelector('[data-slot="raw-requests"]')?.textContent,
      JSON.stringify(en),
    );
    delayedVi.resolve(Response.json({ ok: true, data: vi }));
    await settle();
    assert.equal(
      mounted.querySelector('[data-slot="raw-requests"]')?.textContent,
      JSON.stringify(en),
    );

    // Switch EN -> VI and resolve VI
    act(() => setAppLocale("vi"));
    await settle();
    assert.equal(mounted.textContent, "loading");
    pending.shift()!.resolve(Response.json({ ok: true, data: vi }));
    await settle();
    assert.equal(
      mounted.querySelector('[data-slot="raw-requests"]')?.textContent,
      JSON.stringify(vi),
    );
    assert.match(
      mounted.textContent ?? "",
      /VI: Thời hạn lưu giữ dữ liệu khách hàng nào được cấu hình\?/,
    );
    assert.ok(
      (mounted.textContent ?? "").includes(
        copy("question.whyAsking", undefined, "vi"),
      ),
    );
    assert.match(
      mounted.textContent ?? "",
      /VI: Thời lượng lưu giữ chưa được khai báo trong cấu hình kho mã\./,
    );
    assert.match(
      mounted.textContent ?? "",
      /VI: Xác định việc lưu giữ dữ liệu cá nhân có đáp ứng Điều 27 hay không\./,
    );
    assert.match(
      mounted.textContent ?? "",
      /VI: Đã kiểm tra config\/retention\.json và infra\/storage\.tf\./,
    );
    assert.match(mounted.textContent ?? "", /VI: 30 ngày/);

    const reqEn = en.requests[0]!;
    const reqVi = vi.requests[0]!;
    assert.notEqual(reqEn.question, reqVi.question);
    assert.notEqual(reqEn.unresolvedFact, reqVi.unresolvedFact);
    assert.notDeepEqual(reqEn.decisionImpact, reqVi.decisionImpact);
    assert.notDeepEqual(reqEn.resolutionAttempts, reqVi.resolutionAttempts);
    assert.notEqual(reqEn.choices?.[0]?.label, reqVi.choices?.[0]?.label);
    assert.equal(reqEn.requestId, reqVi.requestId);
    assert.equal(reqEn.assessmentRuleId, reqVi.assessmentRuleId);
    assert.deepEqual(
      reqEn.choices?.map((c) => c.value),
      reqVi.choices?.map((c) => c.value),
    );
    assert.deepEqual(reqEn.answers, reqVi.answers);

    // Switch VI -> EN from cache
    act(() => setAppLocale("en"));
    await settle();
    assert.equal(
      mounted.querySelector('[data-slot="raw-requests"]')?.textContent,
      JSON.stringify(en),
    );

    // Verify PENDING and FAILED states do not expose stale language
    for (const state of ["PENDING", "FAILED"] as const) {
      client.removeQueries({
        queryKey: ["assessment", assessmentId, "human-requests", "vi"],
      });
      act(() => setAppLocale("vi"));
      await settle();
      assert.equal(mounted.textContent, "loading");
      pending.shift()!.resolve(
        Response.json(
          {
            ...problemEnvelope(AUTHORED_LOCALIZATION_CODES.INCOMPLETE, 409),
            problem: {
              ...problemEnvelope(AUTHORED_LOCALIZATION_CODES.INCOMPLETE, 409)
                .problem,
              meta: { locale: "vi", state },
            },
          },
          { status: 409 },
        ),
      );
      await settle();
      assert.equal(mounted.textContent, "error");
      act(() => setAppLocale("en"));
      await settle();
      assert.equal(
        mounted.querySelector('[data-slot="raw-requests"]')?.textContent,
        JSON.stringify(en),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const request of pending)
      request.resolve(Response.json({ ok: false }, { status: 503 }));
    client.clear();
  }
});

test("mounted grouped RuleAuditPicker paginates under pinned locale, aborts delayed EN page 2 on VI switch, and preserves selected rule identities", async () => {
  const wire = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/localized-assessment-wire.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const en0 = ruleAuditCatalogSchema.parse(wire.catalog["en:0"]);
  const en1 = ruleAuditCatalogSchema.parse(wire.catalog["en:1"]);
  const vi0 = ruleAuditCatalogSchema.parse({
    ...wire.catalog["vi:0"],
    assessmentId: en0.assessmentId,
    ruleSetVersionId: en0.ruleSetVersionId,
    repositorySnapshotId: en0.repositorySnapshotId,
  });
  const vi1 = ruleAuditCatalogSchema.parse({
    ...wire.catalog["vi:1"],
    assessmentId: en0.assessmentId,
    ruleSetVersionId: en0.ruleSetVersionId,
    repositorySnapshotId: en0.repositorySnapshotId,
  });
  const pages: Record<string, unknown> = {
    "en:0": en0,
    "en:1": en1,
    "vi:0": vi0,
    "vi:1": vi1,
  };
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  let delayedEnPage2: ((response: Response) => void) | null = null;
  let holdEnPage2 = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const locale = new Headers(init?.headers).get("x-lcsp-locale") ?? "en";
    if (locale === "en" && offset === 1 && holdEnPage2) {
      return new Promise<Response>((resolve) => {
        delayedEnPage2 = resolve;
      });
    }
    return Response.json({
      ok: true,
      data: pages[`${locale}:${offset}`],
    });
  };
  try {
    setAppLocale("en");
    const mounted = render(
      <QueryClientProvider client={client}>
        <RuleAuditPicker assessmentId={en0.assessmentId} />
      </QueryClientProvider>,
    );
    await settle();
    assert.ok(
      delayedEnPage2,
      "EN page 2 should be in flight after EN page 1 resolves",
    );

    // Switch to VI while EN page 2 is still in flight
    act(() => setAppLocale("vi"));
    await settle();

    // Release the delayed EN page 2 response after VI switch
    holdEnPage2 = false;
    delayedEnPage2!(Response.json({ ok: true, data: en1 }));
    await settle();

    // VI page 1 and VI page 2 must be rendered; EN page 2 must never mix into VI
    assert.match(mounted.textContent ?? "", /Kiểm thử · 2/);
    assert.match(mounted.textContent ?? "", /Kiểm thử đã rà soát/);
    assert.match(mounted.textContent ?? "", /VI: Rule 1/);
    assert.match(mounted.textContent ?? "", /VI: Rule 2/);
    assert.match(mounted.textContent ?? "", /VI: Intent 1/);
    assert.match(mounted.textContent ?? "", /VI: Intent 2/);
    assert.doesNotMatch(mounted.textContent ?? "", /EN: Rule 1/);
    assert.doesNotMatch(mounted.textContent ?? "", /EN: Rule 2/);

    // Select rule-1 while in VI
    const checkboxVi = mounted.querySelector(
      '[data-rule-id="rule-1"] [role="checkbox"]',
    ) as HTMLElement | null;
    assert.ok(checkboxVi);
    act(() => {
      checkboxVi.click();
    });
    await settle();
    assert.equal(
      mounted
        .querySelector('[data-rule-id="rule-1"] [data-slot="card"]')
        ?.getAttribute("data-selected"),
      "true",
    );

    // Switch VI -> EN and verify both EN pages load and selection is preserved
    act(() => setAppLocale("en"));
    await settle();
    assert.match(mounted.textContent ?? "", /Testing · 2/);
    assert.match(mounted.textContent ?? "", /Reviewed tests/);
    assert.match(mounted.textContent ?? "", /EN: Rule 1/);
    assert.match(mounted.textContent ?? "", /EN: Rule 2/);
    assert.doesNotMatch(mounted.textContent ?? "", /VI: Rule 1/);
    assert.equal(
      mounted
        .querySelector('[data-rule-id="rule-1"] [data-slot="card"]')
        ?.getAttribute("data-selected"),
      "true",
    );

    // Switch EN -> VI again and verify VI cache + selection preserved
    act(() => setAppLocale("vi"));
    await settle();
    assert.match(mounted.textContent ?? "", /Kiểm thử · 2/);
    assert.match(mounted.textContent ?? "", /VI: Rule 1/);
    assert.match(mounted.textContent ?? "", /VI: Rule 2/);
    assert.equal(
      mounted
        .querySelector('[data-rule-id="rule-1"] [data-slot="card"]')
        ?.getAttribute("data-selected"),
      "true",
    );
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});
