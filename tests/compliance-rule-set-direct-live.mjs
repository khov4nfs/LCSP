// Owner-authorized direct-draft inference on an isolated copy of the actual legal corpus.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { startStack, root, python, pythonPath, workerKey, sha, hashSecret } from "./support/compliance-rule-set-stack.mjs";
import { importDirectLegalSource } from "./support/import-direct-legal-source.mjs";
import { consumeDirectRuleSet } from "./support/consume-direct-rule-set.mjs";

assert.equal(process.env.LCSP_LIVE_APPROVED, "owner-approved-2026-10-25-acceptance");
const database = process.env.LCSP_LIVE_DATABASE;
assert.match(database ?? "", /^lcsp360_final_direct_[a-z0-9_]+$/);
const evidence = process.env.LCSP_DIRECT_EVIDENCE;
assert.ok(evidence);
mkdirSync(evidence, { recursive: true });
const mode = process.env.LCSP_DIRECT_MODE ?? "article";
assert.ok(["article", "medium", "full"].includes(mode));
const resume = process.env.LCSP_LIVE_RESUME === "1";
const stack = await startStack({ database, apiPort: Number(process.env.LCSP_LIVE_API_PORT ?? 3427), dbPort: 55496, resetDatabase: false, createOnlyDatabase: !resume });
try {
  const email = `${database}@preparation.test`, password = "OfflinePreparationFixturePassword!";
  await stack.q('INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,\'ADMIN\',now()) ON CONFLICT(email) DO NOTHING', [randomUUID(), email, hashSecret(password)]);
  const login = await fetch(`${stack.base}/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, organization_id: "org-1" }) });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.session_token;
  const admin = async (route) => {
    const response = await fetch(`${stack.base}${route}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const body = await response.json();
    assert.ok(response.ok && body.ok, JSON.stringify(body));
    return body.data;
  };
  let preparationRunId, sourceId;
  if (resume && existsSync(path.join(evidence, "identity.json"))) {
    const saved = JSON.parse(readFileSync(path.join(evidence, "identity.json")));
    ({ preparationRunId, sourceId } = saved);
    const state = (await stack.q('SELECT "executionState" FROM "RuleSetPreparationRun" WHERE id=$1', [preparationRunId])).rows[0]?.executionState;
    if (state !== "QUEUED") await admin(`/admin/compliance-rule-sets/preparations/${preparationRunId}/resume`);
  } else {
    const corpus = JSON.parse(readFileSync(process.env.LCSP_LIVE_CORPUS ?? "/tmp/lcsp360-direct-corpus/v4-corpus.json"));
    if (mode !== "full") {
      const articles = mode === "article" ? ["11"] : ["3", "9", "10", "11", "12", "14", "33", "34"];
      const aiLaw = corpus.entries.find((e) => e.document.documentId.includes("134-"));
      const selected = aiLaw.chunks.filter((c) => articles.includes(c.locator.split("::")[0].replace("art-", "")));
      assert.ok(selected.length);
      // The original bytes/hash are retained. This explicit scope uses only verbatim selected source text.
      const exactText = selected.map((c) => c.content).join("\n");
      aiLaw.chunks = selected;
      aiLaw.document.extraction = { ...aiLaw.document.extraction, pages: [exactText], characterCount: exactText.length, textSha256: `sha256:${sha(exactText)}`, acceptanceScope: articles };
      corpus.entries = mode === "article" ? [aiLaw] : [aiLaw, corpus.entries.find((e) => e.document.documentId.includes("71-"))];
      corpus.version.sourceManifest = { ...corpus.version.sourceManifest, acceptanceScope: { kind: "OFFICIAL_ARTICLE_EXCERPT", articles } };
    }
    sourceId = mode === "full" ? await importDirectLegalSource(stack, token, corpus, evidence) : await stack.seedLegalDocuments(corpus);
    await admin(`/admin/legal-source-versions/${sourceId}/activate`);
    const activated = await stack.activateLegalSource(sourceId);
    preparationRunId = activated.preparationRunId;
    assert.ok(preparationRunId);
    writeFileSync(path.join(evidence, "identity.json"), JSON.stringify({ database, sourceId, preparationRunId, mode, apiPort: Number(process.env.LCSP_LIVE_API_PORT ?? 3427) }, null, 2));
  }
  console.log(JSON.stringify({ event: "STARTED", database, sourceId, preparationRunId, mode, evidence }), "\n");
  if (process.env.LCSP_DIRECT_PREPARE_ONLY === "1") process.exitCode = 0;
  else {
  const usageFile = path.join(evidence, `usage-${Date.now()}.json`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, "deepagents/tests/vertical/live_preparation.py"), stack.base, workerKey, preparationRunId, usageFile], {
      cwd: root, env: { ...process.env, PYTHONPATH: pythonPath, LCSP_LIVE_TRACE_FILE: usageFile + ".trace.jsonl", LCSP_RSP_MAX_MODEL_CALLS: process.env.LCSP_RSP_MAX_MODEL_CALLS ?? "50", LCSP_RSP_MAX_INPUT_TOKENS: process.env.LCSP_RSP_MAX_INPUT_TOKENS ?? "2000000" },
    });
    writeFileSync(path.join(evidence, "worker-pid.json"), JSON.stringify({ pid: child.pid, preparationRunId, usageFile }));
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; writeFileSync(path.join(evidence, "worker.log"), stdout); });
    child.stderr.on("data", (data) => { stderr += data; writeFileSync(path.join(evidence, "worker-stderr.log"), stderr); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Worker exited ${code}; see ${evidence}`));
      resolve(JSON.parse(stdout.trim().split("\n").filter((line) => line.startsWith("{")).at(-1)));
    });
  });
  const progress = (await stack.q('SELECT "unitCount","reviewedWithClaimsCount","reviewedNoClaimsCount","pendingCount","blockedCount" FROM "RuleSetPreparationReviewFrontier" WHERE "preparationRunId"=$1', [preparationRunId])).rows;
  const draft = (await stack.q('SELECT "draftVersion",draft FROM "RuleSetPreparationAuthoringDraft" WHERE "preparationRunId"=$1', [preparationRunId])).rows;
  const history = await fetch(`${stack.base}/admin/compliance-rule-sets`, { headers: { authorization: `Bearer ${token}` } });
  const historyBody = await history.json();
  writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ result, progress, draft, history: historyBody, usageFile }, null, 2));
  console.log(JSON.stringify({ event: "FINISHED", preparationRunId, state: result.state, failureReason: result.failureReason, progress, usageFile, evidence }));
  assert.equal(result.state, "SUCCEEDED", JSON.stringify(result));
  const active = (await stack.q('SELECT id FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=$1', [preparationRunId])).rows[0];
  const assessment = await consumeDirectRuleSet(stack, active.id);
  writeFileSync(path.join(evidence, "assessment.json"), JSON.stringify(assessment, null, 2));
  console.log(JSON.stringify({ event: "ASSESSMENT_CONSUMED", ...assessment }));
  }
} finally {
  writeFileSync(path.join(evidence, "api.log"), stack.logs.join(""));
  await stack.stop();
}
