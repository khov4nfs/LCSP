import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LEGAL_SEMANTIC_CLAIM_TYPES,
  SOURCE_UNIT_DETAIL_AVAILABILITY,
  SOURCE_UNIT_DETAIL_MAPPING_REASONS,
  sourceReviewPayloadSchema,
  type PreparationSourceUnitDetailResponse,
  type PreparationSourceUnitsResponse,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_DOCUMENT_NODE_TYPES,
  SOURCE_REVIEW_DISPOSITIONS,
  SOURCE_REVIEW_STATES,
} from "@lcsp/contracts/legal-source";
import {
  preparationSourceUnitDetailQueryKey,
  preparationSourceUnitsQueryKey,
} from "../src/lib/api/compliance-rule-set-queries";
import type { SourceAnalysisActivityProps } from "../src/features/admin/components/molecules/preparation-source-analysis-modal";
import type { RuleSetPreparationRow } from "../src/features/admin/types/compliance-rule-sets.types";

type Unit = PreparationSourceUnitsResponse["units"][number];

function makeUnit(sourceNodeId: string, state: Unit["state"]): Unit {
  return {
    sourceNodeId,
    legalSourceVersionId: "22222222-2222-4222-8222-222222222222",
    materializationId: "materialization-4",
    documentId: "document-1",
    nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
    parentNodeId: "article-parent",
    structuralPath: `Article 4/${sourceNodeId}`,
    ordinal: 4,
    label: sourceNodeId,
    title: sourceNodeId,
    ancestors: [
      {
        sourceNodeId: "article-parent",
        nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
        structuralPath: "Article 4",
        ordinal: 4,
        label: "Article 4",
        title: "Article 4",
      },
    ],
    state,
    disposition: null,
    claimCount: 0,
    claimIds: [],
    claimIdsTruncated: false,
    referenceCount: 0,
    blockedReferenceCount: 0,
    referencesBlocked: false,
    completedAt: null,
  };
}

test("source unit query identity isolates run, revision, and normalized filters", () => {
  const base = preparationSourceUnitsQueryKey("run-a", 4, {
    search: "  Article 4 ",
    documentId: " document-1 ",
  });
  const normalized = preparationSourceUnitsQueryKey("run-a", 4, {
    search: "Article 4",
    documentId: "document-1",
  });
  assert.deepEqual(base, normalized);
  assert.notDeepEqual(
    base,
    preparationSourceUnitsQueryKey("run-b", 4, {
      search: "Article 4",
      documentId: "document-1",
    }),
  );
  assert.notDeepEqual(
    base,
    preparationSourceUnitsQueryKey("run-a", 5, {
      search: "Article 4",
      documentId: "document-1",
    }),
  );
  assert.notDeepEqual(
    base,
    preparationSourceUnitsQueryKey("run-a", 4, {
      state: SOURCE_REVIEW_STATES.PENDING,
      search: "Article 4",
      documentId: "document-1",
    }),
  );
  assert.notDeepEqual(
    preparationSourceUnitDetailQueryKey("run-a", 4, "node-a"),
    preparationSourceUnitDetailQueryKey("run-a", 4, "node-b"),
  );
  assert.notDeepEqual(
    preparationSourceUnitDetailQueryKey("run-a", 4, "node-a"),
    preparationSourceUnitDetailQueryKey("run-b", 4, "node-a"),
  );
  assert.notDeepEqual(
    preparationSourceUnitDetailQueryKey("run-a", 4, "node-a"),
    preparationSourceUnitDetailQueryKey("run-a", 5, "node-a"),
  );
});

test("hierarchy grouping keeps sibling review units independently addressable", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const priorHTMLElement = globalThis.HTMLElement;
  const priorElement = globalThis.Element;
  Object.defineProperty(globalThis, "window", {
    value: dom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    value: dom.window.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Element", {
    value: dom.window.Element,
    configurable: true,
  });
  try {
    const { groupPreparationSourceUnits } =
      await import("../src/features/admin/components/organisms/preparation-source-analysis-explorer");
    const first = makeUnit("node-clause-a", SOURCE_REVIEW_STATES.PENDING);
    const second = makeUnit(
      "node-clause-b",
      SOURCE_REVIEW_STATES.REVIEWED_WITH_CLAIMS,
    );
    const groups = groupPreparationSourceUnits(
      [first, second],
      [{ documentId: "document-1", title: "Official source" }],
    );
    assert.equal(groups.length, 1);
    assert.deepEqual(
      groups[0].units.map((unit) => unit.sourceNodeId),
      ["node-clause-a", "node-clause-b"],
    );
    assert.deepEqual(
      groups[0].units.map((unit) => unit.state),
      [SOURCE_REVIEW_STATES.PENDING, SOURCE_REVIEW_STATES.REVIEWED_WITH_CLAIMS],
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: priorWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: priorDocument,
      configurable: true,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      value: priorHTMLElement,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Element", {
      value: priorElement,
      configurable: true,
    });
    dom.window.close();
  }
});

test("source analysis modal exposes four keyboard-operable tabs without inline expansion", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    {
      url: "http://localhost",
      pretendToBeVisual: true,
    },
  );
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const priorHTMLElement = globalThis.HTMLElement;
  const priorElement = globalThis.Element;
  const priorActEnvironment = (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT;
  const priorNode = globalThis.Node;
  const priorMutationObserver = globalThis.MutationObserver;
  const priorFetch = globalThis.fetch;
  const priorComputedStyle = globalThis.getComputedStyle;
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  Object.defineProperty(globalThis, "window", {
    value: dom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    value: dom.window.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Element", {
    value: dom.window.Element,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Node", {
    value: dom.window.Node,
    configurable: true,
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    value: dom.window.MutationObserver,
    configurable: true,
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    value: dom.window.getComputedStyle.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: dom.window.requestAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: dom.window.cancelAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });

  const rootElement = dom.window.document.getElementById("root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const activity: SourceAnalysisActivityProps = {
    events: [],
    connected: false,
    terminal: true,
    executionState: null,
    hasOlder: false,
    historyError: false,
    historyLoading: false,
    loadingOlder: false,
    onLoadOlder: () => undefined,
    directDraft: false,
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: makeDetail("source-node-1"),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const { PreparationSourceAnalysisModal } =
      await import("../src/features/admin/components/molecules/preparation-source-analysis-modal");
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(PreparationSourceAnalysisModal, {
            unit: makeUnit("source-node-1", SOURCE_REVIEW_STATES.PENDING),
            context: {
              preparationRunId: "11111111-1111-4111-8111-111111111111",
              legalSourceVersionId: "22222222-2222-4222-8222-222222222222",
              inventoryRevision: 4,
              materializationId: "materialization-4",
              frontierRevision: 3,
            },
            activity,
            onOpenChange: () => undefined,
          }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const tabs = [
      ...dom.window.document.querySelectorAll<HTMLButtonElement>(
        "[role='tab']",
      ),
    ];
    assert.equal(tabs.length, 4);
    assert.equal(tabs[0].getAttribute("aria-selected"), "true");
    const provenanceTab = dom.window.document.getElementById(
      "source-analysis-tab-provenance",
    ) as HTMLButtonElement | null;
    assert.ok(provenanceTab);
    await act(async () => provenanceTab.click());
    assert.equal(provenanceTab.getAttribute("aria-selected"), "true");
    const panel =
      dom.window.document.querySelector<HTMLElement>("[role='tabpanel']");
    assert.match(
      dom.window.document.querySelector("[role='dialog']")?.textContent ?? "",
      /source-node-1/u,
    );
    assert.match(panel?.textContent ?? "", /article-parent/u);
    await act(async () => {
      provenanceTab.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    });
    const workerTab = dom.window.document.getElementById(
      "source-analysis-tab-workerOutput",
    );
    assert.equal(workerTab?.getAttribute("aria-selected"), "true");
    assert.match(panel?.textContent ?? "", /A persisted semantic claim/iu);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    Object.defineProperty(globalThis, "window", {
      value: priorWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: priorDocument,
      configurable: true,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      value: priorHTMLElement,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Element", {
      value: priorElement,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Node", {
      value: priorNode,
      configurable: true,
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      value: priorMutationObserver,
      configurable: true,
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: priorComputedStyle,
      configurable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: priorRequestAnimationFrame,
      configurable: true,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      value: priorCancelAnimationFrame,
      configurable: true,
    });
    globalThis.fetch = priorFetch;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: priorActEnvironment,
      configurable: true,
    });
    dom.window.close();
  }
});

test("Explorer selection opens a modal, labels run events, and resets on run switch", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    {
      url: "http://localhost",
      pretendToBeVisual: true,
    },
  );
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    MutationObserver: globalThis.MutationObserver,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    fetch: globalThis.fetch,
    act: (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT,
  };
  Object.defineProperty(globalThis, "window", {
    value: dom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    value: dom.window.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Element", {
    value: dom.window.Element,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Node", {
    value: dom.window.Node,
    configurable: true,
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    value: dom.window.MutationObserver,
    configurable: true,
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    value: dom.window.getComputedStyle.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: dom.window.requestAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: dom.window.cancelAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });

  const runA = makeRun("11111111-1111-4111-8111-111111111111", 4);
  const runB = makeRun("33333333-3333-4333-8333-333333333333", 7);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    const runId = url.pathname.match(
      /\/preparations\/([^/]+)\/source-units$/u,
    )?.[1];
    const run = runId === runB.preparationRunId ? runB : runA;
    const detailNodeId = url.pathname.match(/\/source-units\/([^/]+)$/u)?.[1];
    if (detailNodeId) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: makeDetail(detailNodeId, run),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const unit = {
      ...makeUnit(
        `source-node-${run === runA ? "a" : "b"}`,
        SOURCE_REVIEW_STATES.PENDING,
      ),
      legalSourceVersionId: run.legalSourceVersionId,
      materializationId: `materialization-${run.sourceAnalysisInventoryRevision}`,
    };
    const data = {
      preparationRunId: run.preparationRunId,
      legalSourceVersionId: run.legalSourceVersionId,
      inventoryRevision: run.sourceAnalysisInventoryRevision,
      materializationId: unit.materializationId,
      frontier: {
        revision: 1,
        fingerprint: `frontier-${run.preparationRunId}`,
        stateFingerprint: `state-${run.preparationRunId}`,
        stateAccumulator: `acc-${run.preparationRunId}`,
        frozenAt: null,
        coverage: {
          total: 1,
          pending: 1,
          inReview: 0,
          reviewedWithClaims: 0,
          reviewedNoClaims: 0,
          blockedReferences: 0,
          persistedClaims: 0,
        },
      },
      units: [unit],
      hasMore: false,
      nextCursor: null,
    };
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const rootElement = dom.window.document.getElementById("root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const activity: SourceAnalysisActivityProps = {
    events: [],
    connected: false,
    terminal: true,
    executionState: null,
    hasOlder: false,
    historyError: false,
    historyLoading: false,
    loadingOlder: false,
    onLoadOlder: () => undefined,
    directDraft: false,
  };
  try {
    const { PreparationSourceAnalysisExplorer } =
      await import("../src/features/admin/components/organisms/preparation-source-analysis-explorer");
    function Harness() {
      const [run, setRun] = useState(runA);
      return createElement(
        Fragment,
        null,
        createElement(
          "button",
          {
            type: "button",
            "data-testid": "switch-run",
            onClick: () => setRun(runB),
          },
          "Switch run",
        ),
        createElement(PreparationSourceAnalysisExplorer, {
          key: run.preparationRunId,
          run,
          activity,
        }),
      );
    }
    const findDetailButton = () =>
      [
        ...dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => /view details|xem/iu.test(button.textContent ?? ""));

    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Harness),
        ),
      ),
    );
    await act(async () => {
      await waitForUiCondition(
        () => findDetailButton() !== undefined,
        "source detail action after source units load",
      );
    });
    const openA = findDetailButton();
    assert.ok(openA);
    await act(async () => openA.click());
    assert.ok(dom.window.document.querySelector("[role='dialog']"));
    assert.equal(rootElement.querySelector("[role='tabpanel']"), null);

    const tabs = [
      ...dom.window.document.querySelectorAll<HTMLButtonElement>(
        "[role='tab']",
      ),
    ];
    assert.equal(tabs.length, 4);
    const overview = dom.window.document.getElementById(
      "source-analysis-tab-overview",
    );
    const provenance = dom.window.document.getElementById(
      "source-analysis-tab-provenance",
    ) as HTMLButtonElement | null;
    const worker = dom.window.document.getElementById(
      "source-analysis-tab-workerOutput",
    );
    const technical = dom.window.document.getElementById(
      "source-analysis-tab-technicalEvents",
    ) as HTMLButtonElement | null;
    assert.equal(overview?.getAttribute("aria-selected"), "true");
    assert.ok(provenance && technical);
    await act(async () => provenance.click());
    assert.equal(provenance.getAttribute("aria-selected"), "true");
    await act(async () => {
      provenance.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    });
    assert.equal(worker?.getAttribute("aria-selected"), "true");
    const activePanel = () =>
      dom.window.document.querySelector<HTMLElement>("[role='tabpanel']")
        ?.textContent ?? "";
    assert.match(activePanel(), /A persisted semantic claim\./u);
    assert.doesNotMatch(
      activePanel(),
      /analysis complete|completed successfully/iu,
    );
    await act(async () => technical.click());
    assert.match(activePanel(), /Preparation/iu);
    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    assert.equal(dom.window.document.querySelector("[role='dialog']"), null);

    await act(async () =>
      (
        dom.window.document.querySelector(
          "[data-testid='switch-run']",
        ) as HTMLButtonElement
      ).click(),
    );
    await act(async () => {
      await waitForUiCondition(
        () =>
          rootElement.textContent?.includes("source-node-b") === true &&
          rootElement.textContent.includes("source-node-a") === false &&
          dom.window.document.querySelector("[role='dialog']") === null,
        "run switch to clear prior source selection",
      );
    });
    assert.equal(dom.window.document.querySelector("[role='dialog']"), null);
    assert.equal(rootElement.textContent?.includes("source-node-a"), false);
    assert.match(rootElement.textContent ?? "", /source-node-b/u);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    Object.defineProperty(globalThis, "window", {
      value: saved.window,
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: saved.document,
      configurable: true,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      value: saved.HTMLElement,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Element", {
      value: saved.Element,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Node", {
      value: saved.Node,
      configurable: true,
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      value: saved.MutationObserver,
      configurable: true,
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: saved.getComputedStyle,
      configurable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: saved.requestAnimationFrame,
      configurable: true,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      value: saved.cancelAnimationFrame,
      configurable: true,
    });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: saved.act,
      configurable: true,
    });
    globalThis.fetch = saved.fetch;
    dom.window.close();
  }
});

async function waitForUiCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

function makeRun(
  preparationRunId: string,
  revision: number,
): RuleSetPreparationRow {
  return {
    preparationRunId,
    legalSourceVersionId:
      revision === 4
        ? "22222222-2222-4222-8222-222222222222"
        : "44444444-4444-4444-8444-444444444444",
    executionState: "SUCCEEDED",
    ruleSetVersionId: null,
    legalSourceVersion: "1.0",
    createdAt: "2026-11-15T00:00:00.000Z",
    completedAt: null,
    failureReason: null,
    attempt: 1,
    requestedBy: "admin",
    retryable: false,
    sourceAnalysisInventoryRevision: revision,
    draft: {
      sourceDocuments: [{ documentId: "document-1", title: "Official source" }],
    },
  } as unknown as RuleSetPreparationRow;
}

function makeDetail(
  sourceNodeId: string,
  run = makeRun("11111111-1111-4111-8111-111111111111", 4),
): PreparationSourceUnitDetailResponse {
  const claimId = `claim-${sourceNodeId}`;
  const claimState =
    sourceReviewPayloadSchema.shape.claims.element.shape.state.options[0];
  return {
    preparationRunId: run.preparationRunId,
    inventoryRevision: run.sourceAnalysisInventoryRevision ?? 4,
    legalSourceVersionId: run.legalSourceVersionId,
    materializationId: `materialization-${run.sourceAnalysisInventoryRevision}`,
    sourceNodeId,
    documentId: "document-1",
    nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
    parentNodeId: "article-parent",
    structuralPath: `Article 4/${sourceNodeId}`,
    ordinal: 4,
    label: sourceNodeId,
    title: sourceNodeId,
    ancestors: [
      {
        sourceNodeId: "article-parent",
        nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
        structuralPath: "Article 4",
        ordinal: 4,
        label: "Article 4",
        title: "Article 4",
      },
    ],
    review: {
      state: SOURCE_REVIEW_STATES.REVIEWED_WITH_CLAIMS,
      disposition: SOURCE_REVIEW_DISPOSITIONS.CLAIMS_AUTHORED,
      reason: null,
      reasonTruncated: false,
      completedAt: "2026-11-14T00:00:00.000Z",
      claimCount: 1,
      claimIds: [claimId],
      claimIdsTruncated: false,
      referenceCount: 0,
      referenceIds: [],
      referenceIdsTruncated: false,
      blockedReferenceCount: 0,
      blockedReferenceIds: [],
      blockedReferenceIdsTruncated: false,
    },
    output: {
      availability: SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE,
      claims: [
        {
          claimId,
          legalSourceVersionId: run.legalSourceVersionId,
          sourceNodeIds: [sourceNodeId],
          sourceNodeIdsTruncated: false,
          claimType: LEGAL_SEMANTIC_CLAIM_TYPES.DUTY,
          statement: "A persisted semantic claim.",
          state: claimState,
          nonOperativeReason: null,
          sourceSupport: [
            {
              nodeId: sourceNodeId,
              startOffset: 0,
              endOffset: 10,
              contentSha256: "d".repeat(64),
            },
          ],
          sourceSupportTruncated: false,
        },
      ],
      claimsTruncated: false,
      identities: { [claimId]: "e".repeat(64) },
      identitiesTruncated: false,
      relations: [],
      relationsTruncated: false,
      referenceAccounting: [],
      referenceAccountingTruncated: false,
    },
    provenance: {
      directClaimIds: [claimId],
      requirementRuleMapping: {
        availability: SOURCE_UNIT_DETAIL_AVAILABILITY.UNAVAILABLE,
        unavailableReason:
          SOURCE_UNIT_DETAIL_MAPPING_REASONS.RULE_SET_NOT_SUBMITTED,
        associations: [],
        associationsTruncated: false,
      },
    },
  };
}
