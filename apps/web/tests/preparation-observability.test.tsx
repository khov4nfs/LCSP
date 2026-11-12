import { resolveMessage } from "@lcsp/i18n";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  complianceRuleSetHistorySchema,
  ruleSetPreparationAvailabilitySchema,
} from "@lcsp/contracts/compliance-rule-set";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as E,
  preparationActivityPageSchema,
  workspaceAssessmentSnapshotSchema,
} from "@lcsp/contracts/evidence";
import { AGENT_EXECUTION_STATES as X } from "@lcsp/contracts/assessment";
import { RuleSetPreparationList } from "../src/features/admin/components/organisms/rule-set-preparation-list.tsx";
import { PreparationObservability } from "../src/features/admin/components/molecules/preparation-observability.tsx";
import {
  mergePreparationEvents,
  preparationProgress,
  projectPreparationActivity,
} from "../src/features/admin/utils/rule-set-preparation-activity.ts";
import {
  preparationFailure,
  preparationStages,
} from "../src/features/admin/utils/preparation-observability.ts";
import {
  render,
  settle,
  click,
  installFakeEventSource,
} from "./support/dom.ts";
import { setAppLocale } from "../src/lib/locale.ts";
const wire = JSON.parse(
  readFileSync(
    new URL(
      "../src/public/assets/mocks/preparation-observability.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const run = complianceRuleSetHistorySchema.shape.preparations.element.parse(
  wire.run,
);
const page = preparationActivityPageSchema.parse(wire.page),
  older = preparationActivityPageSchema.parse(wire.older);
test("run-scoped durable history survives replay/reconnect, pages older events and shows safe failure/usage evidence", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    requests.push(url);
    return Promise.resolve(
      Response.json({ ok: true, data: url.includes("cursor=") ? older : page }),
    );
  };
  const es = installFakeEventSource();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  try {
    setAppLocale("en");
    const node = render(
      <QueryClientProvider client={client}>
        <RuleSetPreparationList
          preparations={[run]}
          availability={ruleSetPreparationAvailabilitySchema.parse(
            wire.availability,
          )}
          ruleSets={[]}
        />
      </QueryClientProvider>,
    );
    await settle();
    assert.match(node.textContent!, new RegExp(run.preparationRunId));
    assert.match(node.textContent!, /DEVELOPMENT_ONLY/);
    assert.match(node.textContent!, /MODEL_EXECUTION/);
    assert.match(node.textContent!, /Observed input tokens: 100/);
    assert(!node.textContent!.includes("DO_NOT_RENDER"));
    const source = es.instances[0];
    act(() => source.open());
    act(() => source.onerror?.(new window.Event("error")));
    await settle();
    assert.match(node.textContent!, /Reconnecting/i);
    assert.match(node.textContent!, /Running/i);
    const snapshot = workspaceAssessmentSnapshotSchema.parse({
      emitted_at: new Date().toISOString(),
      canonical_assessments: [],
      canonical_events: [],
      agent_stream_events: [
        page.events[0],
        page.events[0],
        ...page.events.slice().reverse(),
        { ...page.events[0], eventId: "foreign", preparationRunId: "foreign" },
      ],
    });
    act(() => {
      source.open();
      source.emit("workspace.runtime", snapshot);
      source.emit("workspace.runtime", { bad: true });
    });
    await settle();
    const before = node.querySelectorAll(
      '[data-slot="work-disclosure"]',
    ).length;
    click(
      [...node.querySelectorAll("button")].find(
        (button) => button.textContent === "Load older persisted events",
      )!,
    );
    await settle();
    assert(requests.some((url) => url.includes("cursor=")));
    assert(
      node.querySelectorAll('[data-slot="work-disclosure"]').length > before,
    );
    assert(!node.textContent!.includes("foreign"));
  } finally {
    client.clear();
    es.restore();
    globalThis.fetch = original;
  }
});
for (const locale of ["en", "vi"] as const)
  for (const state of [X.RUNNING, X.SUCCEEDED, X.FAILED, X.PAUSED, X.CANCELLED])
    test(`${locale} canonical ${state} is independent from missing/disconnected telemetry`, () => {
      setAppLocale(locale);
      const node = render(
        <PreparationObservability
          run={{ ...run, executionState: state, resumable: state === X.PAUSED }}
          events={[]}
        />,
      );
      assert.match(node.textContent!, new RegExp(run.preparationRunId));
      assert.match(node.textContent!, /NOT_REPORTED/);
      assert(!node.textContent!.includes("undefined"));
    });
test("malformed/missing counters never fabricate zero completeness; inconsistency is explicit", () => {
  const e = page.events[0];
  assert.equal(
    preparationProgress([
      {
        ...e,
        eventType: E.customProgress,
        data: { review_frontier: { progress: { total: 10, pending: 2 } } },
      },
    ])?.reviewed,
    null,
  );
  assert.equal(
    preparationProgress([
      {
        ...e,
        eventType: E.customProgress,
        data: {
          source_nodes_reviewed: 8,
          review_frontier: {
            progress: { total: 10, reviewedWithClaims: 2, reviewedNoClaims: 1 },
          },
        },
      },
    ])?.inconsistent,
    true,
  );
  assert.equal(
    preparationProgress([
      {
        ...e,
        eventType: E.customProgress,
        data: { review_frontier: { progress: { total: -1 } } },
      },
    ]),
    null,
  );
  assert.equal(
    mergePreparationEvents(
      run.preparationRunId,
      page.events,
      page.events.slice().reverse(),
    ).length,
    page.events.length,
  );
  assert.equal(
    preparationFailure([
      {
        ...page.events.at(-1)!,
        data: {
          activity_kind: "PREPARATION_FAILURE",
          terminal_stage: "Bearer private material",
          raw_error_body: "DO_NOT_RENDER",
        },
      },
    ])?.stage,
    null,
  );
  const rows = projectPreparationActivity(
    [{ ...e, eventType: E.modelCallStarted, status: "RUNNING" }],
    true,
    null,
  );
  assert.notEqual(rows[0]?.status, "COMPLETED");
});

test("Vietnamese operations labels preserve exact Unicode bytes on Windows", () => {
  assert.equal(
    resolveMessage("vi", "pages.preparationOps.title"),
    "Preparation \u0111\u00e3 ch\u1ecdn \u2014 run canonical",
  );
});

test("terminal canonical states never display an actively running stage", () => {
  for (const state of [X.SUCCEEDED, X.FAILED, X.CANCELLED])
    assert(
      preparationStages({ ...run, executionState: state }, page.events).every(
        (stage) => stage.status !== X.RUNNING,
      ),
    );
});
