import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/web/src/public/assets/mocks/legal-rule-catalog.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
export const catalogFixtureAdminPrefix = fixture.adminTokenPrefix;
const accounts = new WeakMap();

export async function handleLegalRuleCatalog(
  request,
  response,
  url,
  account,
  { success, problem, readJson },
) {
  const root = "/admin/legal-rule-catalog";
  if (
    request.method === "GET" &&
    url.pathname === "/admin/compliance-rule-sets/groups/pending"
  ) {
    success(response, fixture.emptyGroupingBacklog);
    return true;
  }
  if (request.method === "GET" && url.pathname === "/admin/localization") {
    success(response, fixture.emptyLocalizationBacklog);
    return true;
  }
  if (!url.pathname.startsWith(root)) return false;
  if (!accounts.has(account))
    accounts.set(account, {
      catalogs: [structuredClone(fixture.catalog)],
      rules: fixture.rules.map((rule) => ({
        ...structuredClone(rule),
        catalogVersionId: fixture.catalog.id,
      })),
      selections: new Map(),
      batches: new Map(),
      history: new Map(),
      idempotency: new Map(),
    });
  const state = accounts.get(account);
  const path = url.pathname.slice(root.length);
  if (request.method === "GET" && !path) {
    success(response, state.catalogs);
    return true;
  }
  if (request.method === "POST" && !path) {
    const input = await readJson(request);
    const catalog = {
      ...fixture.catalog,
      ...input,
      id: randomUUID(),
      revision: 1,
    };
    state.catalogs.push(catalog);
    success(response, catalog, 201);
    return true;
  }
  const rulesPath = /^\/([^/]+)\/rules$/.exec(path);
  if (rulesPath) {
    const catalog = state.catalogs.find((row) => row.id === rulesPath[1]);
    if (!catalog) {
      problem(response, 404, "LEGAL_RULE_CATALOG_NOT_FOUND");
      return true;
    }
    if (request.method === "GET") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const filter = url.searchParams.get("state");
      const page = Number(url.searchParams.get("page") ?? 1),
        limit = Number(url.searchParams.get("limit") ?? 50);
      const matching = state.rules.filter(
        (row) =>
          row.catalogVersionId === catalog.id &&
          (!filter || row.state === filter) &&
          `${row.legalRuleId} ${row.title} ${row.description}`
            .toLowerCase()
            .includes(search),
      );
      success(response, {
        catalogVersionId: catalog.id,
        catalogVersion: catalog.version,
        catalogRevision: catalog.revision,
        legalSourceVersionId: catalog.legalSourceVersionId,
        page,
        limit,
        total: matching.length,
        eligibleTotal: matching.filter((row) => !row.ineligibleReason).length,
        items: matching.slice((page - 1) * limit, page * limit),
      });
      return true;
    }
    const input = await readJson(request);
    if (input.expectedRevision !== catalog.revision) {
      problem(response, 409, "LEGAL_RULE_CATALOG_REVISION_STALE");
      return true;
    }
    const existing = state.rules.find(
      (row) =>
        row.catalogVersionId === catalog.id &&
        row.legalRuleId === input.legalRuleId,
    );
    const row = {
      ...fixture.rules[0],
      ...input,
      id: existing?.id ?? randomUUID(),
      catalogVersionId: catalog.id,
    };
    if (existing) Object.assign(existing, row);
    else state.rules.push(row);
    catalog.revision++;
    success(response, { rule: row, catalogRevision: catalog.revision });
    return true;
  }
  if (path === "/selections" && request.method === "POST") {
    const scope = await readJson(request);
    const catalog = state.catalogs.find(
      (row) => row.id === scope.catalogVersionId,
    );
    if (!catalog || catalog.revision !== scope.expectedRevision) {
      problem(response, 409, "LEGAL_RULE_CATALOG_REVISION_STALE");
      return true;
    }
    const selected = state.rules.filter(
      (row) =>
        row.catalogVersionId === catalog.id &&
        !row.ineligibleReason &&
        (scope.mode === "EXPLICIT"
          ? scope.ruleIds.includes(row.id)
          : (!scope.filters.state || row.state === scope.filters.state) &&
            `${row.legalRuleId} ${row.title} ${row.description}`
              .toLowerCase()
              .includes(scope.filters.search.toLowerCase())),
    );
    if (!selected.length) {
      problem(response, 422, "LEGAL_RULE_SELECTION_EMPTY");
      return true;
    }
    const result = {
      selectionId: randomUUID(),
      selectedCount: selected.length,
      ruleIds: selected.map((row) => row.id),
      catalogRevision: catalog.revision,
      scope,
      fingerprint: fixture.inputFingerprint,
    };
    state.selections.set(result.selectionId, result);
    success(response, result, 201);
    return true;
  }
  function makeRevision(ruleId, batchId, options = {}) {
    const rule = state.rules.find((row) => row.id === ruleId);
    const previous = state.history.get(ruleId) ?? [];
    const version = options.regenerate ? 2 : 1;
    const latest = options.latest || !previous.length;
    const catalog = state.catalogs.find(
      (row) => row.id === rule.catalogVersionId,
    );
    const input = latest
      ? {
          ...structuredClone(fixture.input),
          ruleId,
          legalRuleId: rule.legalRuleId,
          title: rule.title,
          description: rule.description,
          catalogVersionId: catalog.id,
          catalogVersion: catalog.version,
          catalogRevision: catalog.revision,
          legalSourceVersionId: catalog.legalSourceVersionId,
        }
      : previous[0].input;
    const result = {
      id: randomUUID(),
      revision: previous.length + 1,
      batchId,
      preparationRunId: randomUUID(),
      executionState: options.fail ? "FAILED" : "SUCCEEDED",
      requestedBy: fixture.actor,
      createdAt: fixture.timestamp,
      startedAt: fixture.timestamp,
      completedAt: fixture.timestamp,
      inputFingerprint: options.latest
        ? fixture.updatedInputFingerprint
        : fixture.inputFingerprint,
      input,
      instructionReceipt: structuredClone(
        version === 2 ? fixture.instruction2 : fixture.instruction1,
      ),
      output: options.fail
        ? null
        : structuredClone(version === 2 ? fixture.output2 : fixture.output1),
      failureCode: options.fail ? fixture.failureCode : null,
    };
    state.history.set(ruleId, [result, ...previous]);
    Object.assign(rule, {
      state: options.fail ? "FAILED" : "PREPARED",
      lastResultId: result.id,
      lastRunId: result.preparationRunId,
      lastOutcome: result.executionState,
    });
    return {
      ruleId,
      resultId: result.id,
      legalRuleId: rule.legalRuleId,
      title: rule.title,
      revision: result.revision,
      preparationRunId: result.preparationRunId,
      executionState: result.executionState,
      failureCode: result.failureCode,
      output: result.output,
      skipped: false,
    };
  }
  function saveBatch(scope, selectionId, members, options = {}) {
    const id = randomUUID();
    const items = members.map((member) =>
      typeof member === "string"
        ? makeRevision(member, id, {
            ...options,
            fail:
              !options.regenerate &&
              !options.retry &&
              state.rules.find((row) => row.id === member)?.legalRuleId ===
                fixture.rules[1].legalRuleId,
          })
        : { ...member, skipped: true },
    );
    const batch = {
      id,
      selectionId,
      requestedBy: fixture.actor,
      createdAt: fixture.timestamp,
      scope,
      selected: items.length,
      prepared: items.filter((row) => row.executionState === "SUCCEEDED")
        .length,
      failed: items.filter((row) => row.executionState === "FAILED").length,
      skipped: items.filter((row) => row.skipped).length,
      complete: true,
      items,
      ruleSet: {
        legalRequirements: items.flatMap(
          (row) => row.output?.legalRequirements ?? [],
        ),
        assessmentRules: items.flatMap(
          (row) => row.output?.assessmentRules ?? [],
        ),
      },
    };
    state.batches.set(id, batch);
    return batch;
  }
  if (path === "/preparations" && request.method === "POST") {
    const input = await readJson(request);
    let batch = state.idempotency.get(input.idempotencyKey);
    if (!batch) {
      const selection = state.selections.get(input.selectionId);
      batch = saveBatch(
        selection.scope,
        selection.selectionId,
        selection.ruleIds,
      );
      state.idempotency.set(input.idempotencyKey, batch);
    }
    success(response, batch, 202);
    return true;
  }
  const retryPath = /^\/preparations\/([^/]+)\/retries$/.exec(path);
  if (retryPath) {
    const input = await readJson(request),
      original = state.batches.get(retryPath[1]);
    let batch = state.idempotency.get(input.idempotencyKey);
    if (!batch) {
      batch = saveBatch(
        original.scope,
        original.selectionId,
        original.items.map((item) =>
          item.executionState === "FAILED" ? item.ruleId : item,
        ),
        { retry: true },
      );
      state.idempotency.set(input.idempotencyKey, batch);
    }
    success(response, batch, 202);
    return true;
  }
  const batchPath = /^\/preparations\/([^/]+)$/.exec(path);
  if (batchPath) {
    success(response, state.batches.get(batchPath[1]));
    return true;
  }
  const historyPath = /^\/rules\/([^/]+)\/results$/.exec(path);
  if (historyPath) {
    const results = state.history.get(historyPath[1]) ?? [];
    success(response, {
      ruleId: historyPath[1],
      currentResultId:
        results.find((row) => row.executionState === "SUCCEEDED")?.id ?? null,
      latestResultId: results[0]?.id ?? null,
      results,
    });
    return true;
  }
  const regeneratePath = /^\/rules\/([^/]+)\/regenerate$/.exec(path);
  if (regeneratePath) {
    const input = await readJson(request),
      ruleId = regeneratePath[1],
      rule = state.rules.find((row) => row.id === ruleId);
    let batch = state.idempotency.get(input.idempotencyKey);
    if (!batch) {
      const catalog = state.catalogs.find(
        (row) => row.id === rule.catalogVersionId,
      );
      batch = saveBatch(
        {
          catalogVersionId: catalog.id,
          expectedRevision: catalog.revision,
          mode: "EXPLICIT",
          filters: { search: "" },
          ruleIds: [ruleId],
        },
        randomUUID(),
        [ruleId],
        { regenerate: true, latest: input.useLatestInputs },
      );
      state.idempotency.set(input.idempotencyKey, batch);
    }
    success(response, batch, 202);
    return true;
  }
  problem(response, 404, "LEGAL_RULE_CATALOG_NOT_FOUND");
  return true;
}
