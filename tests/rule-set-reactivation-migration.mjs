// Task-owned loopback database only; proves populated forward upgrade preserves acceptance history.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Client } = createRequire(path.join(root, "apps/api/package.json"))(
  "pg",
);
const name = "lcsp_reactivation_migration";
const base = "postgresql://postgres:postgres@127.0.0.1:55441/";
const admin = new Client({ connectionString: base + "postgres" });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end();
}
const db = new Client({ connectionString: base + name });
await db.connect();
try {
  const directory = path.join(root, "apps/api/prisma/migrations");
  const migrations = (await readdir(directory, { withFileTypes: true }))
    .filter((x) => x.isDirectory())
    .map((x) => x.name)
    .sort();
  assert.equal(migrations.at(-1), "20261016040000_rule_set_reactivation");
  // psql commits statements individually, matching Prisma deploy's enum-addition behavior.
  for (const migration of migrations.slice(0, -1)) {
    const applied = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        "lcsp-api-test-postgres-55441-lcsp_reactivation_test",
        "psql",
        "-U",
        "postgres",
        "-d",
        name,
        "-v",
        "ON_ERROR_STOP=1",
        "-q",
      ],
      {
        input: await readFile(
          path.join(directory, migration, "migration.sql"),
          "utf8",
        ),
        encoding: "utf8",
      },
    );
    assert.equal(applied.status, 0, `${migration}: ${applied.stderr}`);
  }
  const digest = "a".repeat(64);
  await db.query(
    `INSERT INTO "LegalSourceVersion"(id,version,status,"sourceManifest") VALUES ('source','trusted-source','SUPERSEDED','{}')`,
  );
  for (const [id, status] of [
    ["trusted", "SUPERSEDED"],
    ["rejected", "ACTIVE"],
  ]) {
    await db.query(
      `INSERT INTO "RuleSetPreparationRun"(id,"idempotencyKey","legalSourceVersionId","requestedBy","correlationId","executionState","completedAt") VALUES ($1,$1,'source','worker','corr','SUCCEEDED',now())`,
      [id],
    );
    await db.query(
      `INSERT INTO "ComplianceRuleSetVersion"(id,version,"legalSourceVersionId","preparationRunId","lifecycleState","ruleSetDigest","validationOutcome","validatedAt","activatedAt","supersededAt") VALUES ($1,$1,'source',$1,$2::"ArtifactLifecycleState",$3,'PASSED',now(),now(),CASE WHEN $2='SUPERSEDED' THEN now() ELSE NULL END)`,
      [id, status, digest],
    );
    await db.query(
      `INSERT INTO "ComplianceRuleSetActivationRecord"(id,"ruleSetVersionId","preparationRunId","idempotencyKey","requestDigest","validationOutcome","previousActiveRuleSetVersionId","correlationId") VALUES ($1,$1,$1,$1,$2,'PASSED',$3,'corr')`,
      [id, digest, id === "rejected" ? "trusted" : null],
    );
  }
  const tables = [
    "ComplianceRuleSetVersion",
    "ComplianceRuleSetActivationRecord",
    "RuleSetPreparationRun",
    "LegalSourceVersion",
  ];
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows,
        ]),
      ),
    );
  const before = await snapshot();
  await db.query(
    await readFile(
      path.join(directory, migrations.at(-1), "migration.sql"),
      "utf8",
    ),
  );
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM "ComplianceRuleSetReactivationRecord"',
      )
    ).rows[0].n,
    0,
  );
  const indexes = (
    await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='ComplianceRuleSetActivationRecord' OR tablename='ComplianceRuleSetVersion'`,
    )
  ).rows.map((x) => x.indexname);
  for (const key of [
    "ComplianceRuleSetActivationRecord_ruleSetVersionId_key",
    "ComplianceRuleSetActivationRecord_preparationRunId_key",
    "ComplianceRuleSetVersion_single_active_idx",
  ])
    assert(indexes.includes(key));
  const triggers = (
    await db.query(
      `SELECT tgname FROM pg_trigger WHERE tgname='ComplianceRuleSetReactivationRecord_immutable'`,
    )
  ).rows;
  assert.equal(triggers.length, 1);
  console.log(
    JSON.stringify({
      result: "PASS",
      previousMigrations: migrations.length - 1,
      newMigration: migrations.at(-1),
      preservedTables: tables,
      originalAcceptanceRows: 2,
      singleActiveIndexPreserved: true,
      immutableTransitionTrigger: true,
    }),
  );
} finally {
  await db.end();
}
