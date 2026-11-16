import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  PREPARATION_CATALOG_COMPLETENESS,
  PREPARATION_CATALOG_KINDS,
  PREPARATION_CATALOG_SOURCES,
  PREPARATION_CATALOG_REFERENCE_STATES,
} from "@lcsp/contracts/compliance-rule-set";
import { PreparationGeneratedCatalog } from "../src/features/admin/components/organisms/preparation-generated-catalog";
import { preparationGeneratedCatalogQueryKey } from "../src/lib/api/compliance-rule-set-queries";
import type { RuleSetPreparationRow } from "../src/features/admin/types/compliance-rule-sets.types";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

function page(
  kind:
    | typeof PREPARATION_CATALOG_KINDS.REQUIREMENT
    | typeof PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE,
  id: string,
  hasMore = false,
) {
  const identity = {
    preparationRunId: RUN_ID,
    inventoryRevision: 4,
    legalSourceVersionId: SOURCE_ID,
    materializationId: "materialization-4",
    source: PREPARATION_CATALOG_SOURCES.DRAFT,
    completeness: PREPARATION_CATALOG_COMPLETENESS.PARTIAL,
    draftVersion: 1,
    ruleSetVersionId: null,
    lifecycleState: null,
    unavailableReason: null,
    total: 2,
    filteredTotal: 2,
    hasMore,
    nextCursor: hasMore ? "opaque-cursor" : null,
  };
  if (kind === PREPARATION_CATALOG_KINDS.REQUIREMENT) {
    return {
      ...identity,
      kind,
      items: [
        {
          id,
          ordinal: null,
          data: {
            legalRequirementId: id,
            title: `Requirement ${id}`,
            proposition: `Persisted text ${id}`,
            operativePropositions: null,
            applicabilityConditions: [],
            qualifiers: [],
            exceptions: [],
            nonRepositoryDuty: false,
            coverage: {
              state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
              nonAssessableReason: "Requires external evidence",
            },
            claimBindings: [],
            claimBindingsState:
              PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
            sourceReferences: [],
            sourceReferencesState:
              PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
          },
        },
      ],
    };
  }
  return {
    ...identity,
    kind,
    items: [
      {
        id,
        ordinal: 0,
        data: {
          assessmentRuleId: id,
          concept: `Rule ${id}`,
          legalIntent: null,
          applicabilityGuidance: null,
          legalRequirementIds: [],
          criteria: [],
          investigationGoals: [],
          startingNodeTypes: [],
          targetNodeTypes: [],
          edgeStrategies: [],
          keywords: [],
          requiredEvidence: [],
          supportingEvidence: [],
          negativeEvidence: [],
          unresolvedConditions: [],
          sourceReferences: [],
          sourceReferencesState:
            PREPARATION_CATALOG_REFERENCE_STATES.NOT_RECORDED,
        },
      },
    ],
  };
}

test("catalog selection opens bounded details and collection switching clears stale selection", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    {
      url: "http://localhost",
    },
  );
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const original = new Map<string, unknown>();
  for (const key of [
    "window",
    "document",
    "Element",
    "HTMLElement",
    "Node",
    "MutationObserver",
    "getComputedStyle",
  ]) {
    original.set(key, globals[key]);
    globals[key] =
      key === "getComputedStyle"
        ? dom.window.getComputedStyle.bind(dom.window)
        : (dom.window as unknown as Record<string, unknown>)[key];
  }
  original.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT);
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch;
  let assessmentFetches = 0;
  globalThis.fetch = async () => {
    assessmentFetches += 1;
    return new Response(
      JSON.stringify({
        ok: true,
        data: page(PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE, "rule-a"),
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const run = {
    preparationRunId: RUN_ID,
    sourceAnalysisInventoryRevision: 4,
  } as RuleSetPreparationRow;
  client.setQueryData(
    preparationGeneratedCatalogQueryKey(
      RUN_ID,
      4,
      PREPARATION_CATALOG_KINDS.REQUIREMENT,
      undefined,
    ),
    {
      pages: [page(PREPARATION_CATALOG_KINDS.REQUIREMENT, "req-a", true)],
      pageParams: [null],
    },
  );
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(PreparationGeneratedCatalog, { run }),
        ),
      );
    });
    const requirementButton = [
      ...dom.window.document.querySelectorAll("button"),
    ].find((button) => button.textContent?.includes("Requirement req-a"));
    assert.ok(requirementButton);
    assert.match(requirementButton.textContent ?? "", /Draft/u);
    assert.ok(requirementButton.querySelector(".line-clamp-2"));
    await act(async () =>
      requirementButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      ),
    );
    assert.match(
      dom.window.document.body.textContent ?? "",
      /Persisted text req-a/u,
    );
    assert.equal(
      dom.window.document.querySelector("#preparation-catalog-entry-detail") !==
        null,
      true,
    );

    const switchButton = dom.window.document.querySelector<HTMLButtonElement>(
      'button[aria-pressed="false"]',
    );
    assert.ok(switchButton);
    await act(async () => {
      switchButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      for (
        let attempt = 0;
        attempt < 20 &&
        !dom.window.document.body.textContent?.includes("Rule rule-a");
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    assert.equal(
      dom.window.document.querySelector("#preparation-catalog-entry-detail"),
      null,
    );
    assert.equal(assessmentFetches, 1);
    assert.match(dom.window.document.body.textContent ?? "", /Rule rule-a/u);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    globalThis.fetch = originalFetch;
    for (const [key, value] of original) globals[key] = value;
    dom.window.close();
  }
});
