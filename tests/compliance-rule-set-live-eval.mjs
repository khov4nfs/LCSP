// Run: node tests/compliance-rule-set-live-eval.mjs   (needs a built API and provider credentials in .env)
// COMPLIANCE_RULE_SET LIVE semantic run: the REAL Rule Set Preparation agent with the CONFIGURED model reads the pinned
// synthetic fixture legalSource (real text + real hashes) and submits to the REAL API / PostgreSQL.
// It spends real provider tokens (default route) and writes the result for rubric REVIEW; it does
// not itself judge legal quality.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { root, runPython, startStack, workerKey } from "./support/compliance-rule-set-stack.mjs";

const database = "lcsp_compliance_rule_set_live";
const apiPort = Number(process.env.LCSP_RULE_SET_PREPARATION_EVAL_API_PORT ?? 3412);
const outDir = path.join(root, "reports", "compliance_rule_set-live-eval");
const tests = path.join(root, "deepagents/tests/vertical");
const timeoutMs = Number(process.env.LCSP_RULE_SET_PREPARATION_EVAL_TIMEOUT_MS ?? 20 * 60 * 1000);

const fixture = await runPython(path.join(tests, "fixture_chunks.py"), []);
const stack = await startStack({ database, apiPort });
try {
  const legalSourceId = await stack.seedLegalSource({
    name: "live-synthetic-v1",
    status: "ACTIVE",
    documentId: fixture.documentId,
    chunks: fixture.chunks,
  });
  const started = await stack.activateLegalSource(legalSourceId);
  const runId = started.preparationRunId;
  const usageFile = path.join(mkdtempSync(path.join(tmpdir(), "lcsp-compliance_rule_set-live-")), "usage.json");

  const result = await Promise.race([
    runPython(path.join(tests, "live_preparation.py"), [stack.base, workerKey, runId, usageFile]),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`live run exceeded ${timeoutMs} ms`)), timeoutMs)),
  ]);
  const usage = JSON.parse(readFileSync(usageFile, "utf8"));

  const run = (await stack.q(`SELECT "executionState","failureReason" FROM "RuleSetPreparationRun" WHERE id=$1`, [runId])).rows[0];
  const active = await stack.get("active");
  const invalid = (await stack.q(`SELECT "validationFailures" FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=$1`, [runId])).rows[0];

  mkdirSync(outDir, { recursive: true });
  const output = {
    generatedAt: new Date().toISOString(),
    model: usage.profileKey,
    usage,
    runId,
    run,
    result,
    activeRuleSet: active.status === 200 ? active.body.data : null,
    validationFailures: invalid?.validationFailures ?? null,
    fixtureChunks: fixture.chunks.map((c) => ({ locator: c.locator, content: c.content })),
  };
  writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ model: usage.profileKey, usage, run, state: result.state, failureReason: result.failureReason, activated: active.status === 200 }));
} finally {
  await stack.stop();
}
