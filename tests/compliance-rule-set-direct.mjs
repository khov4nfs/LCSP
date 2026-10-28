// Genuine NestJS/PostgreSQL/worker HTTP acceptance. No provider calls; legal facts below are explicit fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { startStack, contentHash, root, python, pythonPath, workerKey, hashSecret } from "./support/compliance-rule-set-stack.mjs";
import { consumeDirectRuleSet } from "./support/consume-direct-rule-set.mjs";

const evidence = process.env.LCSP_DIRECT_EVIDENCE ?? "/tmp/lcsp360-direct-http";
mkdirSync(evidence, { recursive: true });
const stack = await startStack({ database: process.env.LCSP_DIRECT_DATABASE ?? `lcsp360_final_direct_http_${Date.now()}`, apiPort: 3426, dbPort: 55496, resetDatabase: false, createOnlyDatabase: true });
try {
  const chunks = [
    { locator: "art-1", content: "Article 1. Definitions\n1. A record is information retained by a provider." },
    { locator: "art-2", content: "Article 2. Data protection\n1. For providers processing health data:\na) Providers must encrypt stored records.\nb) Providers must restrict access to records, except public records." },
    { locator: "art-3", content: "Article 3. External reporting\n1. Providers must deliver a signed report to the competent authority." },
  ];
  const bytes = Buffer.from(chunks.map((c) => c.content).join("\n"));
  const sourceId = await stack.seedLegalSource({ name: "direct-http-" + randomUUID(), status: "ACTIVE", documentId: "DIRECT-FIXTURE", sourceBytes: bytes, sourceSha256: contentHash(bytes), chunks: chunks.map((c) => ({ ...c, contentSha256: contentHash(c.content) })) });
  const { preparationRunId } = await stack.activateLegalSource(sourceId);
  const run = (await stack.q('SELECT "executionContract","targetDate" FROM "RuleSetPreparationRun" WHERE id=$1', [preparationRunId])).rows[0];
  assert.equal(run.executionContract, "DIRECT_DRAFT_V1");
  const support = (locator, quote) => [{ documentId: "DIRECT-FIXTURE", locator, quote }];
  const condition = { statement: "Providers processing health data", support: support("art-2", "For providers processing health data:") };
  const definition = { statement: "A record is information retained by a provider.", support: support("art-1", "A record is information retained by a provider.") };
  const candidates = [
    { candidateId: "encrypt", title: "Encrypt health records", obligations: [{ statement: "Providers processing health data must encrypt stored records.", actor: "Providers", modality: "DUTY", action: "encrypt stored records", support: support("art-2::pt-a", "Providers must encrypt stored records.") }], applicability: { mode: "CONDITIONAL", conditions: [condition] }, qualifiers: [], exceptions: [], definitions: [definition], repositoryAssessability: "REPOSITORY_VERIFIABLE", nonAssessableReason: null, assessmentRule: { assessmentRuleId: "encryption", concept: "Stored record encryption", investigationFocus: "Inspect storage encryption" } },
    { candidateId: "access", title: "Restrict health record access", obligations: [{ statement: "Providers processing health data must restrict access to records.", actor: "Providers", modality: "DUTY", action: "restrict access to records", support: support("art-2::pt-b", "Providers must restrict access to records, except public records.") }], applicability: { mode: "CONDITIONAL", conditions: [condition] }, qualifiers: [], exceptions: [{ statement: "Public records are excepted", support: support("art-2::pt-b", "except public records.") }], definitions: [definition], repositoryAssessability: "REPOSITORY_VERIFIABLE", nonAssessableReason: null, assessmentRule: { assessmentRuleId: "access-control", concept: "Record access controls", investigationFocus: "Inspect record access checks" } },
    { candidateId: "report", title: "Deliver signed report", obligations: [{ statement: "Providers must deliver a signed report to the competent authority.", actor: "Providers", modality: "DUTY", action: "deliver a signed report to the competent authority", support: support("art-3", "Providers must deliver a signed report to the competent authority.") }], applicability: { mode: "UNCONDITIONAL", conditions: [] }, qualifiers: [], exceptions: [], definitions: [], repositoryAssessability: "EXTERNAL_FULFILLMENT", nonAssessableReason: "Delivery of the signed report requires external performance", assessmentRule: null },
  ];
  const manifest = { candidates, noRequirementReasons: { "art-1::cl-1": "Definition of a record; no independent operative duty", "art-2::cl-1": "Source lead-in supplies the applicability conditions retained by the duties", "art-1": "Definition of a record; no independent operative duty", "art-2": "Applicability lead-in retained by the duties", "art-3": "Structural article heading", preamble: "Document identity; no independent operative duty" } };
  const manifestFile = path.join(evidence, "candidates.json");
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const worker = (crash) => new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, "deepagents/tests/vertical/direct_preparation.py"), stack.base, workerKey, preparationRunId, manifestFile], { cwd: root, env: { ...process.env, PYTHONPATH: pythonPath, LCSP_DIRECT_CRASH_AFTER_SAVE: crash ? "1" : "0" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => { writeFileSync(path.join(evidence, crash ? "crash.log" : "resume.log"), stdout + stderr); resolve({ code, stdout, stderr }); });
  });
  const crashed = await worker(true);
  assert.equal(crashed.code, 86, crashed.stdout + crashed.stderr);
  const before = (await stack.q('SELECT draft,"draftVersion" FROM "RuleSetPreparationAuthoringDraft" WHERE "preparationRunId"=$1', [preparationRunId])).rows[0];
  assert.ok(before && before.draftVersion > 0);
  const failure = await stack.post("failures", { preparationRunId, reason: "RUNTIME_ERROR" });
  assert.equal(failure.status, 200, JSON.stringify(failure.body));
  const email = `direct-${randomUUID()}@preparation.test`, password = "OfflinePreparationFixturePassword!";
  await stack.q('INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,\'ADMIN\',now())', [randomUUID(), email, hashSecret(password)]);
  const login = await fetch(`${stack.base}/auth/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, organization_id: "org-1" }) });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.session_token;
  const resumed = await fetch(`${stack.base}/admin/compliance-rule-sets/preparations/${preparationRunId}/resume`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  assert.equal(resumed.status, 202, await resumed.text());
  const completed = await worker(false);
  assert.equal(completed.code, 0, completed.stdout + completed.stderr);
  const active = await stack.get("active");
  assert.equal(active.status, 200);
  assert.equal(active.body.data.legalSourceVersionId, sourceId);
  assert.equal((await stack.q('SELECT "preparationRunId" FROM "ComplianceRuleSetVersion" WHERE id=$1', [active.body.data.ruleSetVersionId])).rows[0].preparationRunId, preparationRunId);
  assert.equal(active.body.data.legalRequirements.length, 3);
  assert.equal(active.body.data.assessmentRules.length, 2);
  const consumed = await consumeDirectRuleSet(stack, active.body.data.ruleSetVersionId);
  assert.equal(consumed.persistedDecisionsCount, 2);
  assert.equal(consumed.resolvedCoverageCount, 2);
  const history = await fetch(`${stack.base}/admin/compliance-rule-sets`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(history.status, 200);
  const historyBody = await history.json();
  assert.equal(historyBody.data.preparations[0].draft.stage, "ACTIVE");
  assert.equal(historyBody.data.preparations[0].draft.assessmentsCanUseRuleSet, true);
  writeFileSync(path.join(evidence, "result.json"), JSON.stringify({ preparationRunId, sourceId, crash: { exitCode: crashed.code, savedVersion: before.draftVersion }, output: active.body.data, history: historyBody.data }, null, 2));
  console.log(JSON.stringify({ result: "PASSED", preparationRunId, requirements: 3, rules: 2, crashResume: "PASSED", evidence }));
} finally {
  writeFileSync(path.join(evidence, "api.log"), stack.logs.join(""));
  await stack.stop();
}
