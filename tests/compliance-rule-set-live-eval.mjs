// Run: node tests/compliance-rule-set-live-eval.mjs   (needs a built API and provider credentials in .env)
// COMPLIANCE_RULE_SET LIVE semantic run: the REAL Rule Set Preparation agent with the CONFIGURED model reads the pinned
// legalSource (real text + real hashes) and submits to the REAL API / PostgreSQL. It spends real provider tokens
// (default route). It records phase progress, verifies the full preparation journey against the database and a
// restarted API process, and grades an unfamiliar control source against its frozen oracle anchors; it does not
// itself judge legal quality beyond those anchors.
//
//   LCSP_LIVE_EVAL_FIXTURE=synthetic            (default) the 12-unit synthetic notice instrument
//   LCSP_LIVE_EVAL_FIXTURE=control:<id>         an unfamiliar source from tests/fixtures/semantic-control/<id>.txt
//   LCSP_RULE_SET_PREPARATION_EVAL_TIMEOUT_MS   maximum execution budget (default 60 min; not a correctness mechanism)
//   LCSP_RULE_SET_PREPARATION_EVAL_OUT          output directory (default reports/lcsp360-final-release-20261021)
//   LCSP_LIVE_EVAL_PROVIDER_TIMEOUT_SECONDS     per-request provider timeout for this run (default 600; a request the gateway
//                                               drops would otherwise wait for the 3600 s timeout configured in .env)
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { root, runPython, startStack, workerKey } from "./support/compliance-rule-set-stack.mjs";

const fixtureId = process.env.LCSP_LIVE_EVAL_FIXTURE ?? "synthetic";
const control = fixtureId.startsWith("control:") ? fixtureId.slice("control:".length) : null;
const database = control ? "lcsp_compliance_rule_set_live_control" : "lcsp_compliance_rule_set_live";
const apiPort = Number(process.env.LCSP_RULE_SET_PREPARATION_EVAL_API_PORT ?? (control ? 3413 : 3412));
const outDir = process.env.LCSP_RULE_SET_PREPARATION_EVAL_OUT ?? path.join(root, "reports", "lcsp360-final-release-20261021");
const tests = path.join(root, "deepagents/tests/vertical");
const timeoutMs = Number(process.env.LCSP_RULE_SET_PREPARATION_EVAL_TIMEOUT_MS ?? 60 * 60 * 1000);
const stem = `live-eval-${control ?? "synthetic"}`;

mkdirSync(outDir, { recursive: true });
const progressFile = path.join(outDir, `${stem}.progress.jsonl`);
const traceFile = path.join(outDir, `${stem}.trace.jsonl`);
writeFileSync(progressFile, "");
writeFileSync(traceFile, "");

const fixture = await runPython(path.join(tests, control ? "control_chunks.py" : "fixture_chunks.py"), control ? [control] : []);
const stack = await startStack({ database, apiPort });
let stopped = false;
const stopOnce = async (s) => {
  if (s === stack && stopped) return;
  if (s === stack) stopped = true;
  await s.stop();
};

/** Phase progress, one JSON line per sample, so a long run is observable and a stall is attributable. */
async function sample(runId, t0) {
  const row = (
    await stack.q(
      `SELECT r."executionState" AS state, r."claimPhase" AS phase, f."unitCount", f."pendingCount", f."inReviewCount", f."reviewedWithClaimsCount" AS "withClaims",
              f."reviewedNoClaimsCount" AS "noClaims", f."blockedCount" AS blocked, f."persistedClaimCount" AS claims,
              (SELECT count(*) FROM "RuleSetPreparationSemanticAudit" a WHERE a."preparationRunId"=r.id)::int AS audits
         FROM "RuleSetPreparationRun" r LEFT JOIN "RuleSetPreparationReviewFrontier" f ON f."preparationRunId"=r.id WHERE r.id=$1
        ORDER BY f."inventoryRevision" DESC NULLS LAST LIMIT 1`,
      [runId],
    )
  ).rows[0];
  const line = { t: Math.round((Date.now() - t0) / 1000), ...row };
  appendFileSync(progressFile, JSON.stringify(line) + "\n");
}

/** Verifies preparation steps 3-12 from the persisted state, then reopens the database through a fresh API process. */
async function verifyJourney(runId, result, started) {
  const steps = {};
  const step = (name, ok, detail) => (steps[name] = { ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  const one = async (sql, values = [runId]) => (await stack.q(sql, values)).rows[0];
  step("01_sourceActivated", started.preparationRunId, started.preparationRunId);
  const run = await one(`SELECT "executionState","failureReason","claimPhase" FROM "RuleSetPreparationRun" WHERE id=$1`);
  step("02_runStarted", run, run);
  const f = await one(`SELECT "unitCount","pendingCount","inReviewCount","reviewedWithClaimsCount" AS w,"reviewedNoClaimsCount" AS n,"blockedCount" FROM "RuleSetPreparationReviewFrontier" WHERE "preparationRunId"=$1 ORDER BY "inventoryRevision" DESC LIMIT 1`);
  step("03_allSourceUnitsReviewed", f && f.pendingCount === 0 && f.inReviewCount === 0 && f.w + f.n === f.unitCount, f);
  step("04_blockedReferencesResolved", f && f.blockedCount === 0 && (await one(`SELECT count(*)::int AS c FROM "RuleSetPreparationSourceReview" WHERE "preparationRunId"=$1 AND state IN ('BLOCKED_REFERENCE','REOPENED')`)).c === 0, f?.blockedCount);
  const audits = (await stack.q(`SELECT "sourceNodeId", receipt->>'verdict' AS verdict FROM "RuleSetPreparationSemanticAudit" WHERE "preparationRunId"=$1`, [runId])).rows;
  const withClaims = (await one(`SELECT count(*)::int AS c FROM "RuleSetPreparationSourceReview" WHERE "preparationRunId"=$1 AND state='REVIEWED_WITH_CLAIMS'`)).c;
  step("05_independentAuditsComplete", audits.length >= withClaims && audits.every((a) => a.verdict === "SUPPORTED"), { audits: audits.length, unitsWithClaims: withClaims });
  const inventory = await one(`SELECT revision, fingerprint FROM "RuleSetPreparationClaimInventory" WHERE "preparationRunId"=$1 ORDER BY revision DESC LIMIT 1`);
  step("06_claimInventoryFrozen", inventory?.fingerprint, inventory);
  const version = await one(`SELECT id, version, "lifecycleState" AS state, "validationOutcome" AS outcome, "validationFailures" AS failures, "ruleSetDigest" AS digest, "activatedAt" FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=$1`);
  const counts = version
    ? (await one(`SELECT (SELECT count(*) FROM "LegalRequirement" WHERE "ruleSetVersionId"=$1)::int AS requirements,
                         (SELECT count(*) FROM "AssessmentRule" WHERE "ruleSetVersionId"=$1)::int AS rules,
                         (SELECT count(*) FROM "LegalRequirementClaimBinding" b JOIN "LegalRequirement" l ON l.id=b."legalRequirementRowId" WHERE l."ruleSetVersionId"=$1)::int AS bindings,
                         (SELECT count(*) FROM "ComplianceRuleSetActivationRecord" WHERE "ruleSetVersionId"=$1)::int AS activations`, [version.id]))
    : null;
  step("07_legalRequirementsAuthored", counts?.requirements > 0, counts?.requirements);
  step("08_assessmentRulesAuthored", counts?.rules > 0, counts?.rules);
  step("09_ruleSetValidated", version?.outcome === "PASSED" && (version.failures ?? []).length === 0, version && { outcome: version.outcome, failures: version.failures });
  step("10_versionPersisted", version, version && { id: version.id, version: version.version, digest: version.digest });
  const active = await stack.get("active");
  const activeBody = active.status === 200 ? active.body.data : null;
  step("11_versionActivated", version?.state === "ACTIVE" && counts?.activations === 1 && active.status === 200 && JSON.stringify(activeBody).includes(version.id), { state: version?.state, httpStatus: active.status });
  // Reopen: a fresh API process on the same database must serve the identical active Rule Set.
  await stopOnce(stack);
  const reopened = await startStack({ database, apiPort, resetDatabase: false });
  try {
    const again = await reopened.get("active");
    const sameBody = again.status === 200 && JSON.stringify(again.body.data) === JSON.stringify(activeBody);
    const requirementsAgain = version ? (await reopened.q(`SELECT count(*)::int AS c FROM "LegalRequirement" WHERE "ruleSetVersionId"=$1`, [version.id])).rows[0].c : null;
    step("12_reopenedAndVerified", sameBody && requirementsAgain === counts?.requirements, { httpStatus: again.status, sameActiveBody: sameBody, requirementsAgain });
  } finally {
    await reopened.stop();
  }
  return { steps, counts, version: version && { id: version.id, version: version.version, state: version.state, outcome: version.outcome, digest: version.digest }, complete: Object.values(steps).every((s) => s.ok) && result.state === "SUCCEEDED" };
}

/** Grades the unfamiliar control against its frozen oracle anchors (exact source substrings, never output keywords). */
async function gradeControl(runId, id) {
  const oracle = JSON.parse(readFileSync(path.join(root, "tests/fixtures/semantic-control/oracle.json"), "utf8")).controls[id];
  const inventory = (await stack.q(`SELECT graph FROM "RuleSetPreparationClaimInventory" WHERE "preparationRunId"=$1 ORDER BY revision DESC LIMIT 1`, [runId])).rows[0]?.graph;
  if (!inventory) return { graded: false, reason: "no frozen claim inventory" };
  const nodes = new Map((await stack.q(`SELECT n."nodeId", n.content FROM "LegalDocumentNode" n JOIN "RuleSetPreparationRun" r ON r."legalSourceVersionId"=n."legalSourceVersionId" WHERE r.id=$1`, [runId])).rows.map((n) => [n.nodeId, n.content]));
  const passage = (claim) => (claim.sourceSupport ?? []).map((s) => (nodes.get(s.nodeId) ?? "").slice(s.startOffset, s.endOffset)).join("\n");
  const claimsAt = (anchor) => inventory.claims.filter((c) => passage(c).includes(anchor));
  const facts = oracle.anchors.map((a) => {
    const claims = claimsAt(a.anchor);
    const types = [...new Set(claims.map((c) => c.claimType))];
    const accepted = a.accept ?? [a.force];
    const forbidden = a.forbiddenClaimTypes ?? [];
    const addresseeBad = (a.notAddressee ?? []).some((w) => claims.some((c) => (c.operative?.actor ?? "").toLowerCase().includes(w.toLowerCase())));
    const ok = types.some((t) => accepted.includes(t)) && !types.some((t) => forbidden.includes(t)) && !addresseeBad;
    const target = a.targetsAnchor ? { relationToAnchor: inventory.relations.some((r) => claims.some((c) => c.claimId === r.fromClaimId) && claimsAt(a.targetsAnchor).some((c) => c.claimId === r.toClaimId)) } : {};
    return { force: a.force, anchor: a.anchor, claimTypes: types, ok, observedAlso: (a.observedAlso ?? []).filter((t) => types.includes(t)), ...target };
  });
  const operative = inventory.claims.filter((c) => c.operative).length;
  const bound = oracle.anchors.filter((a) => ["DUTY", "PROHIBITION"].includes(a.force)).length;
  const maxUnits = oracle.maxReviewUnits;
  return { graded: true, terminalOutcome: oracle.terminalOutcome, facts, operativeClaims: operative, noExtraOperativeClaim: operative <= bound, maxReviewUnits: maxUnits };
}

try {
  const legalSourceId = await stack.seedLegalSource({ name: `live-${control ?? "synthetic-v1"}`, status: "ACTIVE", documentId: fixture.documentId, chunks: fixture.chunks });
  const started = await stack.activateLegalSource(legalSourceId);
  const runId = started.preparationRunId;
  const usageFile = path.join(mkdtempSync(path.join(tmpdir(), "lcsp-compliance_rule_set-live-")), "usage.json");
  const t0 = Date.now();
  const poll = setInterval(() => sample(runId, t0).catch(() => undefined), 30_000);
  let result;
  try {
    result = await Promise.race([
      runPython(path.join(tests, "live_preparation.py"), [stack.base, workerKey, runId, usageFile], {
        env: { LCSP_LIVE_TRACE_FILE: traceFile, LLM_PROVIDER_TIMEOUT_SECONDS: process.env.LCSP_LIVE_EVAL_PROVIDER_TIMEOUT_SECONDS ?? "600" },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`live run exceeded ${timeoutMs} ms`)), timeoutMs)),
    ]);
  } catch (error) {
    // An exhausted budget or crashed worker still gets its evidence written (frontier, trace, verdict) instead of vanishing.
    result = { state: "RUN_ABORTED", failureReason: String(error?.message ?? error).slice(0, 600) };
  } finally {
    clearInterval(poll);
    await sample(runId, t0).catch(() => undefined);
  }
  const usage = existsSync(usageFile)
    ? JSON.parse(readFileSync(usageFile, "utf8"))
    : { profileKey: null, modelCalls: null, inputTokens: null, outputTokens: null, seconds: Math.round((Date.now() - t0) / 1000), toolCalls: [] };
  const run = (await stack.q(`SELECT "executionState","failureReason" FROM "RuleSetPreparationRun" WHERE id=$1`, [runId])).rows[0];
  const invalid = (await stack.q(`SELECT "validationFailures" FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=$1`, [runId])).rows[0];
  const grading = control ? await gradeControl(runId, control).catch((error) => ({ graded: false, reason: String(error).slice(0, 300) })) : null;
  const journey = await verifyJourney(runId, result, started);

  const output = {
    generatedAt: new Date().toISOString(), fixture: fixtureId, model: usage.profileKey, usage, runId, run, result, journey, grading,
    validationFailures: invalid?.validationFailures ?? null,
    fixtureChunks: fixture.chunks.map((c) => ({ locator: c.locator, content: c.content })),
  };
  writeFileSync(path.join(outDir, `${stem}.json`), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ fixture: fixtureId, model: usage.profileKey, usage: { modelCalls: usage.modelCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, seconds: usage.seconds }, run, state: result.state, failureReason: result.failureReason, journeyComplete: journey.complete, steps: Object.fromEntries(Object.entries(journey.steps).map(([k, v]) => [k, v.ok])), grading: grading && { graded: grading.graded, facts: grading.facts?.map((f) => `${f.force}:${f.ok}`) } }));
  process.exitCode = journey.complete && (!grading || (grading.graded && grading.noExtraOperativeClaim && grading.facts.every((f) => f.ok))) ? 0 : 1;
} finally {
  await stopOnce(stack);
}
// Child servers and pooled clients can keep the loop alive after the evidence is written; the verdict is in the exit code.
process.exit(process.exitCode ?? 0);
