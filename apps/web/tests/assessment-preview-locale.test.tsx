import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveMessage } from "@lcsp/i18n";
import { LocaleProvider } from "../src/components/providers/locale-provider.tsx";
import PreviewCompliancePage from "../src/app/preview-compliance/page.tsx";
import { setAppLocale } from "../src/lib/locale.ts";
import fixture from "../src/public/assets/mocks/enterprise-legal-compliance-workspace.json";
import { click, byText, installFetch, render, settle } from "./support/dom.ts";

test("the preview follows locale changes and uses friendly question and finding labels", async () => {
  const originalObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  const stub = installFetch({ "GET /api/legal-library": fixture.library });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  try {
    const view = render(
      <LocaleProvider initialLocale="en">
        <QueryClientProvider client={client}>
          <PreviewCompliancePage />
        </QueryClientProvider>
      </LocaleProvider>,
    );
    await settle();
    for (const locale of ["en", "vi"] as const) {
      act(() => setAppLocale(locale));
      await settle();
      const t = (key: Parameters<typeof resolveMessage>[1]) => resolveMessage(locale, key);
      assert.ok(document.cookie.includes(`lcsp_locale=${locale}`));
      assert.equal(document.documentElement.lang, locale);
      for (const key of [
        "pages.assessmentConversation.preview.confirm",
        "pages.assessmentConversation.answer.selectOne",
        "pages.assessmentConversation.answer.selectMany",
        "pages.assessmentConversation.preview.tellMore",
        "pages.assessmentConversation.decision.verdict.compliant",
        "pages.assessmentConversation.decision.verdict.nonCompliant",
      ] as const) {
        assert.ok(view.textContent?.includes(t(key)), `${locale}: missing ${key}`);
      }
      assert.doesNotMatch(view.textContent ?? "", /Assessment Root|Human-in-the-Loop|BOOLEAN|SINGLE_SELECT|MULTI_SELECT|FREE_TEXT|Text Input/);
      assert.doesNotMatch(view.textContent ?? "", /\{repository\}|\{revision\}|\{commit\}/);
      assert.equal(view.querySelectorAll('input[type="checkbox"]').length, 4);
      assert.equal(view.querySelectorAll("textarea").length, 1);
    }
    const question = view.querySelector('[data-slot="hitl-demo-boolean"]');
    assert.ok(question);
    click(byText(question, "button", fixture.requests.requests[0].choices[0].label));
    await settle();
    assert.ok(question.textContent?.includes(resolveMessage("vi", "pages.assessmentConversation.question.confirmed")));
    assert.equal(question.querySelectorAll("button").length, 0);
    assert.deepEqual(stub.calls, [], "the preview must not request live assessment data");
    assert.equal(client.getQueryCache().getAll().length, 0, "preview fixtures must not alter the workspace cache");
  } finally {
    act(() => client.clear());
    stub.restore();
    globalThis.IntersectionObserver = originalObserver;
  }
});
