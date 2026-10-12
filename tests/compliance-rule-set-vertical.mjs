// Run: node tests/compliance-rule-set-vertical.mjs   (needs a built API: pnpm --dir apps/api run build)
// COMPLIANCE_RULE_SET legalSource -> rule set vertical on REAL components: a fresh migrated PostgreSQL database on the
// loopback test container (default 55441), the REAL built API process over HTTP, and the REAL
// Python Rule Set Preparation agent + WorkerApiClient. Only the model is scripted (provider-free), so
// this proves plumbing, authority, atomicity and concurrency - NOT legal-reading quality.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_FAILURE_REASONS,
} from "@lcsp/contracts/compliance-rule-set";

import {
  contentHash,
  root,
  runPython as runPythonScript,
  startStack,
  workerKey,
} from "./support/compliance-rule-set-stack.mjs";

const database = "lcsp_compliance_rule_set_vertical";
const apiPort = Number(process.env.LCSP_COMPLIANCE_RULE_SET_TEST_API_PORT ?? 3411);
let checks = 0;
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

const LOCATORS = [
  "art-1",
  "art-1::cl-1",
  "art-2",
  "art-2::cl-1",
  "art-3",
  "art-3::cl-1",
  "art-4",
  "art-4::cl-1",
  "art-4::cl-1::pt-a",
  "art-5",
  "art-5::cl-1",
  "art-5::cl-1::pt-a",
  "art-5::cl-1::pt-b",
  "art-6",
  "art-6::cl-1",
];
const DOC = "SYNTHETIC-NOTICE-INSTRUMENT";
const contentFor = (locator, variant) =>
  `content ${locator}${variant === "b" && locator === "art-5::cl-1" ? " v2" : ""}`;

const { q, base, post, get, stop, seedLegalSource, activateLegalSource } = await startStack({
  database,
  apiPort,
});

try {
  // ---- seed: two pinned corpora (B changes art-5::cl-1) with valid retrieval indexes -------------
  const seed = (name, variant, status) =>
    seedLegalSource({
      name,
      status,
      documentId: DOC,
      chunks: LOCATORS.map((locator) => {
        const content = contentFor(locator, variant);
        return { locator, content, contentSha256: contentHash(content) };
      }),
    });
  // Every Legal Source is ACTIVE (ACTIVE) when its activation event arrives; each scenario below
  // that needs its own automatic preparation gets its own source, since one source has one run.
  let sourceCounter = 0;
  const freshSource = (variant) => seed(`vertical-${variant}-${(sourceCounter += 1)}`, variant, "ACTIVE");
  const legalSourceA = await freshSource("a");
  const legalSourceB = await freshSource("b");
  const seedDir = mkdtempSync(
    path.join(tmpdir(), "lcsp-compliance_rule_set-vertical-"),
  );
  const seedFile = path.join(seedDir, "seed.json");
  writeFileSync(
    seedFile,
    JSON.stringify({
      hashes: Object.fromEntries(
        LOCATORS.map((l) => [l, contentHash(contentFor(l, "a"))]),
      ),
    }),
  );

  const runPython = (runId, mode) =>
    runPythonScript(
      path.join(root, "deepagents/tests/vertical/scripted_preparation.py"),
      [base, workerKey, runId, seedFile, mode],
    );
  /** The Legal Source activation event reaches the real consumer: it starts the one automatic run. */
  const startRun = async (legalSourceId) => {
    const delivery = await activateLegalSource(legalSourceId);
    eq(delivery.failed, 0, JSON.stringify(delivery));
    eq(delivery.runs.length, 1, "one source -> one automatic run");
    return { preparationRunId: delivery.runs[0].id, executionState: delivery.runs[0].executionState };
  };
  const activeIds = async () =>
    (
      await q(
        `SELECT id FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"='ACTIVE'`,
      )
    ).rows.map((r) => r.id);
  const run = async (id) =>
    (
      await q(
        `SELECT "executionState","failureReason" FROM "RuleSetPreparationRun" WHERE id=$1`,
        [id],
      )
    ).rows[0];

  // 1. worker authentication
  eq((await post("submissions", {}, null)).status, 401);
  eq(
    (await post("submissions", {}, "wrong-key-wrong-key-wrong-key-wrong-key"))
      .status,
    401,
  );
  eq((await get("active", null)).status, 401);
  eq(
    (await get("active")).body.problem.code,
    "ACTIVE_COMPLIANCE_RULE_SET_NOT_FOUND",
  );

  // 2. there is NO route that starts a preparation; the activation event does, exactly once
  eq(
    (await post("preparations", { legalSourceVersionId: legalSourceA, idempotencyKey: "any-key-12" })).status,
    404,
    "the worker API exposes no start route",
  );
  const replayed = await activateLegalSource(legalSourceA, { times: 6, concurrent: true });
  eq(replayed.failed, 0, JSON.stringify(replayed));
  eq(replayed.runs.length, 1, "replayed + concurrent deliveries -> one logical run");
  eq(replayed.runs[0].requestedBy, "rule-set-preparation-system", "automatic start is system-owned");
  eq(replayed.runs[0].idempotencyKey, `rule-set-preparation:${legalSourceA}:attempt:1`);
  eq(
    (await q(`SELECT count(*)::int AS n FROM "OutboxMessage" WHERE "aggregateId"=$1 AND "eventType"='command.compliance-rule-set.preparation.requested.v1'`, [legalSourceA])).rows[0].n,
    1,
    "exactly one paid preparation command for one activation",
  );
  const superseded = await seed("vertical-superseded", "a", "SUPERSEDED");
  eq((await activateLegalSource(superseded)).runs.length, 0, "a superseded source is never prepared");
  eq((await activateLegalSource(randomUUID())).runs.length, 0, "an unknown source is never prepared");
  const runA = { preparationRunId: replayed.runs[0].id, executionState: replayed.runs[0].executionState };
  eq(runA.executionState, "QUEUED");

  // 3. REAL agent + client + API: legalSource -> rule set -> automatic activation
  const first = await runPython(runA.preparationRunId, "valid");
  eq(first.state, "SUCCEEDED", JSON.stringify(first));
  eq(first.submission.lifecycleState, "ACTIVE");
  eq(first.submission.validation, { outcome: "PASSED", failures: [] });
  eq(await activeIds(), [first.submission.ruleSetVersionId]);
  eq(await run(runA.preparationRunId), {
    executionState: "SUCCEEDED",
    failureReason: null,
  });
  const counts = (
    await q(
      `SELECT (SELECT count(*)::int FROM "LegalRequirement" WHERE "ruleSetVersionId"=$1) AS rules,
              (SELECT count(*)::int FROM "AssessmentRule" WHERE "ruleSetVersionId"=$1) AS engineering,
              (SELECT count(*)::int FROM "LegalRequirementContextRelation" WHERE "ruleSetVersionId"=$1) AS relations,
              (SELECT count(*)::int FROM "LegalRequirementProvenance" WHERE "ruleSetVersionId"=$1) AS provenance`,
      [first.submission.ruleSetVersionId],
    )
  ).rows[0];
  eq(
    {
      rules: counts.rules,
      engineering: counts.engineering,
      relations: counts.relations,
    },
    { rules: 5, engineering: 3, relations: 2 },
  );
  ok(counts.provenance >= 7, "every leaf provision has provenance");
  const events = (
    await q(
      `SELECT "eventType" FROM "OutboxMessage" WHERE "aggregateId" = ANY($1) ORDER BY "createdAt"`,
      [[first.submission.ruleSetVersionId, legalSourceA]],
    )
  ).rows.map((r) => r.eventType);
  eq(events.sort(), [
    "command.compliance-rule-set.preparation.requested.v1",
    "event.compliance-rule-set.activated.v1",
  ]);

  // 4. the single runtime reader
  const active = await get("active");
  eq(active.status, 200);
  eq(active.body.data.ruleSetVersionId, first.submission.ruleSetVersionId);
  eq(active.body.data.legalSourceVersionId, legalSourceA);
  eq(
    [
      active.body.data.legalRequirements.length,
      active.body.data.assessmentRules.length,
    ],
    [5, 3],
  );
  ok(active.body.data.assessmentRules.every((r) => r.sources.length > 0));
  eq(
    active.body.data.legalRequirements.find((r) => r.legalRequirementId === "LR-PERSON")
      .nonRepositoryDuty,
    true,
  );

  // 5. (the V1 assessment read bridge is retired: assessments pin and read the rule set through
  //    the Assessment Root API, proved by tests/assessment-domain-vertical.mjs)

  // 6. a finished run can never be claimed or re-run
  const again = await runPython(runA.preparationRunId, "valid");
  eq(again.state, "ALREADY_CLAIMED", "a duplicated command stops at the claim: no second paid run");
  eq(again.failureReason, null);
  eq(await activeIds(), [first.submission.ruleSetVersionId]);
  eq(await run(runA.preparationRunId), {
    executionState: "SUCCEEDED",
    failureReason: null,
  });

  // 7. a newer valid rule set supersedes the previous ACTIVE; old rows stay readable and pinned
  const runB = await startRun(legalSourceB);
  const second = await runPython(runB.preparationRunId, "valid");
  eq(second.state, "SUCCEEDED", JSON.stringify(second));
  eq(
    second.submission.previousActiveRuleSetVersionId,
    first.submission.ruleSetVersionId,
  );
  eq(await activeIds(), [second.submission.ruleSetVersionId]);
  eq(
    (
      await q(
        `SELECT "lifecycleState" FROM "ComplianceRuleSetVersion" WHERE id=$1`,
        [first.submission.ruleSetVersionId],
      )
    ).rows[0].lifecycleState,
    "SUPERSEDED",
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "LegalRequirement" WHERE "ruleSetVersionId"=$1`,
        [first.submission.ruleSetVersionId],
      )
    ).rows[0].n,
    5,
  );

  // 8. failed attempts preserve the ACTIVE rule set
  const stale = await runPython(
    (await startRun(await freshSource("b"))).preparationRunId,
    "stale",
  );
  eq(stale.state, "FAILED");
  eq(stale.failureReason, "RULE_SET_VALIDATION_FAILED");
  ok(
    stale.submission.validation.failures.some(
      (f) => f.code === "STALE_SOURCE_HASH",
    ),
    "stale hash rejected",
  );
  const orphanRun = await startRun(await freshSource("b"));
  const orphan = await runPython(orphanRun.preparationRunId, "orphan");
  eq(orphan.state, AGENT_EXECUTION_STATES.FAILED);
  eq(orphan.submission, null);
  eq(orphan.failureReason, RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION);
  const orphanFeedback = orphan.trace.find(
    (step) => step.tool === "validate",
  )?.error;
  ok(
    orphanFeedback?.includes(
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
    ) &&
      orphanFeedback.includes("400") &&
      orphanFeedback.includes("packet.legalRequirements.0.coverage.state"),
    "orphan rejected at the shared contract with field-level 400 feedback",
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=$1`,
        [orphanRun.preparationRunId],
      )
    ).rows[0].n,
    0,
    "contract-invalid packets never persist",
  );
  eq(await activeIds(), [second.submission.ruleSetVersionId]);
  const noSubmit = await startRun(await freshSource("b"));
  const none = await runPython(noSubmit.preparationRunId, "no-submit");
  eq(
    { ...none, trace: undefined },
    {
      state: "FAILED",
      submission: null,
      failureReason: "NO_SUBMISSION",
      trace: undefined,
    },
  );
  eq(none.trace, []);
  eq(await run(noSubmit.preparationRunId), {
    executionState: "FAILED",
    failureReason: "NO_SUBMISSION",
  });
  eq(await activeIds(), [second.submission.ruleSetVersionId]);
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"='INVALID'`,
      )
    ).rows[0].n,
    1,
  );

  // 9. concurrent agent processes: exactly one ACTIVE, consistent supersession chain
  const runs = [];
  for (let index = 0; index < 3; index += 1) runs.push(await startRun(await freshSource("a")));
  const concurrent = await Promise.all(
    runs.map((r) => runPython(r.preparationRunId, "valid")),
  );
  ok(
    concurrent.every((r) => r.state === "SUCCEEDED"),
    JSON.stringify(concurrent),
  );
  const finalActive = await activeIds();
  eq(finalActive.length, 1);
  ok(
    concurrent
      .map((r) => r.submission.ruleSetVersionId)
      .includes(finalActive[0]),
  );
  const previous = concurrent.map(
    (r) => r.submission.previousActiveRuleSetVersionId,
  );
  eq(
    new Set(previous).size,
    previous.length,
    "each activation names a distinct predecessor",
  );

  // 10. global invariants
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "RuleSetPreparationRun" WHERE "executionState" IN ('QUEUED','RUNNING')`,
      )
    ).rows[0].n,
    0,
  );
  eq(
    (
      await q(`SELECT count(*)::int AS n FROM "ComplianceRuleSetActivationRecord" a JOIN "ComplianceRuleSetVersion" p ON p.id=a."ruleSetVersionId"
              WHERE (a."validationOutcome"='PASSED') <> (p."lifecycleState" IN ('ACTIVE','SUPERSEDED'))`)
    ).rows[0].n,
    0,
  );
  eq(
    (await q(`SELECT count(*)::int AS n FROM "LegalSourceActivationRecord"`)).rows[0]
      .n,
    0,
    "no approval row is written or required",
  );

  console.log(
    `PASS: ${checks} COMPLIANCE_RULE_SET vertical checks (real API + PostgreSQL + Python agent; model scripted) on ${database}`,
  );
} finally {
  await stop();
}
