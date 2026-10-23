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
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createLiveEvaluationControls, verifyLiveResourceAdmission, verifyFrozenCandidate, verifyLiveEvaluationAuthorization } from "./support/live-evaluation-controls.mjs";

import { root, runPython, startStack, workerKey } from "./support/compliance-rule-set-stack.mjs";

const fixtureId = process.env.LCSP_LIVE_EVAL_FIXTURE ?? "synthetic";
const control = fixtureId.startsWith("control:") ? fixtureId.slice("control:".length) : null;
const prepareOnly = process.env.LCSP_LIVE_PREPARE_ONLY === "1";
const preparedFile = process.env.LCSP_LIVE_PREPARED_CONTEXT;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const {candidateSha, publicationSha} = verifyFrozenCandidate(root, process.env.LCSP_LIVE_CANDIDATE_SHA);
const key = process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY;
assert.match(key ?? "", /^[a-f0-9]{64}$/);
assert.notEqual(key, "7c".repeat(32), "An ephemeral audit key is required");
const preparedBytes = preparedFile ? readFileSync(preparedFile) : null;
if (preparedBytes) assert.equal(hash(preparedBytes), process.env.LCSP_LIVE_PREPARED_CONTEXT_SHA256, "Prepared context identity changed");
const prepared = preparedBytes ? JSON.parse(preparedBytes) : null;
assert.ok(prepareOnly || prepared, "Prepare a fresh isolated context before live execution");
if (prepared) {
  assert.equal(prepared.candidateSha, candidateSha);
  assert.equal(prepared.fixture, fixtureId);
  assert.equal(prepared.auditKeySha256, hash(Buffer.from(key, "hex")));
}
const database = prepared?.database ?? process.env.LCSP_LIVE_EVAL_DATABASE;
const dbPort = Number(prepared?.dbPort ?? process.env.LCSP_LIVE_EVAL_DB_PORT);
assert.match(database ?? "", /^lcsp360_final_[a-z0-9_]+$/);
assert.ok(Number.isInteger(dbPort) && dbPort >= 55000 && dbPort <= 55999 && ![55441,55502,55503,55504].includes(dbPort), "A new owned evaluation PostgreSQL port is required");
let unrestricted = false;
if (!prepareOnly) {
  const approvalBytes = readFileSync(process.env.LCSP_LIVE_TEST_AUTHORIZATION_FILE);
  assert.equal(hash(approvalBytes), process.env.LCSP_LIVE_TEST_AUTHORIZATION_SHA256);
  const approval = JSON.parse(approvalBytes);
  const budget = JSON.parse(readFileSync(process.env.LCSP_LIVE_BUDGET_FILE));
  ({unrestricted} = verifyLiveEvaluationAuthorization(approval, budget, {
    candidateSha, runId: prepared.runId,
    workerTimeoutMs: Number(process.env.LCSP_RULE_SET_PREPARATION_EVAL_TIMEOUT_MS ?? 3600000),
    providerTimeoutSeconds: Number(process.env.LCSP_LIVE_EVAL_PROVIDER_TIMEOUT_SECONDS ?? 600),
    overallTimeoutMs: Number(process.env.LCSP_LIVE_OVERALL_TIMEOUT_MS ?? 4200000),
  }));
}
const resourceAdmission = verifyLiveResourceAdmission(root);
const supervisor = createLiveEvaluationControls({overallMs:Number(process.env.LCSP_LIVE_OVERALL_TIMEOUT_MS ?? 4200000), unrestricted});
supervisor.checkDisk(root,8*1024**3);
supervisor.enter("PROVISION");
const apiPort = Number(prepared?.apiPort ?? process.env.LCSP_RULE_SET_PREPARATION_EVAL_API_PORT ?? 3459);
const outDir = process.env.LCSP_RULE_SET_PREPARATION_EVAL_OUT ?? path.join(root, "reports", "lcsp360-final-release-20261021");
const tests = path.join(root, "deepagents/tests/vertical");
const timeoutMs = unrestricted ? 0 : Number(process.env.LCSP_RULE_SET_PREPARATION_EVAL_TIMEOUT_MS ?? 60 * 60 * 1000);
const stem = `live-eval-${control ?? "synthetic"}`;

mkdirSync(outDir, { recursive: true });
const progressFile = path.join(outDir, `${stem}.progress.jsonl`);
const traceFile = path.join(outDir, `${stem}.trace.jsonl`);
if (!prepareOnly) {
  writeFileSync(progressFile, "", {flag:"wx"}); writeFileSync(traceFile, "", {flag:"wx"});
}

const fixture = await runPython(path.join(tests, control ? "control_chunks.py" : "fixture_chunks.py"), control ? [control] : [], {timeoutMs:120000,signal:supervisor.signal,ownedProcessGroup:true});
const sourceBytes = Buffer.from(fixture.sourceBytesBase64,"base64");
assert.equal(hash(sourceBytes), fixture.sourceSha256);
if (!control) assert.equal(fixture.sourceSha256,"b69a711386e79d62e287eac4f8c447932c9a5b999e5618e623745b5c9f280cc1");
if (prepared) assert.equal(prepared.sourceSha256,fixture.sourceSha256);
const stack = await startStack({ database, apiPort, dbPort, resetDatabase:false, createOnlyDatabase:prepareOnly,
  operationTimeoutMs:120000, signal:supervisor.signal });
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
  if (row?.phase) supervisor.phase(row.phase);
  supervisor.checkDisk(root);
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
  const reopened = await startStack({ database, apiPort, dbPort, resetDatabase: false, signal:supervisor.signal, operationTimeoutMs:120000 });
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
  supervisor.enter("MATERIALIZE");
  const legalSourceId = prepared?.sourceVersionId ?? await stack.seedLegalSource({ name: `live-${Date.now()}`, status: "ACTIVE", documentId: fixture.documentId, chunks: fixture.chunks,
    sourceBytes, sourceSha256: fixture.sourceSha256 });
  const started = prepared ? {preparationRunId:prepared.runId} : await stack.activateLegalSource(legalSourceId);
  const runId = started.preparationRunId;
  const graph = await stack.materializeLegalSource(legalSourceId);
  const persisted = (await stack.q(`SELECT "executionState","legalSourceVersionId" FROM "RuleSetPreparationRun" WHERE id=$1`,[runId])).rows[0];
  assert.equal(persisted.executionState,"QUEUED","A previously claimed/evaluated run cannot be dispatched again");
  assert.equal(persisted.legalSourceVersionId,legalSourceId);
  if (prepared) {assert.equal(prepared.materializationId,graph.materializationId);assert.equal(prepared.graphDigest,graph.graphDigest);}
  const documents=(await stack.q(`SELECT * FROM "LegalSourceDocument" WHERE "legalSourceVersionId"=$1`,[legalSourceId])).rows;
  const chunks=(await stack.q(`SELECT id AS "chunkId",* FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=$1 ORDER BY locator`,[legalSourceId])).rows;
  assert.equal(documents.length,1);assert.equal(documents[0].sourceSha256,`sha256:${fixture.sourceSha256}`);
  assert.equal(chunks.length,fixture.chunks.length);
  for(const chunk of chunks){assert.equal(chunk.legalSourceDocumentId,documents[0].id);assert.equal(chunk.contentSha256,`sha256:${hash(chunk.content)}`);assert.equal(chunk.legalEffectStatus,"EFFECTIVE");}
  if (prepareOnly) {
    const bundleFile=path.join(outDir,"preflight-bundle.json");
    writeFileSync(bundleFile,JSON.stringify({legalSourceVersionId:legalSourceId,documentGraph:graph,documents:documents.map(d=>({...d,chunks:chunks.filter(c=>c.legalSourceDocumentId===d.id)}))}),{flag:"wx",mode:0o600});
    const proof=await runPython(path.join(tests,"runtime_preflight.py"),[bundleFile,runId],{timeoutMs:120000,signal:supervisor.signal,ownedProcessGroup:true});
    const {attestation,...unsigned}=proof.receipt;
    const digest=hash(JSON.stringify(Object.fromEntries(Object.entries(unsigned).sort(([a],[b])=>a.localeCompare(b)))));
    assert.equal(attestation,"hmac-sha256:"+createHmac("sha256",Buffer.from(key,"hex")).update(`LCSP-SEMANTIC-AUDIT-HMAC-V1\n${runId}\n${digest}`).digest("hex"));
    const counts=(await stack.q(`SELECT (SELECT count(*) FROM "ComplianceRuleSetVersion")::int AS versions,(SELECT count(*) FROM "RuleSetPreparationSemanticAudit")::int AS audits`)).rows[0];
    assert.equal(counts.versions,0);assert.equal(counts.audits,0);
    const context={schemaVersion:1,candidateSha,publicationSha,fixture:fixtureId,database,dbPort,apiPort,sourceVersionId:legalSourceId,runId,
      sourceSha256:fixture.sourceSha256,documentId:fixture.documentId,chunks:chunks.length,materializationId:graph.materializationId,graphDigest:graph.graphDigest,
      resourceAdmission,auditKeySha256:hash(Buffer.from(key,"hex")),executionState:persisted.executionState,proof,paidCalls:0,ruleSetVersions:0};
    const target=path.join(outDir,"prepared-context.json");writeFileSync(target,JSON.stringify(context,null,2)+"\n",{flag:"wx"});
    console.log(JSON.stringify({status:"PREPARED_NO_INFERENCE",contextFile:target,contextSha256:hash(readFileSync(target)),runId,paidCalls:0}));
    await stopOnce(stack);supervisor.close();process.exit(0);
  }
  const usageFile = path.join(mkdtempSync(path.join(outDir, `${stem}.usage-`)), "usage.json");
  const t0 = Date.now();
  supervisor.enter("DISCOVERY_AUDIT");
  const poll = setInterval(() => sample(runId,t0).catch(() => supervisor.abort("PROGRESS_SUPERVISION_FAILED")),1000);
  let result;
  try {
    result = await runPython(path.join(tests, "live_preparation.py"), [stack.base, workerKey, runId, usageFile], {
      timeoutMs, signal:supervisor.signal, ownedProcessGroup:true,
      env: { LCSP_LIVE_TRACE_FILE: traceFile, ...(!unrestricted || process.env.LCSP_LIVE_EVAL_PROVIDER_TIMEOUT_SECONDS ? { LLM_PROVIDER_TIMEOUT_SECONDS: process.env.LCSP_LIVE_EVAL_PROVIDER_TIMEOUT_SECONDS ?? "600" } : {}) },
    });
  } catch (error) {
    // An exhausted budget or crashed worker still gets its evidence written (frontier, trace, verdict) instead of vanishing.
    result = { state: "RUN_ABORTED", failureReason: String(error?.message ?? error).slice(0, 600) };
  } finally {
    clearInterval(poll);
    await sample(runId, t0).catch(() => undefined);
  }
  let usage;
  try {
    usage = await runPython(path.join(tests, "live_preparation.py"), ["--recover-usage", usageFile, runId], {timeoutMs:30000,ownedProcessGroup:true});
  } catch (error) {
    usage = { runId, accountingState: "RECOVERY_FAILED", modelCalls: null, inputTokens: null, outputTokens: null, profileKey: null };
    result = { state: "RUN_ABORTED", failureReason: `durable usage recovery failed: ${String(error).slice(0, 500)}` };
  }
  const accountingComplete = usage.accountingState === "COMPLETE" && usage.modelCalls > 0;
  const run = (await stack.q(`SELECT "executionState","failureReason" FROM "RuleSetPreparationRun" WHERE id=$1`, [runId])).rows[0];
  const invalid = (await stack.q(`SELECT "validationFailures" FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=$1`, [runId])).rows[0];
  const grading = control ? await gradeControl(runId, control).catch((error) => ({ graded: false, reason: String(error).slice(0, 300) })) : null;
  let journey;
  if (supervisor.signal.aborted) journey = {complete:false,steps:{runtimeDeadline:{ok:false,detail:String(supervisor.signal.reason)}}};
  else {supervisor.enter("INDEPENDENT_VERIFY");journey=await verifyJourney(runId,result,started);}

  const output = {
    generatedAt: new Date().toISOString(), fixture: fixtureId, model: usage.profileKey, usage, usageFile, accountingComplete, runId, run, result, journey, grading,
    validationFailures: invalid?.validationFailures ?? null,
    fixtureChunks: fixture.chunks.map((c) => ({ locator: c.locator, content: c.content })),
  };
  writeFileSync(path.join(outDir, `${stem}.json`), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ fixture: fixtureId, model: usage.profileKey, usage: { modelCalls: usage.modelCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, seconds: usage.seconds }, run, state: result.state, failureReason: result.failureReason, journeyComplete: journey.complete, steps: Object.fromEntries(Object.entries(journey.steps).map(([k, v]) => [k, v.ok])), grading: grading && { graded: grading.graded, facts: grading.facts?.map((f) => `${f.force}:${f.ok}`) } }));
  process.exitCode = journey.complete && accountingComplete && (!grading || (grading.graded && grading.noExtraOperativeClaim && grading.facts.every((f) => f.ok))) ? 0 : 1;
} finally {
  await stopOnce(stack);
  supervisor.close();
}
// Child servers and pooled clients can keep the loop alive after the evidence is written; the verdict is in the exit code.
process.exit(process.exitCode ?? 0);
