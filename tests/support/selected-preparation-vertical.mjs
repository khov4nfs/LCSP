// Real Admin auth, canonical catalog, selection, worker HTTP, partial retry and regeneration; no provider calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  LEGAL_RULE_SELECTION_MODES,
  legalRuleCatalogSchema,
  legalRuleSavedSchema,
  legalRulePageSchema,
  legalRuleSelectionResultSchema,
  preparationRuleBatchSchema,
  preparationRuleHistorySchema,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  root,
  runPython,
  workerKey,
  hashSecret,
} from "./compliance-rule-set-stack.mjs";

export async function selectedPreparationVertical({ q, base, sourceId }) {
  const userId = randomUUID(),
    email = `selected-${userId}@preparation.test`;
  const password = "OfflineSelectedPreparationFixturePassword!";
  await q(
    'INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,\'ADMIN\',now())',
    [userId, email, hashSecret(password)],
  );
  const login = await fetch(`${base}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, organization_id: "org-1" }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.session_token;
  const request = async (method, route, body, schema, status = 200) => {
    const response = await fetch(`${base}/admin/legal-rule-catalog${route}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json();
    assert.equal(response.status, status, JSON.stringify(envelope));
    assert.equal(envelope.ok, true);
    return schema.parse(envelope.data);
  };
  const catalog = await request(
    "POST",
    "",
    { version: `selected-${randomUUID()}`, legalSourceVersionId: sourceId },
    legalRuleCatalogSchema,
    201,
  );
  let revision = catalog.revision;
  const ids = [];
  for (let index = 1; index <= 3; index += 1) {
    const saved = await request(
      "POST",
      `/${catalog.id}/rules`,
      {
        legalRuleId: `SELECTED-${index}`,
        title: `Human-authored fixture rule ${index}`,
        description: "Canonical editable input, never extracted by chunking",
        citationLocatorRefs: [
          { documentId: "SYNTHETIC-NOTICE-INSTRUMENT", locator: "art-1" },
        ],
        expectedRevision: revision,
      },
      legalRuleSavedSchema,
    );
    ids.push(saved.rule.id);
    revision = saved.catalogRevision;
  }
  const page = await request(
    "GET",
    `/${catalog.id}/rules?limit=1&page=2`,
    undefined,
    legalRulePageSchema,
  );
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 1);
  assert.ok(page.items.every((item) => item.lastResultId === null));
  const selection = await request(
    "POST",
    "/selections",
    {
      catalogVersionId: catalog.id,
      expectedRevision: revision,
      mode: LEGAL_RULE_SELECTION_MODES.ALL_MATCHING,
      filters: { search: "SELECTED-" },
      ruleIds: [],
    },
    legalRuleSelectionResultSchema,
    201,
  );
  assert.equal(
    selection.selectedCount,
    3,
    "Select all resolves the full server result, not one page",
  );
  const explicit = await request(
    "POST",
    "/selections",
    {
      catalogVersionId: catalog.id,
      expectedRevision: revision,
      mode: LEGAL_RULE_SELECTION_MODES.EXPLICIT,
      filters: { search: "" },
      ruleIds: ids.slice(0, 2),
    },
    legalRuleSelectionResultSchema,
    201,
  );
  const submission = {
    selectionId: explicit.selectionId,
    idempotencyKey: randomUUID(),
  };
  const batch = await request(
    "POST",
    "/preparations",
    submission,
    preparationRuleBatchSchema,
    202,
  );
  const duplicate = await request(
    "POST",
    "/preparations",
    submission,
    preparationRuleBatchSchema,
    202,
  );
  assert.equal(duplicate.id, batch.id);
  assert.equal(batch.selected, 2);
  assert.equal(
    (
      await q(
        'SELECT count(*)::int AS n FROM "PreparationRuleResult" r JOIN "PreparationRule" p ON p.id=r."preparationRuleId" WHERE p."legalRuleId"=$1',
        [ids[2]],
      )
    ).rows[0].n,
    0,
  );
  const worker = (item, version, outcome = "SUCCEEDED") =>
    runPython(
      path.join(root, "deepagents/tests/vertical/selected_preparation.py"),
      [base, workerKey, item.preparationRunId, version, outcome],
      { timeoutMs: 60000 },
    );
  const first = batch.items.find((item) => item.ruleId === ids[0]);
  const second = batch.items.find((item) => item.ruleId === ids[1]);
  await worker(first, "one");
  await worker(second, "one", "FAILED");
  const partial = await request(
    "GET",
    `/preparations/${batch.id}`,
    undefined,
    preparationRuleBatchSchema,
  );
  assert.deepEqual(
    [partial.prepared, partial.failed, partial.complete],
    [1, 1, true],
  );
  const retry = await request(
    "POST",
    `/preparations/${batch.id}/retries`,
    { idempotencyKey: randomUUID() },
    preparationRuleBatchSchema,
    202,
  );
  assert.equal(
    retry.items.find((item) => item.ruleId === ids[0]).resultId,
    first.resultId,
  );
  await worker(
    retry.items.find((item) => item.ruleId === ids[1]),
    "one",
  );
  const completed = await request(
    "GET",
    `/preparations/${retry.id}`,
    undefined,
    preparationRuleBatchSchema,
  );
  assert.deepEqual(
    [completed.prepared, completed.failed, completed.complete],
    [2, 0, true],
  );
  const history = () =>
    request(
      "GET",
      `/rules/${ids[0]}/results`,
      undefined,
      preparationRuleHistorySchema,
    );
  const before = await history();
  const regenerated = await request(
    "POST",
    `/rules/${ids[0]}/regenerate`,
    { idempotencyKey: randomUUID(), expectedResultId: before.currentResultId },
    preparationRuleBatchSchema,
    202,
  );
  assert.equal(regenerated.selected, 1);
  await worker(regenerated.items[0], "two");
  const after = await history();
  assert.equal(after.results.length, 2);
  assert.equal(after.currentResultId, after.results[0].id);
  assert.deepEqual(
    after.results[1],
    before.results[0],
    "Previous result remains byte-for-byte inspectable",
  );
  assert.deepEqual(
    after.results[0].input,
    before.results[0].input,
    "Default regeneration preserves exact pins",
  );
  assert.notEqual(
    after.results[0].instructionReceipt.content,
    before.results[0].instructionReceipt.content,
    "Regeneration must capture changed instruction text without a fingerprint",
  );
  assert.equal(
    after.results[0].instructionReceipt.content,
    "Selected preparation instruction two",
  );
  assert.equal(after.results[0].requestedBy, userId);
  assert.equal(
    (
      await q(
        'SELECT count(*)::int AS n FROM "PreparationRuleResult" r JOIN "PreparationRule" p ON p.id=r."preparationRuleId" WHERE p."legalRuleId"=$1',
        [ids[1]],
      )
    ).rows[0].n,
    2,
    "Regeneration did not rerun the other rule",
  );
  assert.equal(
    (
      await q(
        'SELECT count(*)::int AS n FROM "PreparationRuleResult" r JOIN "PreparationRule" p ON p.id=r."preparationRuleId" WHERE p."legalRuleId"=$1',
        [ids[2]],
      )
    ).rows[0].n,
    0,
    "Unselected rule never receives artifacts",
  );
  console.log(
    "PASS: LCSP-369 selected preparation vertical (real Admin auth/API/PostgreSQL/native Python graph; provider-free bulk, partial retry, cache refresh and single regeneration)",
  );
}
