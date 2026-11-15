import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SOURCE_UNIT_DETAIL_AVAILABILITY,
  SOURCE_UNIT_DETAIL_MAPPING_REASONS,
  preparationSourceUnitDetailResponseSchema,
  preparationSourceUnitsResponseSchema,
  type PreparationSourceUnitDetailResponse,
  type PreparationSourceUnitsResponse,
} from "@lcsp/contracts/compliance-rule-set";
import {
  LEGAL_DOCUMENT_NODE_TYPES,
  SOURCE_REVIEW_STATES,
} from "@lcsp/contracts/legal-source";
import { usePreparationSourceUnitDetailQuery } from "../src/lib/api/compliance-rule-set-queries";
import type {
  PreparationSourceAnalysisContext,
  SourceAnalysisActivityProps,
} from "../src/features/admin/components/molecules/preparation-source-analysis-modal";
import type { RuleSetPreparationRow } from "../src/features/admin/types/compliance-rule-sets.types";

type Unit = PreparationSourceUnitsResponse["units"][number];
type ProbeProps = {
  unit: Unit | null;
  context: PreparationSourceAnalysisContext | null;
  activity: SourceAnalysisActivityProps;
  onOpenChange: (open: boolean) => void;
};

function DetailBoundaryProbe({ unit, context }: ProbeProps) {
  const detail = usePreparationSourceUnitDetailQuery(
    context?.preparationRunId ?? null,
    context?.inventoryRevision ?? null,
    unit?.sourceNodeId ?? null,
  );
  if (!unit || !context) return null;
  return createElement(
    "div",
    {
      role: "dialog",
      "data-testid": "detail-boundary",
      "data-run": context.preparationRunId,
      "data-revision": String(context.inventoryRevision),
      "data-node": unit.sourceNodeId,
      "data-loaded": String(Boolean(detail.data)),
      "data-detail-run": detail.data?.preparationRunId ?? "",
      "data-detail-revision": String(detail.data?.inventoryRevision ?? ""),
      "data-detail-node": detail.data?.sourceNodeId ?? "",
    },
    detail.isPending ? "Loading" : detail.isError ? "Error" : "Detail",
  );
}

mock.module(
  "../src/features/admin/components/molecules/preparation-source-analysis-modal",
  {
    namedExports: {
      PreparationSourceAnalysisModal: DetailBoundaryProbe,
    },
  },
);

test("source detail selection is isolated across run and revision pins", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    {
      url: "http://localhost",
      pretendToBeVisual: true,
    },
  );
  const previous = {
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
  const detailRequests: string[] = [];
  let resolveOldDetail: ((response: Response) => void) | undefined;
  const waitForOldDetail = new Promise<Response>((resolve) => {
    resolveOldDetail = resolve;
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    const runId = url.pathname.match(
      /\/preparations\/([^/]+)\/source-units(?:\/[^/]+)?$/u,
    )?.[1];
    const requestedRevision = Number(url.searchParams.get("inventoryRevision"));
    const run =
      runId === runB.preparationRunId
        ? makeRun(runB.preparationRunId, requestedRevision || 7)
        : runA;
    const detailNodeId = url.pathname.match(/\/source-units\/([^/]+)$/u)?.[1];
    if (detailNodeId) {
      detailRequests.push(url.toString());
      if (run === runA && detailNodeId === "source-node-a") {
        return waitForOldDetail;
      }
      return jsonResponse(makeDetail(detailNodeId, run));
    }
    return jsonResponse(makePage(run));
  };

  const rootElement = dom.window.document.getElementById("root");
  assert.ok(rootElement);
  const root = createRoot(rootElement);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
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
        QueryClientProvider,
        { client: queryClient },
        createElement(
          "div",
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
          createElement(
            "button",
            {
              type: "button",
              "data-testid": "switch-revision",
              onClick: () =>
                setRun({ ...runB, sourceAnalysisInventoryRevision: 8 }),
            },
            "Switch revision",
          ),
          createElement(PreparationSourceAnalysisExplorer, {
            key: `${run.preparationRunId}:${run.sourceAnalysisInventoryRevision ?? "unavailable"}`,
            run,
            activity,
          }),
        ),
      );
    }

    await act(async () => root.render(createElement(Harness)));
    await act(async () =>
      waitFor(
        () => rootElement.textContent?.includes("source-node-a") ?? false,
      ),
    );
    await selectSource("source-node-a", dom.window.document, rootElement);
    const detailA = dom.window.document.querySelector<HTMLElement>(
      "[data-testid='detail-boundary']",
    );
    assert.ok(detailA);
    assert.equal(detailA.dataset.run, runA.preparationRunId);
    assert.equal(detailA.dataset.revision, "4");
    assert.equal(detailA.dataset.node, "source-node-a");
    const requestA = new URL(detailRequests[0]);
    assert.equal(
      requestA.pathname,
      `/api/admin/compliance-rule-sets/preparations/${runA.preparationRunId}/source-units/source-node-a`,
    );
    assert.equal(requestA.searchParams.get("inventoryRevision"), "4");

    await act(async () =>
      dom.window.document
        .querySelector<HTMLButtonElement>("[data-testid='switch-run']")
        ?.click(),
    );
    await act(async () =>
      waitFor(
        () => rootElement.textContent?.includes("source-node-b") ?? false,
      ),
    );
    assert.equal(
      dom.window.document.querySelector("[data-testid='detail-boundary']"),
      null,
    );
    await selectSource("source-node-b", dom.window.document, rootElement);
    await act(async () =>
      waitFor(() => {
        const current = dom.window.document.querySelector<HTMLElement>(
          "[data-testid='detail-boundary']",
        );
        return current?.dataset.loaded === "true";
      }),
    );

    const detailB = dom.window.document.querySelector<HTMLElement>(
      "[data-testid='detail-boundary']",
    );
    assert.ok(detailB);
    assert.equal(detailB.dataset.run, runB.preparationRunId);
    assert.equal(detailB.dataset.revision, "7");
    assert.equal(detailB.dataset.node, "source-node-b");
    assert.equal(detailB.dataset.detailRun, runB.preparationRunId);
    assert.equal(detailB.dataset.detailRevision, "7");
    assert.equal(detailB.dataset.detailNode, "source-node-b");

    await act(async () =>
      dom.window.document
        .querySelector<HTMLButtonElement>("[data-testid='switch-revision']")
        ?.click(),
    );
    await act(async () =>
      waitFor(
        () => rootElement.textContent?.includes("source-node-b") ?? false,
      ),
    );
    assert.equal(
      dom.window.document.querySelector("[data-testid='detail-boundary']"),
      null,
    );
    await selectSource("source-node-b", dom.window.document, rootElement);
    await act(async () =>
      waitFor(() => {
        const current = dom.window.document.querySelector<HTMLElement>(
          "[data-testid='detail-boundary']",
        );
        return (
          current?.dataset.loaded === "true" && current.dataset.revision === "8"
        );
      }),
    );

    assert.ok(resolveOldDetail);
    resolveOldDetail(jsonResponse(makeDetail("source-node-a", runA)));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const current = dom.window.document.querySelector<HTMLElement>(
      "[data-testid='detail-boundary']",
    );
    assert.ok(current);
    assert.equal(current.dataset.run, runB.preparationRunId);
    assert.equal(current.dataset.revision, "8");
    assert.equal(current.dataset.node, "source-node-b");
    assert.equal(current.dataset.detailRun, runB.preparationRunId);
    assert.equal(current.dataset.detailRevision, "8");
    assert.equal(current.dataset.detailNode, "source-node-b");
    assert.ok(
      detailRequests.some(
        (value) => new URL(value).searchParams.get("inventoryRevision") === "8",
      ),
    );
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    globalThis.fetch = previous.fetch;
    Object.defineProperty(globalThis, "window", {
      value: previous.window,
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: previous.document,
      configurable: true,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      value: previous.HTMLElement,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Element", {
      value: previous.Element,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Node", {
      value: previous.Node,
      configurable: true,
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      value: previous.MutationObserver,
      configurable: true,
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: previous.getComputedStyle,
      configurable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: previous.requestAnimationFrame,
      configurable: true,
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      value: previous.cancelAnimationFrame,
      configurable: true,
    });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: previous.act,
      configurable: true,
    });
    dom.window.close();
    mock.restoreAll();
  }
});

async function selectSource(
  sourceNodeId: string,
  document: Document,
  root: HTMLElement,
) {
  await act(async () => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) =>
      /view details|xem/iu.test(candidate.textContent ?? ""),
    );
    assert.ok(button, `Expected a view-details action for ${sourceNodeId}`);
    button.click();
  });
  await act(async () =>
    waitFor(() =>
      Boolean(document.querySelector("[data-testid='detail-boundary']")),
    ),
  );
  assert.match(root.textContent ?? "", new RegExp(sourceNodeId, "u"));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Condition was not met within ${timeoutMs}ms`);
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
    legalSourceVersion: `version-${revision}`,
    createdAt: "2026-11-15T00:00:00.000Z",
    completedAt: null,
    failureReason: null,
    attempt: 1,
    requestedBy: "admin",
    retryable: false,
    sourceAnalysisInventoryRevision: revision,
    draft: { sourceDocuments: [{ documentId: "document-1", title: "Source" }] },
  } as unknown as RuleSetPreparationRow;
}

function makeUnit(sourceNodeId: string, run: RuleSetPreparationRow): Unit {
  return {
    sourceNodeId,
    legalSourceVersionId: run.legalSourceVersionId,
    materializationId: `materialization-${run.sourceAnalysisInventoryRevision}`,
    documentId: "document-1",
    nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
    parentNodeId: null,
    structuralPath: `Article 1/${sourceNodeId}`,
    ordinal: 1,
    label: sourceNodeId,
    title: sourceNodeId,
    ancestors: [],
    state: SOURCE_REVIEW_STATES.PENDING,
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

function makePage(run: RuleSetPreparationRow): PreparationSourceUnitsResponse {
  const unit = makeUnit(
    `source-node-${run.preparationRunId.startsWith("1111") ? "a" : "b"}`,
    run,
  );
  return preparationSourceUnitsResponseSchema.parse({
    preparationRunId: run.preparationRunId,
    legalSourceVersionId: run.legalSourceVersionId,
    inventoryRevision: run.sourceAnalysisInventoryRevision,
    materializationId: unit.materializationId,
    frontier: {
      revision: 1,
      fingerprint: `frontier-${run.preparationRunId}-${run.sourceAnalysisInventoryRevision}`,
      stateFingerprint: `state-${run.preparationRunId}-${run.sourceAnalysisInventoryRevision}`,
      stateAccumulator: `acc-${run.preparationRunId}-${run.sourceAnalysisInventoryRevision}`,
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
  });
}

function makeDetail(
  sourceNodeId: string,
  run: RuleSetPreparationRow,
): PreparationSourceUnitDetailResponse {
  return preparationSourceUnitDetailResponseSchema.parse({
    preparationRunId: run.preparationRunId,
    inventoryRevision: run.sourceAnalysisInventoryRevision,
    legalSourceVersionId: run.legalSourceVersionId,
    materializationId: `materialization-${run.sourceAnalysisInventoryRevision}`,
    sourceNodeId,
    documentId: "document-1",
    nodeType: LEGAL_DOCUMENT_NODE_TYPES.ARTICLE,
    parentNodeId: null,
    structuralPath: `Article 1/${sourceNodeId}`,
    ordinal: 1,
    label: sourceNodeId,
    title: sourceNodeId,
    ancestors: [],
    review: {
      state: SOURCE_REVIEW_STATES.PENDING,
      disposition: null,
      reason: null,
      reasonTruncated: false,
      completedAt: null,
      claimCount: 0,
      claimIds: [],
      claimIdsTruncated: false,
      referenceCount: 0,
      referenceIds: [],
      referenceIdsTruncated: false,
      blockedReferenceCount: 0,
      blockedReferenceIds: [],
      blockedReferenceIdsTruncated: false,
    },
    output: {
      availability: SOURCE_UNIT_DETAIL_AVAILABILITY.EMPTY,
      claims: [],
      claimsTruncated: false,
      identities: {},
      identitiesTruncated: false,
      relations: [],
      relationsTruncated: false,
      referenceAccounting: [],
      referenceAccountingTruncated: false,
    },
    provenance: {
      directClaimIds: [],
      requirementRuleMapping: {
        availability: SOURCE_UNIT_DETAIL_AVAILABILITY.UNAVAILABLE,
        unavailableReason:
          SOURCE_UNIT_DETAIL_MAPPING_REASONS.RULE_SET_NOT_SUBMITTED,
        associations: [],
        associationsTruncated: false,
      },
    },
  });
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
