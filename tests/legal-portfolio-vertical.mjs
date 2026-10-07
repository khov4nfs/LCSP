// Run: node tests/legal-portfolio-vertical.mjs   (needs a built API: pnpm --dir apps/api run build)
// W2 corpus -> portfolio vertical on REAL components: a fresh migrated PostgreSQL database on the
// loopback test container (default 55441), the REAL built API process over HTTP, and the REAL
// Python Legal Preparation agent + WorkerApiClient. Only the model is scripted (provider-free), so
// this proves plumbing, authority, atomicity and concurrency - NOT legal-reading quality.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  contentHash,
  root,
  runPython as runPythonScript,
  startStack,
  workerKey,
} from "./support/legal-portfolio-stack.mjs";

const database = "lcsp_w2_vertical";
const apiPort = Number(process.env.LCSP_W2_API_PORT ?? 3411);
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

const { q, base, post, get, stop, seedCorpus } = await startStack({
  database,
  apiPort,
});

try {
  // ---- seed: two pinned corpora (B changes art-5::cl-1) with valid retrieval indexes -------------
  const seed = (name, variant, status) =>
    seedCorpus({
      name,
      status,
      documentId: DOC,
      chunks: LOCATORS.map((locator) => {
        const content = contentFor(locator, variant);
        return { locator, content, contentSha256: contentHash(content) };
      }),
    });
  const corpusA = await seed("vertical-a", "a", "APPROVED");
  const corpusB = await seed("vertical-b", "b", "SUPERSEDED");
  const seedDir = mkdtempSync(path.join(tmpdir(), "lcsp-w2-vertical-"));
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
  const startRun = async (corpusId, key = `vertical-start-${randomUUID()}`) => {
    const response = await post("preparations", {
      legalCorpusVersionId: corpusId,
      idempotencyKey: key,
    });
    eq(response.status, 202, JSON.stringify(response.body));
    return response.body.data;
  };
  const activeIds = async () =>
    (
      await q(
        `SELECT id FROM "LegalPortfolioVersion" WHERE "lifecycleState"='ACTIVE'`,
      )
    ).rows.map((r) => r.id);
  const run = async (id) =>
    (
      await q(
        `SELECT "executionState","failureReason" FROM "LegalPreparationRun" WHERE id=$1`,
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
    "ACTIVE_LEGAL_PORTFOLIO_NOT_FOUND",
  );

  // 2. start is idempotent per key and conflicts across corpora
  const key = `vertical-start-${randomUUID()}`;
  const runA = await startRun(corpusA, key);
  eq((await startRun(corpusA, key)).preparationRunId, runA.preparationRunId);
  eq(
    (
      await post("preparations", {
        legalCorpusVersionId: corpusB,
        idempotencyKey: key,
      })
    ).status,
    409,
  );
  eq(runA.executionState, "QUEUED");

  // 3. REAL agent + client + API: corpus -> portfolio -> automatic activation
  const first = await runPython(runA.preparationRunId, "valid");
  eq(first.state, "SUCCEEDED", JSON.stringify(first));
  eq(first.submission.lifecycleState, "ACTIVE");
  eq(first.submission.validation, { outcome: "PASSED", failures: [] });
  eq(await activeIds(), [first.submission.portfolioVersionId]);
  eq(await run(runA.preparationRunId), {
    executionState: "SUCCEEDED",
    failureReason: null,
  });
  const counts = (
    await q(
      `SELECT (SELECT count(*)::int FROM "LegalPortfolioRule" WHERE "portfolioVersionId"=$1) AS rules,
              (SELECT count(*)::int FROM "EngineeringRule" WHERE "portfolioVersionId"=$1) AS engineering,
              (SELECT count(*)::int FROM "LegalRuleContextRelation" WHERE "portfolioVersionId"=$1) AS relations,
              (SELECT count(*)::int FROM "LegalRuleProvenance" WHERE "portfolioVersionId"=$1) AS provenance`,
      [first.submission.portfolioVersionId],
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
      [[first.submission.portfolioVersionId, corpusA]],
    )
  ).rows.map((r) => r.eventType);
  eq(events.sort(), [
    "command.legal-portfolio.preparation.requested.v1",
    "event.legal-portfolio.activated.v1",
  ]);

  // 4. the single runtime reader
  const active = await get("active");
  eq(active.status, 200);
  eq(active.body.data.portfolioVersionId, first.submission.portfolioVersionId);
  eq(active.body.data.legalCorpusVersionId, corpusA);
  eq(
    [
      active.body.data.legalRules.length,
      active.body.data.engineeringRules.length,
    ],
    [5, 3],
  );
  ok(active.body.data.engineeringRules.every((r) => r.sources.length > 0));
  eq(
    active.body.data.legalRules.find((r) => r.legalRuleId === "LR-PERSON")
      .nonRepositoryDuty,
    true,
  );

  // 5. (the V1 assessment read bridge is retired: assessments pin and read the portfolio through
  //    the Assessment Root API, proved by tests/assessment-domain-vertical.mjs)

  // 6. a finished run can never be claimed or re-run
  const again = await runPython(runA.preparationRunId, "valid");
  eq(again.failureReason, "CORPUS_UNAVAILABLE");
  eq(await activeIds(), [first.submission.portfolioVersionId]);
  eq(await run(runA.preparationRunId), {
    executionState: "SUCCEEDED",
    failureReason: null,
  });

  // 7. a newer valid portfolio supersedes the previous ACTIVE; old rows stay readable and pinned
  const runB = await startRun(corpusB);
  const second = await runPython(runB.preparationRunId, "valid");
  eq(second.state, "SUCCEEDED", JSON.stringify(second));
  eq(
    second.submission.previousActivePortfolioVersionId,
    first.submission.portfolioVersionId,
  );
  eq(await activeIds(), [second.submission.portfolioVersionId]);
  eq(
    (
      await q(
        `SELECT "lifecycleState" FROM "LegalPortfolioVersion" WHERE id=$1`,
        [first.submission.portfolioVersionId],
      )
    ).rows[0].lifecycleState,
    "SUPERSEDED",
  );
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "LegalPortfolioRule" WHERE "portfolioVersionId"=$1`,
        [first.submission.portfolioVersionId],
      )
    ).rows[0].n,
    5,
  );

  // 8. failed attempts preserve the ACTIVE portfolio
  const stale = await runPython(
    (await startRun(corpusB)).preparationRunId,
    "stale",
  );
  eq(stale.state, "FAILED");
  eq(stale.failureReason, "PORTFOLIO_VALIDATION_FAILED");
  ok(
    stale.submission.validation.failures.some(
      (f) => f.code === "STALE_SOURCE_HASH",
    ),
    "stale hash rejected",
  );
  const orphan = await runPython(
    (await startRun(corpusB)).preparationRunId,
    "orphan",
  );
  ok(
    orphan.submission.validation.failures.some(
      (f) => f.code === "ORPHAN_ENGINEERING_RULE",
    ),
    "orphan rejected",
  );
  const noSubmit = await startRun(corpusB);
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
  eq(await activeIds(), [second.submission.portfolioVersionId]);
  eq(
    (
      await q(
        `SELECT count(*)::int AS n FROM "LegalPortfolioVersion" WHERE "lifecycleState"='INVALID'`,
      )
    ).rows[0].n,
    2,
  );

  // 9. concurrent agent processes: exactly one ACTIVE, consistent supersession chain
  const runs = await Promise.all([1, 2, 3].map(() => startRun(corpusA)));
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
      .map((r) => r.submission.portfolioVersionId)
      .includes(finalActive[0]),
  );
  const previous = concurrent.map(
    (r) => r.submission.previousActivePortfolioVersionId,
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
        `SELECT count(*)::int AS n FROM "LegalPreparationRun" WHERE "executionState" IN ('QUEUED','RUNNING')`,
      )
    ).rows[0].n,
    0,
  );
  eq(
    (
      await q(`SELECT count(*)::int AS n FROM "LegalPortfolioActivationRecord" a JOIN "LegalPortfolioVersion" p ON p.id=a."portfolioVersionId"
              WHERE (a."validationOutcome"='PASSED') <> (p."lifecycleState" IN ('ACTIVE','SUPERSEDED'))`)
    ).rows[0].n,
    0,
  );
  eq(
    (await q(`SELECT count(*)::int AS n FROM "CorpusApprovalRecord"`)).rows[0]
      .n,
    0,
    "no approval row is written or required",
  );

  console.log(
    `PASS: ${checks} W2 vertical checks (real API + PostgreSQL + Python agent; model scripted) on ${database}`,
  );
} finally {
  await stop();
}
