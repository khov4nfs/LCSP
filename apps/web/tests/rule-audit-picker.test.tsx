import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, settle, click, byText, installFetch } from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { RuleAuditPicker } from "../src/features/assessment-runtime/components/organisms/rule-audit-picker.tsx";
import { copy } from "../src/features/assessment-runtime/utils/conversation-copy.ts";
import { ruleAuditKeys } from "../src/lib/api/rule-audit-queries.ts";
import {
  AUTHORED_LOCALIZATION_READINESS_STATES,
  type RuleAuditCatalog,
} from "@lcsp/contracts/assessment-domain";

const catalog = JSON.parse(
  readFileSync(
    new URL(
      "../src/public/assets/mocks/selected-rule-audit-catalog.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const request = JSON.parse(
  readFileSync(
    new URL(
      "../src/public/assets/mocks/selected-rule-audit-request.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
setAppLocale("en");

for (const locale of ["en", "vi"] as const) {
  test(`${locale}: fallback on a later catalog page keeps the full catalog visible and blocks audit`, async () => {
    const id = catalog.assessmentId as string;
    const originalFetch = globalThis.fetch;
    const offsets: number[] = [];
    globalThis.fetch = async (input) => {
      const offset = Number(
        new URL(String(input), "http://localhost").searchParams.get("offset"),
      );
      offsets.push(offset);
      return Response.json({
        ok: true,
        data: {
          ...catalog,
          offset,
          nextOffset: offset === 0 ? 10 : null,
          rules: catalog.rules.slice(offset, offset + 10),
          localizationFallback: offset !== 0,
          localizationState:
            offset === 0
              ? AUTHORED_LOCALIZATION_READINESS_STATES.READY
              : AUTHORED_LOCALIZATION_READINESS_STATES.PENDING,
        },
      });
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    try {
      setAppLocale(locale);
      const view = render(
        <QueryClientProvider client={client}>
          <RuleAuditPicker assessmentId={id} />
        </QueryClientProvider>,
      );
      await settle();
      const data = client.getQueryData<RuleAuditCatalog>([
        ...ruleAuditKeys.catalog(id),
        locale,
      ]);
      assert.deepEqual(offsets, [0, 10]);
      assert.equal(data?.rules.length, catalog.total);
      assert.equal(data?.localizationFallback, true);
      assert.equal(
        data?.localizationState,
        AUTHORED_LOCALIZATION_READINESS_STATES.PENDING,
      );
      assert.ok(view.textContent?.includes(copy("localizationFallback")));
      assert.equal(
        byText<HTMLButtonElement>(view, "button", copy("ruleAudit.selectAll"))
          ?.disabled,
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
      client.clear();
      act(() => setAppLocale("en"));
    }
  });
}

test("explicit selection starts only Rule 3 from twenty pinned rules", async () => {
  const id = catalog.assessmentId as string;
  const fetchStub = installFetch({
    [`GET /api/assessments/${id}/rules`]: catalog,
    [`POST /api/assessments/${id}/rule-audits`]: request,
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  try {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RuleAuditPicker assessmentId={id} />
      </QueryClientProvider>,
    );
    await settle();
    const start = byText<HTMLButtonElement>(
      view,
      "button",
      "Audit selected rules",
    );
    assert.ok(start?.disabled, "zero selection must never launch Root");
    assert.equal(view.querySelectorAll('[role="checkbox"]').length, 20);
    assert.match(view.textContent ?? "", /Selected 0\/20/);

    click(byText(view, "button", "Select all"));
    await settle();
    assert.match(view.textContent ?? "", /Selected 20\/20/);
    click(byText(view, "button", "Clear all"));
    await settle();
    assert.match(view.textContent ?? "", /Selected 0\/20/);

    const ruleThree = view.querySelector<HTMLElement>(
      '[data-rule-id="Rule-3"] [role="checkbox"]',
    );
    assert.ok(ruleThree);
    act(() => ruleThree.click());
    await settle();
    assert.equal(start?.disabled, false);
    click(start);
    await settle();

    const sent = fetchStub.calls.filter((call) => call.method === "POST");
    assert.equal(sent.length, 1);
    const body = JSON.parse(sent[0]!.body ?? "{}");
    assert.deepEqual(body.rules, [
      { assessmentRuleId: "Rule-3", assessmentRuleVersion: "v1" },
    ]);
    assert.equal(body.scopeMode, "SELECTED_RULES");
  } finally {
    fetchStub.restore();
    queryClient.clear();
  }
});
