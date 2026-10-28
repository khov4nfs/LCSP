import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buttons,
  byText,
  click,
  installFetch,
  render,
  settle,
} from "./support/dom.ts";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  complianceRuleSetResultSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { problemEnvelope } from "../src/lib/api/problem-envelope.ts";
import { setAppLocale } from "../src/lib/locale.ts";
import { ComplianceRuleSetResultPage } from "../src/features/admin/components/organisms/compliance-rule-set-result-page.tsx";

setAppLocale("en");

const result = complianceRuleSetResultSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/admin-compliance-rule-set-result.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
const ID = result.ruleSet.ruleSetVersionId;
const ROUTE = `GET /api/admin/compliance-rule-sets/${ID}`;

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
}

function open() {
  return render(
    <QueryClientProvider client={client()}>
      <ComplianceRuleSetResultPage ruleSetVersionId={ID} />
    </QueryClientProvider>,
  );
}

test("the result page shows the stored version, its Legal Source provenance and documents", async () => {
  const stub = installFetch({ [ROUTE]: result });
  try {
    const rendered = open();
    await settle();
    const text = rendered.textContent ?? "";
    assert.match(
      text,
      new RegExp(result.ruleSet.version.replaceAll(".", "\\.")),
    );
    assert.match(text, /Active/);
    assert.match(
      text,
      new RegExp(result.legalSourceVersion.version.replaceAll(".", "\\.")),
    );
    for (const document of result.legalSourceVersion.documents) {
      assert.ok(text.includes(document.documentId), document.documentId);
    }
    assert.ok(text.includes(result.ruleSet.ruleSetDigest));
    assert.ok(
      [...rendered.querySelectorAll("a")].some(
        (link) => link.getAttribute("href") === "/admin/compliance-rule-sets",
      ),
      "links back to the rule sets",
    );
    assert.equal(
      stub.calls.filter((call) => call.method === "POST").length,
      0,
      "read-only",
    );
  } finally {
    stub.restore();
  }
});

test("requirements and assessment rules are inspectable with their source-stated conditions, exceptions and sources", async () => {
  const stub = installFetch({ [ROUTE]: result });
  try {
    const rendered = open();
    await settle();
    const text = rendered.textContent ?? "";
    const requirement = result.ruleSet.legalRequirements[0];
    assert.ok(text.includes(requirement.title));
    assert.ok(text.includes(requirement.proposition));
    for (const condition of requirement.applicabilityConditions)
      assert.ok(text.includes(condition));
    for (const exception of requirement.exceptions)
      assert.ok(text.includes(exception));
    for (const source of requirement.sources) {
      assert.ok(text.includes(source.documentId));
      assert.ok(text.includes(source.locator));
    }
    const rule = result.ruleSet.assessmentRules[0];
    assert.ok(text.includes(rule.concept));
    assert.ok(text.includes(rule.legalIntent));
    assert.ok(text.includes(rule.applicabilityGuidance));
    for (const criterion of rule.criteria)
      assert.ok(text.includes(criterion.statement));
  } finally {
    stub.restore();
  }
});

test("a requirement that states no exception says so instead of rendering blank", async () => {
  const bare = structuredClone(result);
  bare.ruleSet.legalRequirements[0].exceptions = [];
  bare.ruleSet.legalRequirements[0].qualifiers = [];
  const stub = installFetch({ [ROUTE]: bare });
  try {
    const rendered = open();
    await settle();
    assert.match(rendered.textContent ?? "", /None stated/);
  } finally {
    stub.restore();
  }
});

test("a superseded version stays readable and shows when it was superseded", async () => {
  const superseded = structuredClone(result);
  superseded.ruleSet.lifecycleState = "SUPERSEDED";
  superseded.supersededAt = "2026-10-14T01:00:00.000Z";
  const stub = installFetch({ [ROUTE]: superseded });
  try {
    const rendered = open();
    await settle();
    assert.match(rendered.textContent ?? "", /Superseded/);
  } finally {
    stub.restore();
  }
});

test("an unknown version shows a not-found state without a retry loop", async () => {
  const stub = installFetch({
    [ROUTE]: Response.json(
      problemEnvelope(COMPLIANCE_RULE_SET_ERROR_CODES.ruleSetNotFound, 404),
      {
        status: 404,
      },
    ),
  });
  try {
    const rendered = open();
    await settle();
    assert.match(rendered.textContent ?? "", /not found/i);
    assert.equal(byText(rendered, "button", "Retry"), null);
  } finally {
    stub.restore();
  }
});

test("a failed load shows an error with a working retry", async () => {
  const routes: Record<string, unknown> = {
    [ROUTE]: Response.json(problemEnvelope("UPSTREAM_UNAVAILABLE", 503), {
      status: 503,
    }),
  };
  const stub = installFetch(routes);
  try {
    const rendered = open();
    await settle();
    assert.match(rendered.textContent ?? "", /Could not load rule set result/);
    routes[ROUTE] = result;
    click(
      buttons(rendered).find((button) =>
        /Retry/.test(button.textContent ?? ""),
      ) ?? null,
    );
    await settle(8);
    assert.match(rendered.textContent ?? "", /Legal Source provenance/);
  } finally {
    stub.restore();
  }
});
