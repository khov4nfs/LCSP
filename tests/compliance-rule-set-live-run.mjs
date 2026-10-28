// Run: LCSP_LIVE_APPROVED=<owner approval literal> LCSP_LIVE_CHUNKS=<chunks.json> node tests/compliance-rule-set-live-run.mjs
// Needs a built API (pnpm --dir apps/api run build), the loopback test Postgres (LCSP_TEST_PG_PORT, default 55441) and provider keys in .env.
// The vertical journey with the REAL model: Legal Source activation -> automatic run -> the real Preparation agent over HTTP -> Rule Set.
// PAID: bounded by LCSP_RSP_MAX_MODEL_CALLS / LCSP_RSP_MAX_INPUT_TOKENS (the run pauses instead of overspending).
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import {
  contentHash,
  root,
  runPython,
  startStack,
  workerKey,
  sha,
} from "./support/compliance-rule-set-stack.mjs";
import { verifyFrozenCandidate } from "./support/live-evaluation-controls.mjs";

verifyFrozenCandidate(root, process.env.LCSP_LIVE_CANDIDATE_SHA);
assert.equal(
  process.env.LCSP_LIVE_APPROVED,
  "owner-approved-2026-10-25-acceptance",
  "Paid model run refused: owner approval literal missing",
);
// LCSP_LIVE_RESUME=1 continues the run stored in the existing disposable database (after a stop or a budget pause) instead of seeding a new one.
const resume = process.env.LCSP_LIVE_RESUME === "1";
const database = process.env.LCSP_LIVE_DATABASE;
assert.match(
  database ?? "",
  /^lcsp360_final_[a-z0-9_]+$/,
  "Use a named create-only acceptance database",
);
const stack = await startStack({
  database,
  apiPort: Number(process.env.LCSP_LIVE_API_PORT ?? 3412),
  resetDatabase: false,
  createOnlyDatabase: !resume,
});
const calls = [];
const routesFile =
  process.env.LCSP_MODEL_ROUTES_FILE ??
  path.join(root, "deepagents/config/model_routes.yaml");
const runtimeFiles = [
  "deepagents/model_policy.py",
  "deepagents/provider_credentials.py",
  "deepagents/middleware/token_fallback.py",
  "deepagents/middleware/provider_fallback.py",
  "deepagents/middleware/model_governance.py",
  "deepagents/middleware/usage_metering.py",
  "deepagents/orchestration/graph_execution.py",
  "deepagents/rule_set_preparation/agent.py",
  "deepagents/rule_set_preparation/runner.py",
  "deepagents/rule_set_preparation/claim_inventory.py",
  "deepagents/rule_set_preparation/claim_tools.py",
  "deepagents/rule_set_preparation/claim_files.py",
  "deepagents/rule_set_preparation/tools.py",
  "deepagents/rule_set_preparation/legal_source_files.py",
  "deepagents/rule_set_preparation/source_graph.py",
  "deepagents/rule_set_preparation/semantic_closure.py",
  "deepagents/rule_set_preparation/legal_effect.py",
  "deepagents/rule_set_preparation/authoring_recorder.py",
  "deepagents/rule_set_preparation/instructions-common.md",
  "deepagents/rule_set_preparation/instructions-discovery.md",
  "deepagents/rule_set_preparation/instructions-authoring.md",
  "deepagents/tests/vertical/live_preparation.py",
  "apps/api/dist/src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.handler.js",
  "apps/api/dist/src/modules/compliance-rule-set/application/commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js",
  "apps/api/dist/src/modules/compliance-rule-set/application/commands/source-review/source-review.handler.js",
  "apps/api/dist/src/modules/compliance-rule-set/application/commands/resume-rule-set-preparation/resume-rule-set-preparation.handler.js",
  "apps/api/dist/src/modules/compliance-rule-set/domain/source-review-frontier.js",
  "apps/api/dist/src/modules/compliance-rule-set/domain/semantic-claim-integrity.validator.js",
  "apps/api/dist/src/modules/legal-source/domain/document-graph.js",
  "apps/api/dist/src/modules/legal-source/application/services/legal-document-graph.service.js",
  "packages/contracts/src/legal-source/document-graph.ts",
  "packages/contracts/src/compliance-rule-set/semantic-graph.ts",
  "packages/contracts/src/compliance-rule-set/semantic-support.ts",
  "packages/contracts/src/compliance-rule-set/preparation-frontier.ts",
  "packages/contracts/src/compliance-rule-set/preparation-inventory.ts",
  "packages/contracts/src/compliance-rule-set/schemas.ts",
]
  .map((file) => path.join(root, file))
  .concat(routesFile);
const runtimeHashes = () =>
  Object.fromEntries(
    runtimeFiles.map((file) => [file, sha(readFileSync(file))]),
  );
const code = {
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  files: runtimeHashes(),
};
try {
  const { hashSecret } = await import(
    `${root}/apps/api/dist/src/platform/security/crypto.utils.js`
  );
  const email = `${database}@preparation.test`,
    password = "OfflinePreparationFixturePassword!";
  await stack.q(
    `INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,'ADMIN',now()) ON CONFLICT (email) DO NOTHING`,
    [randomUUID(), email, hashSecret(password)],
  );
  const login = await fetch(`${stack.base}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, organization_id: "org-1" }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.session_token;
  const admin = async (route) => {
    const response = await fetch(`${stack.base}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    calls.push({ method: "POST", route, status: response.status });
    assert.ok(response.ok && result.ok, JSON.stringify(result));
    return result.data;
  };
  let preparationRunId;
  if (resume) {
    preparationRunId = (
      await stack.q(
        `SELECT id FROM "RuleSetPreparationRun" ORDER BY "createdAt" DESC LIMIT 1`,
      )
    ).rows[0].id;
    await admin(
      `/admin/compliance-rule-sets/preparations/${preparationRunId}/resume`,
    );
  } else if (process.env.LCSP_LIVE_CORPUS) {
    const corpus = JSON.parse(
      readFileSync(process.env.LCSP_LIVE_CORPUS, "utf8"),
    );
    const sourceId = await stack.seedLegalDocuments(corpus);
    await admin(`/admin/legal-source-versions/${sourceId}/activate`);
    // The isolated stack leaves outbox messages pending; dispatch through its real consumer seam.
    await stack.activateLegalSource(sourceId);
    preparationRunId = (
      await stack.q(
        `SELECT id FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId"=$1`,
        [sourceId],
      )
    ).rows[0]?.id;
  } else {
    const chunks = JSON.parse(
      readFileSync(process.env.LCSP_LIVE_CHUNKS, "utf8"),
    );
    assert.ok(
      chunks.length,
      "LCSP_LIVE_CHUNKS must list {documentId, locator, content} chunks",
    );
    const sourceBytes = Buffer.from(
      chunks.map((c) => c.content).join("\n") + "\n",
      "utf8",
    );
    const legalSourceId = await stack.seedLegalSource({
      name: `live-${Date.now()}`,
      status: "ACTIVE",
      documentId: chunks[0].documentId,
      sourceBytes,
      sourceSha256: contentHash(sourceBytes),
      chunks: chunks.map((c) => ({
        locator: c.locator,
        content: c.content,
        contentSha256: contentHash(c.content),
      })),
    });
    ({ preparationRunId } = await stack.activateLegalSource(legalSourceId));
  }
  assert.ok(preparationRunId, "activation must start one automatic run");
  const usageFile = path.join(
    mkdtempSync(path.join(tmpdir(), "lcsp-live-run-")),
    "usage.json",
  );
  const started = Date.now();
  console.log(
    JSON.stringify({
      event: "STARTED",
      database,
      preparationRunId,
      usageFile,
      calls,
      code,
    }),
  );
  const result = await runPython(
    path.join(root, "deepagents/tests/vertical/live_preparation.py"),
    [stack.base, workerKey, preparationRunId, usageFile],
    {
      timeoutMs: Number(process.env.LCSP_LIVE_TIMEOUT_MS ?? 5_400_000),
      env: {
        LCSP_LIVE_TRACE_FILE: `${usageFile}.trace.jsonl`,
        LCSP_MODEL_ROUTES_FILE: routesFile,
      },
      ownedProcessGroup: true,
    },
  );
  writeFileSync(`${usageFile}.result.json`, JSON.stringify(result, null, 1));
  const counts = (
    await stack.q(
      `SELECT (SELECT count(*)::int FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=$1) AS versions,
              (SELECT count(*)::int FROM "LegalRequirement" r JOIN "ComplianceRuleSetVersion" v ON v.id=r."ruleSetVersionId" WHERE v."preparationRunId"=$1) AS requirements,
              (SELECT count(*)::int FROM "AssessmentRule" a JOIN "ComplianceRuleSetVersion" v ON v.id=a."ruleSetVersionId" WHERE v."preparationRunId"=$1) AS rules,
              (SELECT "executionState" FROM "RuleSetPreparationRun" WHERE id=$1) AS state,
              (SELECT "failureReason" FROM "RuleSetPreparationRun" WHERE id=$1) AS failure,
              (SELECT count(*)::int FROM "AssessmentRuntimeEvent" WHERE "preparationRunId"=$1) AS "streamEvents",
              (SELECT count(*)::int FROM (SELECT b."claimId" FROM "LegalRequirementClaimBinding" b JOIN "ComplianceRuleSetVersion" v ON v.id=b."ruleSetVersionId" WHERE v."preparationRunId"=$1 AND b.role='OPERATIVE_PROPOSITION' GROUP BY b."claimId" HAVING count(DISTINCT b."legalRequirementRowId")>1) duplicates) AS "duplicateOperativeOwners"`,
      [preparationRunId],
    )
  ).rows[0];
  const coverage = (
    await stack.q(
      `SELECT f."unitCount" AS total, f."reviewedWithClaimsCount"+f."reviewedNoClaimsCount" AS reviewed,
      f."pendingCount"+f."blockedCount"+f."inReviewCount" AS remaining, f."persistedClaimCount" AS claims
      FROM "RuleSetPreparationReviewFrontier" f JOIN "RuleSetPreparationRun" r ON r.id=f."preparationRunId" AND r."claimInventoryRevision"=f."inventoryRevision" WHERE r.id=$1`,
      [preparationRunId],
    )
  ).rows[0];
  console.log(
    JSON.stringify(
      {
        minutes: Math.round((Date.now() - started) / 600) / 100,
        usageFile,
        resultFile: `${usageFile}.result.json`,
        agent: {
          state: result.state,
          failureReason: result.failureReason,
          submission: result.submission,
        },
        database: counts,
        calls,
        coverage,
        code,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(
    runtimeHashes(),
    code.files,
    "Runtime code changed during this pass",
  );
  assert.equal(
    result.state,
    "SUCCEEDED",
    "Incomplete evaluation; preserve the database and repair before acceptance",
  );
  assert.equal(result.submission?.validation?.outcome, "PASSED");
  assert.equal(result.submission?.lifecycleState, "ACTIVE");
  assert.equal(counts.versions, 1);
  assert.equal(counts.duplicateOperativeOwners, 0);
  assert.equal(coverage.remaining, 0);
  assert.equal(coverage.reviewed, coverage.total);
  assert.ok(
    counts.streamEvents > 0,
    "Real execution telemetry must be persisted",
  );
} finally {
  await stack.stop();
}
