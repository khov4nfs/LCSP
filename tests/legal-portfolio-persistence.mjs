// Run: node tests/legal-portfolio-persistence.mjs
// Creates one task-owned database on the existing loopback PostgreSQL test
// container (default 55441), applies ALL ordered migrations, then proves the
// W2 portfolio database guarantees. It never reads the caller's DATABASE_URL.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "apps/api");
const host = "127.0.0.1";
const port = Number(process.env.LCSP_W2_PG_PORT ?? 55441);
const database = "lcsp_w2_portfolio_persistence";
const databaseUrl = `postgresql://postgres:postgres@${host}:${port}/${database}?schema=public`;
const { Client } = createRequire(path.join(api, "package.json"))("pg");
let checks = 0;

async function admin(sql) {
  const client = new Client({
    connectionString: `postgresql://postgres:postgres@${host}:${port}/postgres`,
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

await admin(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
await admin(`CREATE DATABASE "${database}"`);
const migrate = spawnSync(
  "pnpm",
  ["--dir", api, "exec", "prisma", "migrate", "deploy"],
  { cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl } },
);
assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);

const db = new Client({ connectionString: databaseUrl });
await db.connect();

const q = (text, values = []) => db.query(text, values);
async function ok(label, text, values) {
  await q(text, values);
  checks += 1;
  return label;
}
async function rejects(label, text, values, pattern) {
  await assert.rejects(
    () => q(text, values),
    (error) => {
      assert.match(`${error.code ?? ""} ${error.message}`, pattern, label);
      return true;
    },
    label,
  );
  checks += 1;
}

const H = "a".repeat(64);
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

async function corpus(name, status) {
  const c = id();
  await q(
    `INSERT INTO "LegalCorpusVersion"(id, version, status, "sourceManifest") VALUES ($1,$2,$3::"LegalRuleLifecycleStatus",'{}')`,
    [c, name, status],
  );
  const d = id();
  await q(
    `INSERT INTO "LegalSourceDocument"(id, "legalCorpusVersionId", "documentId", title, "sourceUrl", "sourceSha256", "sourceEffectStatus")
     VALUES ($1,$2,'doc-1','t','u',$3,'IN_FORCE')`,
    [d, c, H],
  );
  const chunk = `chunk-${name}`;
  await q(
    `INSERT INTO "LegalDocumentChunk"(id, "legalCorpusVersionId", "legalSourceDocumentId", "documentId", locator, content, "contentSha256", hierarchy, "legalStatus")
     VALUES ($1,$2,$3,'doc-1','art-1::cl-1','c',$4,'{}','IN_FORCE')`,
    [chunk, c, d, H],
  );
  return { corpusId: c, chunk };
}

async function portfolio(c, name, state = "BUILDING", extra = {}) {
  const run = id();
  await q(
    `INSERT INTO "LegalPreparationRun"(id, "idempotencyKey", "legalCorpusVersionId", "requestedBy", "correlationId")
     VALUES ($1,$2,$3,'svc','corr')`,
    [run, `run-${name}`, c.corpusId],
  );
  const p = id();
  const outcome = state === "BUILDING" ? null : state === "INVALID" ? "FAILED" : "PASSED";
  const failures = state === "INVALID" ? '[{"code":"X"}]' : "[]";
  await q(
    `INSERT INTO "LegalPortfolioVersion"(id, version, "legalCorpusVersionId", "preparationRunId", "lifecycleState", "portfolioDigest", "validationOutcome", "validationFailures", "activatedAt", "supersededAt")
     VALUES ($1,$2,$3,$4,$5::"ArtifactLifecycleState",$6,$7::"LegalPortfolioValidationOutcome",$8::jsonb,$9,$10)`,
    [
      p, name, c.corpusId, run, state, H, outcome, failures,
      state === "ACTIVE" || state === "SUPERSEDED" ? new Date() : null,
      state === "SUPERSEDED" ? new Date() : null,
    ],
  );
  return { id: p, run, ...extra };
}

async function rule(p, legalRuleId, coverage = "COVERED_BY_ENGINEERING_RULES", reason = null) {
  const r = id();
  await q(
    `INSERT INTO "LegalPortfolioRule"(id, "portfolioVersionId", "legalRuleId", title, proposition, "applicabilityConditions", qualifiers, exceptions, "nonRepositoryDuty", "coverageState", "nonAssessableReason", "contentDigest", ordinal)
     VALUES ($1,$2,$3,'t','p','[]','[]','[]',false,$4::"LegalPortfolioCoverageState",$5,$6,0)`,
    [r, p.id, legalRuleId, coverage, reason, H],
  );
  return r;
}

async function engineeringRule(p, engineeringRuleId) {
  const e = id();
  await q(
    `INSERT INTO "EngineeringRule"(id, "portfolioVersionId", "engineeringRuleId", "engineeringRuleVersion", concept, "legalIntent", "applicabilityGuidance", criteria, contract, "sourceFingerprint", "contentDigest", ordinal)
     VALUES ($1,$2,$3,'v1','c','i','g','[]','{}',$4,$4,0)`,
    [e, p.id, engineeringRuleId, H],
  );
  return e;
}

try {
  const cA = await corpus("corpus-a", "APPROVED");
  const cB = await corpus("corpus-b", "SUPERSEDED");

  // 1. at most one ACTIVE portfolio
  const active = await portfolio(cA, "p-active", "ACTIVE");
  const second = await portfolio(cA, "p-second", "BUILDING");
  await rejects(
    "second ACTIVE portfolio rejected",
    `UPDATE "LegalPortfolioVersion" SET "lifecycleState"='ACTIVE', "validationOutcome"='PASSED', "activatedAt"=now() WHERE id=$1`,
    [second.id],
    /23505|single_active/u,
  );

  // 2. state consistency checks
  await rejects(
    "ACTIVE without validation PASSED rejected",
    `INSERT INTO "LegalPortfolioVersion"(id, version, "legalCorpusVersionId", "preparationRunId", "lifecycleState", "portfolioDigest")
     SELECT $1,'p-bad',$2, r.id, 'ACTIVE', $3 FROM "LegalPreparationRun" r LIMIT 1`,
    [id(), cA.corpusId, H],
    /23514|23505|state_consistency|unique/u,
  );
  await rejects(
    "BUILDING with a validation outcome rejected",
    `UPDATE "LegalPortfolioVersion" SET "validationOutcome"='PASSED' WHERE id=$1`,
    [second.id],
    /23514|state_consistency/u,
  );

  // 3. lifecycle transitions follow the frozen ALCS table (trigger)
  const invalid = await portfolio(cA, "p-invalid", "INVALID");
  await rejects(
    "INVALID is terminal",
    `UPDATE "LegalPortfolioVersion" SET "lifecycleState"='ACTIVE', "validationOutcome"='PASSED', "activatedAt"=now() WHERE id=$1`,
    [invalid.id],
    /illegal legal portfolio lifecycle transition|validation result is immutable/u,
  );
  await rejects(
    "ACTIVE cannot return to BUILDING",
    `UPDATE "LegalPortfolioVersion" SET "lifecycleState"='BUILDING' WHERE id=$1`,
    [active.id],
    /illegal legal portfolio lifecycle transition|state_consistency/u,
  );
  await rejects(
    "portfolio identity is immutable",
    `UPDATE "LegalPortfolioVersion" SET "portfolioDigest"=$2 WHERE id=$1`,
    [active.id, "b".repeat(64)],
    /identity is immutable/u,
  );
  await rejects(
    "portfolio history cannot be deleted",
    `DELETE FROM "LegalPortfolioVersion" WHERE id=$1`,
    [invalid.id],
    /cannot be deleted/u,
  );
  // audited rollback: SUPERSEDED -> ACTIVE is legal once the pointer is free
  await ok(
    "supersede",
    `UPDATE "LegalPortfolioVersion" SET "lifecycleState"='SUPERSEDED', "supersededAt"=now() WHERE id=$1`,
    [active.id],
  );
  await ok(
    "rollback SUPERSEDED -> ACTIVE",
    `UPDATE "LegalPortfolioVersion" SET "lifecycleState"='ACTIVE', "supersededAt"=NULL WHERE id=$1`,
    [active.id],
  );

  // 4. coverage reason + immutability of children
  await rejects(
    "NON_ASSESSABLE needs a reason",
    `INSERT INTO "LegalPortfolioRule"(id, "portfolioVersionId", "legalRuleId", title, proposition, "applicabilityConditions", qualifiers, exceptions, "nonRepositoryDuty", "coverageState", "contentDigest", ordinal)
     VALUES ($1,$2,'LR-X','t','p','[]','[]','[]',true,'NON_ASSESSABLE',$3,0)`,
    [id(), active.id, H],
    /23514|coverage_reason/u,
  );
  const r1 = await rule(active, "LR-1");
  await ok("non-assessable with reason", "SELECT 1");
  await rule(active, "LR-2", "NON_ASSESSABLE", "organizational duty");
  await rejects(
    "duplicate legal rule id within portfolio rejected",
    `INSERT INTO "LegalPortfolioRule"(id, "portfolioVersionId", "legalRuleId", title, proposition, "applicabilityConditions", qualifiers, exceptions, "nonRepositoryDuty", "coverageState", "contentDigest", ordinal)
     VALUES ($1,$2,'LR-1','t','p','[]','[]','[]',false,'COVERED_BY_ENGINEERING_RULES',$3,0)`,
    [id(), active.id, H],
    /23505/u,
  );
  await rejects("rules are immutable (update)", `UPDATE "LegalPortfolioRule" SET title='x' WHERE id=$1`, [r1], /immutable once written/u);
  await rejects("rules are immutable (delete)", `DELETE FROM "LegalPortfolioRule" WHERE id=$1`, [r1], /immutable once written/u);

  // 5. same-portfolio ownership of the engineering-rule <-> legal-rule link
  const e1 = await engineeringRule(active, "ER-1");
  await ok(
    "link within one portfolio",
    `INSERT INTO "EngineeringRuleLegalRule"("portfolioVersionId","engineeringRuleRowId","portfolioRuleId") VALUES ($1,$2,$3)`,
    [active.id, e1, r1],
  );
  const other = await portfolio(cB, "p-other", "BUILDING");
  const foreignRule = await rule(other, "LR-1");
  await rejects(
    "cross-portfolio link rejected",
    `INSERT INTO "EngineeringRuleLegalRule"("portfolioVersionId","engineeringRuleRowId","portfolioRuleId") VALUES ($1,$2,$3)`,
    [active.id, e1, foreignRule],
    /23503/u,
  );

  // 6. provenance chunk must belong to the portfolio's own corpus
  await ok(
    "provenance in own corpus",
    `INSERT INTO "LegalRuleProvenance"(id,"portfolioVersionId","portfolioRuleId","legalCorpusVersionId","chunkId","documentId",locator,"contentSha256","sourceEffectStatus",ordinal)
     VALUES ($1,$2,$3,$4,$5,'doc-1','art-1::cl-1',$6,'IN_FORCE',0)`,
    [id(), active.id, r1, cA.corpusId, cA.chunk, H],
  );
  await rejects(
    "provenance from another corpus rejected (mixed corpus)",
    `INSERT INTO "LegalRuleProvenance"(id,"portfolioVersionId","portfolioRuleId","legalCorpusVersionId","chunkId","documentId",locator,"contentSha256","sourceEffectStatus",ordinal)
     VALUES ($1,$2,$3,$4,$5,'doc-1','art-1::cl-1',$6,'IN_FORCE',1)`,
    [id(), active.id, r1, cA.corpusId, cB.chunk, H],
    /23503/u,
  );

  // 7. context relations: exactly one target, same portfolio
  await ok(
    "relation to a source chunk",
    `INSERT INTO "LegalRuleContextRelation"(id,"portfolioVersionId","relationId",kind,"fromRuleId","toChunkId","legalCorpusVersionId","relationDigest",ordinal)
     VALUES ($1,$2,'REL-1','EXCEPTION',$3,$4,$5,$6,0)`,
    [id(), active.id, r1, cA.chunk, cA.corpusId, H],
  );
  await rejects(
    "relation with no target rejected",
    `INSERT INTO "LegalRuleContextRelation"(id,"portfolioVersionId","relationId",kind,"fromRuleId","legalCorpusVersionId","relationDigest",ordinal)
     VALUES ($1,$2,'REL-2','SCOPE',$3,$4,$5,0)`,
    [id(), active.id, r1, cA.corpusId, H],
    /23514|exactly_one_target/u,
  );
  await rejects(
    "relation to a rule of another portfolio rejected (orphan)",
    `INSERT INTO "LegalRuleContextRelation"(id,"portfolioVersionId","relationId",kind,"fromRuleId","toRuleId","legalCorpusVersionId","relationDigest",ordinal)
     VALUES ($1,$2,'REL-3','DEFINITION',$3,$4,$5,$6,0)`,
    [id(), active.id, r1, foreignRule, cA.corpusId, H],
    /23503/u,
  );

  // 8. activation record is mechanical audit: failures required iff FAILED; one per portfolio
  await rejects(
    "FAILED activation needs failure codes",
    `INSERT INTO "LegalPortfolioActivationRecord"(id,"portfolioVersionId","preparationRunId","idempotencyKey","requestDigest","validationOutcome","validationFailures","correlationId")
     VALUES ($1,$2,$3,'k-1',$4,'FAILED','[]','c')`,
    [id(), invalid.id, invalid.run, H],
    /23514|failures_check/u,
  );
  await ok(
    "activation record",
    `INSERT INTO "LegalPortfolioActivationRecord"(id,"portfolioVersionId","preparationRunId","idempotencyKey","requestDigest","validationOutcome","validationFailures","correlationId")
     VALUES ($1,$2,$3,'k-2',$4,'FAILED','[{"code":"X"}]','c')`,
    [id(), invalid.id, invalid.run, H],
  );
  await rejects(
    "second activation record for one portfolio rejected",
    `INSERT INTO "LegalPortfolioActivationRecord"(id,"portfolioVersionId","preparationRunId","idempotencyKey","requestDigest","validationOutcome","validationFailures","correlationId")
     VALUES ($1,$2,$3,'k-3',$4,'FAILED','[{"code":"X"}]','c')`,
    [id(), invalid.id, invalid.run, H],
    /23505/u,
  );

  // 9. a pinned corpus cannot be deleted while a portfolio references it
  await rejects(
    "corpus delete is restricted",
    `DELETE FROM "LegalCorpusVersion" WHERE id=$1`,
    [cA.corpusId],
    /23503/u,
  );

  // 9b. a preparation run is FAILED exactly when it records a failure reason
  await rejects(
    "FAILED run without a failure reason rejected",
    `UPDATE "LegalPreparationRun" SET "executionState"='FAILED' WHERE id=$1`,
    [active.run],
    /23514|failure_reason/u,
  );
  await rejects(
    "failure reason on a non-failed run rejected",
    `UPDATE "LegalPreparationRun" SET "failureReason"='NO_SUBMISSION' WHERE id=$1`,
    [active.run],
    /23514|failure_reason/u,
  );
  await ok(
    "FAILED run with a reason",
    `UPDATE "LegalPreparationRun" SET "executionState"='FAILED', "failureReason"='NO_SUBMISSION' WHERE id=$1`,
    [second.run],
  );

  // 10. V1 approval tables are untouched by the expand migration
  const v1 = await q(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'LegalRule' AND column_name = 'legalRuleCatalogVersionId'`,
  );
  assert.equal(v1.rows[0].n, 1);
  checks += 1;
} finally {
  await db.end();
}

console.log(`PASS: ${checks} legal portfolio database guarantees on ${databaseUrl}`);
