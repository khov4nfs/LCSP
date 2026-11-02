import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, settle, click, byText, installFetch } from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { RuleAuditPicker } from "../src/features/assessment-runtime/components/organisms/rule-audit-picker.tsx";

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
