import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buttons,
  byText,
  click,
  installFakeEventSource,
  installFetch,
  render,
  settle,
} from "./support/dom.ts";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AGENT_EXECUTION_STATES,
  ARTIFACT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  complianceRuleSetHistorySchema,
  RULE_SET_PREPARATION_FAILURE_REASONS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
} from "@lcsp/contracts/compliance-rule-set";
import { setAppLocale } from "../src/lib/locale.ts";
import { ComplianceRuleSetsPage } from "../src/features/admin/components/organisms/compliance-rule-sets-page.tsx";

setAppLocale("en");

const SOURCE_V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RULE_SET_V1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RULE_SET_OLD = "10101010-1010-4010-8010-101010101010";
const RUN_OK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RUN_FAILED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RUN_CANCEL = "99999999-9999-4999-8999-999999999999";

const history = complianceRuleSetHistorySchema.parse({
  preparation: {
    legalSourceVersionId: SOURCE_V2,
    legalSourceVersion: "2026.11",
    activeRuleSetVersionId: RULE_SET_V1,
    canStart: false,
    canReplace: true,
    refusalReason: RULE_SET_PREPARATION_REFUSAL_REASONS.ACTIVE_RULE_SET_EXISTS,
    currentRun: {
      preparationRunId: RUN_FAILED,
      legalSourceVersionId: SOURCE_V2,
      executionState: AGENT_EXECUTION_STATES.FAILED,
      ruleSetVersionId: null,
    },
  },
  ruleSets: [
    {
      ruleSetVersionId: RULE_SET_V1,
      version: "2026.10.p1",
      legalSourceVersionId: SOURCE_V1,
      legalSourceVersion: "2026.10",
      ruleSetDigest: "f".repeat(64),
      lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      activatedAt: "2026-10-11T10:00:00.000Z",
      supersededAt: null,
      createdAt: "2026-10-11T09:55:00.000Z",
      legalRequirementCount: 37,
      assessmentRuleCount: 62,
    },
    {
      ruleSetVersionId: RULE_SET_OLD,
      version: "2026.09.p1",
      legalSourceVersionId: SOURCE_V1,
      legalSourceVersion: "2026.09",
      ruleSetDigest: "e".repeat(64),
      lifecycleState: ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
      activatedAt: "2026-10-01T10:00:00.000Z",
      supersededAt: "2026-10-11T10:00:00.000Z",
      createdAt: "2026-10-01T09:55:00.000Z",
      legalRequirementCount: 31,
      assessmentRuleCount: 51,
    },
  ],
  preparations: [
    {
      preparationRunId: RUN_FAILED,
      legalSourceVersionId: SOURCE_V2,
      legalSourceVersion: "2026.11",
      executionState: AGENT_EXECUTION_STATES.FAILED,
      ruleSetVersionId: null,
      failureReason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
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
      executionState: AGENT_EXECUTION_STATES.SUCCEEDED,
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

test("Compliance Rule Sets shows Prepare and canonical Retry after a failed preparation", async () => {
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
    // An ACTIVE rule set never blocks improvement: an explicit "Prepare new version" is offered next
    // to "View result". Retry remains scoped to the latest failed run.
    assert.equal(
      page.querySelectorAll("form, select, [role='combobox']").length,
      0,
    );
    assert.equal(byText(page, "button", "Prepare rule set"), null);
    const prepare = byText<HTMLButtonElement>(
      page,
      "button",
      "Prepare new version",
    );
    assert.ok(prepare);
    assert.equal(prepare.disabled, false);
    assert.ok(
      page.querySelector(
        `[data-compliance-rule-set-active] a[href='/admin/compliance-rule-sets/${RULE_SET_V1}']`,
      ),
    );
    assert.equal(byText(page, "button", "Cancel preparation"), null);
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
    activeRuleSetVersionId: null,
    canStart: true,
    canReplace: false,
    refusalReason: null,
    currentRun: null,
  },
  ruleSets: [],
  preparations: [],
});

const failedThreeTimes = complianceRuleSetHistorySchema.parse({
  ...clean,
  preparation: {
    ...clean.preparation,
    currentRun: {
      preparationRunId: RUN_CANCEL,
      legalSourceVersionId: SOURCE_V1,
      executionState: AGENT_EXECUTION_STATES.FAILED,
      ruleSetVersionId: null,
    },
  },
  preparations: [1, 2, 3]
    .map((attempt) => ({
      preparationRunId: [RUN_FAILED, RUN_OK, RUN_CANCEL][attempt - 1]!,
      legalSourceVersionId: SOURCE_V1,
      legalSourceVersion: "2026.10",
      executionState: AGENT_EXECUTION_STATES.FAILED,
      ruleSetVersionId: null,
      failureReason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
      attempt,
      requestedBy: "owner-admin",
      createdAt: `2026-10-13T01:0${attempt}:00.000Z`,
      completedAt: `2026-10-13T01:1${attempt}:00.000Z`,
      retryable: attempt === 3,
    }))
    .reverse(),
});

function page() {
  return render(
    <QueryClientProvider client={client()}>
      <ComplianceRuleSetsPage />
    </QueryClientProvider>,
  );
}

test("three failed attempts keep Prepare visible and enabled with no Cancel action", async () => {
  const stub = installFetch({
    "GET /api/admin/compliance-rule-sets": failedThreeTimes,
  });
  try {
    const rendered = page();
    await settle();
    const prepare = byText<HTMLButtonElement>(
      rendered,
      "button",
      "Prepare rule set",
    );
    assert.ok(prepare);
    assert.equal(prepare.disabled, false);
    assert.equal(byText(rendered, "button", "Cancel preparation"), null);
    assert.equal(
      rendered.querySelectorAll("[data-preparation-state='FAILED']").length,
      3,
    );
  } finally {
    stub.restore();
  }
});

test("preparing after three failures displays Attempt 4 and exposes Cancel while queued", async () => {
  const attemptFour = {
    preparationRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    legalSourceVersionId: SOURCE_V1,
    executionState: AGENT_EXECUTION_STATES.QUEUED,
    ruleSetVersionId: null,
  };
  const attemptFourHistory = complianceRuleSetHistorySchema.parse({
    ...failedThreeTimes,
    preparation: {
      ...failedThreeTimes.preparation,
      activeRuleSetVersionId: null,
      canStart: false,
      canReplace: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
      currentRun: attemptFour,
    },
    preparations: [
      {
        ...attemptFour,
        legalSourceVersion: "2026.10",
        failureReason: null,
        attempt: 4,
        requestedBy: "owner-admin",
        createdAt: "2026-10-13T01:04:00.000Z",
        completedAt: null,
        retryable: false,
      },
      ...failedThreeTimes.preparations,
    ],
  });
  const routes: Record<string, unknown> = {
    "GET /api/admin/compliance-rule-sets": failedThreeTimes,
    "POST /api/admin/compliance-rule-sets/prepare": attemptFour,
  };
  const stub = installFetch(routes);
  const fetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const response = await fetch(input, init);
    if (init?.method === "POST") {
      routes["GET /api/admin/compliance-rule-sets"] = attemptFourHistory;
    }
    return response;
  }) as typeof fetch;
  try {
    const rendered = page();
    await settle();
    click(byText(rendered, "button", "Prepare rule set"));
    await settle();
    click(byText(document.body, "button", "Prepare"));
    await settle(12);
    assert.equal(
      rendered.querySelectorAll("[data-preparation-state='QUEUED']").length,
      1,
    );
    assert.equal(byText(rendered, "button", "Prepare rule set"), null);
    assert.ok(byText(rendered, "button", "Cancel preparation"));
    assert.equal(
      stub.calls.filter(
        (call) => call.url === "/api/admin/compliance-rule-sets/prepare",
      ).length,
      1,
    );
  } finally {
    globalThis.fetch = fetch;
    stub.restore();
  }
});

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
          activeRuleSetVersionId: null,
          canStart: false,
          canReplace: false,
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
    // Admin supplies no source or content; a first preparation carries no replacement intent.
    assert.deepEqual(JSON.parse(String(posts[0].body ?? "{}")), {});
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
      activeRuleSetVersionId: null,
      canStart: false,
      canReplace: false,
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
      activeRuleSetVersionId: null,
      canStart: false,
      canReplace: false,
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
      activeRuleSetVersionId: null,
      canStart: false,
      canReplace: false,
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

function cancellableHistory(state: "QUEUED" | "RUNNING") {
  const run = {
    preparationRunId: RUN_CANCEL,
    legalSourceVersionId: SOURCE_V1,
    executionState: state,
    ruleSetVersionId: null,
  };
  return complianceRuleSetHistorySchema.parse({
    ...clean,
    preparation: {
      ...clean.preparation,
      activeRuleSetVersionId: null,
      canStart: false,
      canReplace: false,
      refusalReason:
        RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
      currentRun: run,
    },
    preparations: [
      {
        ...run,
        legalSourceVersion: "2026.10",
        failureReason: null,
        attempt: 1,
        requestedBy: "rule-set-preparation-system",
        createdAt: "2026-10-13T01:00:00.000Z",
        completedAt: null,
        retryable: false,
      },
    ],
  });
}

test("queued and running preparations expose the Admin cancel action", async () => {
  for (const executionState of ["QUEUED", "RUNNING"] as const) {
    const stub = installFetch({
      "GET /api/admin/compliance-rule-sets": cancellableHistory(executionState),
    });
    try {
      const rendered = page();
      await settle();
      assert.ok(byText(rendered, "button", "Cancel preparation"));
      assert.equal(
        rendered.querySelectorAll(
          `[data-preparation-state='${executionState}']`,
        ).length,
        1,
      );
    } finally {
      stub.restore();
    }
    document.body.replaceChildren();
  }
});

test("Admin cancellation confirms, sends only the preparation ID, and settles the UI", async () => {
  const routes: Record<string, unknown> = {
    "GET /api/admin/compliance-rule-sets": cancellableHistory("RUNNING"),
    [`POST /api/admin/compliance-rule-sets/preparations/${RUN_CANCEL}/cancel`]:
      {
        preparationRunId: RUN_CANCEL,
        legalSourceVersionId: SOURCE_V1,
        executionState: AGENT_EXECUTION_STATES.CANCELLED,
        ruleSetVersionId: null,
      },
  };
  const cancelledHistory = complianceRuleSetHistorySchema.parse({
    ...cancellableHistory("RUNNING"),
    preparation: {
      ...cancellableHistory("RUNNING").preparation,
      activeRuleSetVersionId: null,
      canStart: true,
      canReplace: false,
      refusalReason: null,
      currentRun: {
        preparationRunId: RUN_CANCEL,
        legalSourceVersionId: SOURCE_V1,
        executionState: AGENT_EXECUTION_STATES.CANCELLED,
        ruleSetVersionId: null,
      },
    },
    preparations: [
      {
        ...cancellableHistory("RUNNING").preparations[0],
        executionState: AGENT_EXECUTION_STATES.CANCELLED,
        completedAt: "2026-10-13T01:05:00.000Z",
      },
    ],
  });
  const stub = installFetch(routes);
  const fetch = globalThis.fetch;
  let release!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pendingRequest = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (input, init) => {
    if (init?.method === "POST") {
      started();
      await pendingRequest;
      routes["GET /api/admin/compliance-rule-sets"] = cancelledHistory;
    }
    return fetch(input, init);
  }) as typeof fetch;
  try {
    const rendered = page();
    await settle();
    click(byText(rendered, "button", "Cancel preparation"));
    await settle();
    const dialog = document.body.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.match(
      dialog.textContent ?? "",
      /No active rule set will be created/,
    );
    click(byText(dialog, "button", "Keep running"));
    await settle();
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0);

    click(byText(rendered, "button", "Cancel preparation"));
    await settle();
    const confirmation = document.body.querySelector('[role="dialog"]');
    assert.ok(confirmation);
    click(byText(confirmation, "button", "Cancel preparation"));
    await requestStarted;
    await settle();
    const pendingButtons = buttons(rendered).filter(
      (button) => button.textContent?.trim() === "Cancelling…",
    );
    assert.equal(pendingButtons.length, 2);
    assert.ok(pendingButtons.every((button) => button.disabled));
    release();
    await settle(12);

    const posts = stub.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(
      posts[0]?.url,
      `/api/admin/compliance-rule-sets/preparations/${RUN_CANCEL}/cancel`,
    );
    assert.equal(posts[0]?.body, null);
    assert.equal(byText(rendered, "button", "Cancel preparation"), null);
    assert.equal(
      rendered.querySelectorAll(
        `[data-preparation-state='${AGENT_EXECUTION_STATES.CANCELLED}']`,
      ).length,
      1,
    );
  } finally {
    release();
    stub.restore();
  }
});

const viewHref = (id: string) => `/admin/compliance-rule-sets/${id}`;

test("View result is offered for the active version, a succeeded run and a superseded version", async () => {
  const stub = installFetch({ "GET /api/admin/compliance-rule-sets": history });
  try {
    const rendered = page();
    await settle();
    const links = [...rendered.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    // Active card + SUCCEEDED run + history row of v1; the superseded version stays inspectable too.
    assert.ok(
      links.filter((href) => href === viewHref(RULE_SET_V1)).length >= 2,
    );
    assert.ok(links.includes(viewHref(RULE_SET_OLD)));
    assert.match(rendered.textContent ?? "", /Superseded/);
  } finally {
    stub.restore();
  }
});

test("an explicit replacement sends replaceActive, keeps the active version in use and shows the running state", async () => {
  const run = {
    preparationRunId: RUN_OK,
    legalSourceVersionId: SOURCE_V2,
    executionState: AGENT_EXECUTION_STATES.QUEUED,
    ruleSetVersionId: null,
  };
  const routes: Record<string, unknown> = {
    "GET /api/admin/compliance-rule-sets": history,
    "POST /api/admin/compliance-rule-sets/prepare": run,
  };
  const stub = installFetch(routes);
  try {
    const rendered = page();
    await settle();
    click(byText(rendered, "button", "Prepare new version"));
    await settle();
    // The confirm dialog explains that the current version stays active until the new one activates.
    assert.match(
      document.body.textContent ?? "",
      /stays in use until the new version validates/,
    );
    const confirm = buttons(document.body).filter(
      (button) => button.textContent === "Prepare new version",
    );
    click(confirm[confirm.length - 1]);
    routes["GET /api/admin/compliance-rule-sets"] = {
      ...history,
      preparation: {
        ...history.preparation,
        canStart: false,
        canReplace: false,
        refusalReason:
          RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
        currentRun: run,
      },
      preparations: [
        {
          ...history.preparations[0],
          preparationRunId: RUN_OK,
          legalSourceVersionId: SOURCE_V2,
          executionState: AGENT_EXECUTION_STATES.RUNNING,
          failureReason: null,
          retryable: false,
          completedAt: null,
        },
        ...history.preparations.slice(1),
      ],
    };
    await settle(12);
    const posts = stub.calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 1);
    assert.deepEqual(JSON.parse(String(posts[0].body)), {
      replaceActive: true,
    });
    const text = rendered.textContent ?? "";
    assert.match(text, /2026\.10\.p1/); // the active version is still shown as ACTIVE
    assert.match(text, /replacing active version/i);
    assert.equal(
      byText<HTMLButtonElement>(rendered, "button", "Preparing rule set…")
        ?.disabled,
      true,
    );
  } finally {
    stub.restore();
  }
});

const terminalHistory = (executionState: string) => ({
  ...history,
  preparation: { ...history.preparation, currentRun: null },
  preparations: [
    {
      ...history.preparations[0],
      executionState,
      failureReason:
        executionState === AGENT_EXECUTION_STATES.FAILED
          ? RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION
          : null,
      retryable: executionState === AGENT_EXECUTION_STATES.FAILED,
    },
    ...history.preparations.slice(1),
  ],
});

test("a terminal preparation settles: no Cancel, no live indicator, stream closed, history kept", async () => {
  for (const state of [
    AGENT_EXECUTION_STATES.FAILED,
    AGENT_EXECUTION_STATES.CANCELLED,
    AGENT_EXECUTION_STATES.SUCCEEDED,
  ]) {
    const stream = installFakeEventSource();
    const stub = installFetch({
      "GET /api/admin/compliance-rule-sets": terminalHistory(state),
    });
    try {
      const rendered = page();
      await settle();
      const text = rendered.textContent ?? "";
      assert.equal(
        byText(rendered, "button", "Cancel preparation"),
        null,
        state,
      );
      assert.doesNotMatch(text, /Live|Reconnecting/, state);
      assert.equal(
        rendered.querySelectorAll(".animate-pulse").length,
        0,
        state,
      );
      assert.ok(
        stream.instances.length >= 1,
        "the activity history is still requested",
      );
      await new Promise((resolve) => setTimeout(resolve, 1700));
      assert.ok(
        stream.instances.every((source) => source.closed),
        `${state}: the stream closes once the run is terminal`,
      );
    } finally {
      stub.restore();
      stream.restore();
      document.body.innerHTML = "";
    }
  }
});

test("a running preparation keeps Cancel and the live stream open", async () => {
  const stream = installFakeEventSource();
  const running = terminalHistory(AGENT_EXECUTION_STATES.RUNNING);
  const stub = installFetch({
    "GET /api/admin/compliance-rule-sets": {
      ...running,
      preparation: {
        ...running.preparation,
        canStart: false,
        canReplace: false,
        refusalReason:
          RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
      },
    },
  });
  try {
    const rendered = page();
    await settle();
    stream.instances[0]?.open();
    await settle();
    assert.ok(byText(rendered, "button", "Cancel preparation"));
    assert.match(rendered.textContent ?? "", /Live/);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.equal(
      stream.instances.some((source) => source.closed),
      false,
    );
  } finally {
    stub.restore();
    stream.restore();
  }
});

test("a failed replacement leaves the active version untouched and stays retryable", async () => {
  const stub = installFetch({
    "GET /api/admin/compliance-rule-sets": terminalHistory(
      AGENT_EXECUTION_STATES.FAILED,
    ),
  });
  try {
    const rendered = page();
    await settle();
    const text = rendered.textContent ?? "";
    assert.match(text, /No rule set was submitted/);
    assert.equal(
      buttons(rendered).filter((button) =>
        /Retry failed Rule Set Preparation/.test(button.textContent ?? ""),
      ).length,
      1,
    );
    assert.ok(rendered.querySelector("[data-compliance-rule-set-active]"));
    assert.match(
      rendered.querySelector("[data-compliance-rule-set-active]")
        ?.textContent ?? "",
      /2026\.10\.p1/,
    );
  } finally {
    stub.restore();
  }
});
