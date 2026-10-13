import assert from "node:assert/strict";
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
  complianceRuleSetHistorySchema,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
} from "@lcsp/contracts/compliance-rule-set";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { setAppLocale } from "../src/lib/locale.ts";
import { ComplianceRuleSetsPage } from "../src/features/admin/components/organisms/compliance-rule-sets-page.tsx";

setAppLocale("en");

const SOURCE_V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RULE_SET_V1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN_OK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RUN_FAILED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const history = complianceRuleSetHistorySchema.parse({
  preparation: {
    legalSourceVersionId: SOURCE_V2,
    legalSourceVersion: "2026.11",
    canStart: false,
    refusalReason:
      RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_ALREADY_STARTED,
    currentRun: null,
  },
  ruleSets: [
    {
      ruleSetVersionId: RULE_SET_V1,
      version: "2026.10.p1",
      legalSourceVersionId: SOURCE_V1,
      legalSourceVersion: "2026.10",
      ruleSetDigest: "f".repeat(64),
      lifecycleState: "ACTIVE",
      activatedAt: "2026-10-11T10:00:00.000Z",
      supersededAt: null,
      createdAt: "2026-10-11T09:55:00.000Z",
      legalRequirementCount: 37,
      assessmentRuleCount: 62,
    },
  ],
  preparations: [
    {
      preparationRunId: RUN_FAILED,
      legalSourceVersionId: SOURCE_V2,
      legalSourceVersion: "2026.11",
      executionState: "FAILED",
      ruleSetVersionId: null,
      failureReason: "NO_SUBMISSION",
      attempt: 1,
      requestedBy: "rule-set-preparation-system",
      createdAt: "2026-10-11T11:00:00.000Z",
      completedAt: "2026-10-11T11:10:00.000Z",
      retryable: true,
    },
    {
      preparationRunId: RUN_OK,
      legalSourceVersionId: SOURCE_V1,
      legalSourceVersion: "2026.10",
      executionState: "SUCCEEDED",
      ruleSetVersionId: RULE_SET_V1,
      failureReason: null,
      attempt: 1,
      requestedBy: "rule-set-preparation-system",
      createdAt: "2026-10-11T09:40:00.000Z",
      completedAt: "2026-10-11T09:55:00.000Z",
      retryable: false,
    },
  ],
});

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
}

test("Compliance Rule Sets shows metadata and canonical Retry for a failed preparation", async () => {
  const stub = installFetch({ "GET /api/admin/compliance-rule-sets": history });
  try {
    const page = render(
      <QueryClientProvider client={client()}>
        <ComplianceRuleSetsPage />
      </QueryClientProvider>,
    );
    await settle();
    const text = page.textContent ?? "";
    assert.match(text, /Compliance rule sets/);
    assert.match(text, /2026\.10\.p1/);
    assert.match(text, /Legal Source Version/);
    assert.match(text, /37/);
    assert.match(text, /62/);
    assert.match(text, /f{64}/);
    assert.match(text, /No rule set|Rule Set Preparation/);
    // A failed initial attempt uses Retry; callers cannot select another source or provide content.
    assert.equal(
      page.querySelectorAll("form, select, [role='combobox']").length,
      0,
    );
    assert.equal(byText(page, "button", /^Start/), null);
    assert.equal(
      byText(page, "button", /Start preparation|Start Rule Set Preparation/i),
      null,
    );
    // The only action is the explicit retry of the one failed run.
    const retry = buttons(page).filter((button) =>
      /Retry failed Rule Set Preparation/.test(button.textContent ?? ""),
    );
    assert.equal(retry.length, 1);
    assert.equal(
      page.querySelectorAll("[data-preparation-state='FAILED']").length,
      1,
    );
    assert.match(page.textContent ?? "", /No rule set was submitted/);
  } finally {
    stub.restore();
  }
});

test("retrying a failed preparation calls the retry route for THAT run only", async () => {
  const stub = installFetch({
    "GET /api/admin/compliance-rule-sets": history,
    [`POST /api/admin/compliance-rule-sets/preparations/${RUN_FAILED}/retries`]:
      {
        preparationRunId: "99999999-9999-4999-8999-999999999999",
        legalSourceVersionId: SOURCE_V2,
        executionState: "QUEUED",
        ruleSetVersionId: null,
      },
  });
  try {
    const page = render(
      <QueryClientProvider client={client()}>
        <ComplianceRuleSetsPage />
      </QueryClientProvider>,
    );
    await settle();
    click(byText(page, "button", "Retry failed Rule Set Preparation"));
    await settle();
    const posts = stub.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(
      posts[0]?.body,
      null,
      "no source, key or version can be supplied by the page",
    );
  } finally {
    stub.restore();
  }
});

const clean = complianceRuleSetHistorySchema.parse({
  preparation: {
    legalSourceVersionId: SOURCE_V1,
    legalSourceVersion: "2026.10",
    canStart: true,
    refusalReason: null,
    currentRun: null,
  },
  ruleSets: [],
  preparations: [],
});

function page() {
  return render(
    <QueryClientProvider client={client()}>
      <ComplianceRuleSetsPage />
    </QueryClientProvider>,
  );
}

test("clean baseline enables Prepare and cancellation spends no model quota", async () => {
  const stub = installFetch({ "GET /api/admin/compliance-rule-sets": clean });
  try {
    const rendered = page();
    await settle();
    const button = byText<HTMLButtonElement>(
      rendered,
      "button",
      "Prepare rule set",
    );
    assert.ok(button);
    assert.equal(button.disabled, false);
    assert.doesNotMatch(
      rendered.textContent ?? "",
      /Nothing on this page starts/,
    );
    click(button);
    await settle();
    assert.match(
      document.body.textContent ?? "",
      /Prepare compliance rule set\?/,
    );
    assert.match(document.body.textContent ?? "", /model quota/);
    click(byText(document.body, "button", "Cancel"));
    await settle();
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0);
  } finally {
    stub.restore();
  }
});

test("Prepare sends no source/content and refreshes the running server state", async () => {
  const run = {
    preparationRunId: RUN_OK,
    legalSourceVersionId: SOURCE_V1,
    executionState: AGENT_EXECUTION_STATES.QUEUED,
    ruleSetVersionId: null,
  };
  const routes = {
    "GET /api/admin/compliance-rule-sets": clean,
    "POST /api/admin/compliance-rule-sets/prepare": run,
  };
  const stub = installFetch(routes);
  const fetch = globalThis.fetch;
  let release!: () => void;
  const submitted = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input, init) => {
    if (init?.method === "POST") {
      await submitted;
      routes["GET /api/admin/compliance-rule-sets"] = {
        ...clean,
        preparation: {
          ...clean.preparation,
          canStart: false,
          refusalReason:
            RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
          currentRun: run,
        },
      };
    }
    return fetch(input, init);
  }) as typeof fetch;
  try {
    const rendered = page();
    await settle();
    click(byText(rendered, "button", "Prepare rule set"));
    await settle();
    click(byText(document.body, "button", "Prepare"));
    await settle();
    assert.equal(
      byText<HTMLButtonElement>(rendered, "button", "Preparing rule set…")
        ?.disabled,
      true,
    );
    release();
    await settle(12);
    assert.equal(
      byText<HTMLButtonElement>(rendered, "button", "Preparing rule set…")
        ?.disabled,
      true,
    );
    const posts = stub.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/admin/compliance-rule-sets/prepare");
    assert.equal(posts[0].body, null);
    assert.ok(stub.calls.filter((call) => call.method === "GET").length >= 2);
  } finally {
    release();
    stub.restore();
  }
});

test("a RUNNING preparation disables a second start", async () => {
  const state = {
    ...clean,
    preparation: {
      ...clean.preparation,
      canStart: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
      currentRun: {
        preparationRunId: RUN_OK,
        legalSourceVersionId: SOURCE_V1,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
        ruleSetVersionId: null,
      },
    },
  };
  const stub = installFetch({ "GET /api/admin/compliance-rule-sets": state });
  try {
    const rendered = page();
    await settle();
    assert.equal(
      byText<HTMLButtonElement>(rendered, "button", "Preparing rule set…")
        ?.disabled,
      true,
    );
  } finally {
    stub.restore();
  }
});

test("a compatible ACTIVE rule set shows success metadata and hides Prepare", async () => {
  const state = {
    ...history,
    preparation: {
      ...clean.preparation,
      canStart: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.ACTIVE_RULE_SET_EXISTS,
    },
    preparations: [],
  };
  const stub = installFetch({ "GET /api/admin/compliance-rule-sets": state });
  try {
    const rendered = page();
    await settle();
    assert.equal(byText(rendered, "button", "Prepare rule set"), null);
    assert.match(rendered.textContent ?? "", /2026\.10\.p1/);
    assert.match(rendered.textContent ?? "", /37/);
    assert.match(rendered.textContent ?? "", /62/);
  } finally {
    stub.restore();
  }
});

test("an unavailable source cannot start preparation", async () => {
  const state = {
    ...clean,
    preparation: {
      legalSourceVersionId: null,
      legalSourceVersion: null,
      canStart: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ELIGIBLE,
      currentRun: null,
    },
  };
  const stub = installFetch({ "GET /api/admin/compliance-rule-sets": state });
  try {
    const rendered = page();
    await settle();
    assert.equal(byText(rendered, "button", "Prepare rule set"), null);
  } finally {
    stub.restore();
  }
});
