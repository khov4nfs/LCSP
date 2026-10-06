// Run: rtk proxy node tests/assessment-lifecycle-migrated-db.mjs
// Creates one task-owned database on the existing loopback PostgreSQL container.
// It never reads or mutates the caller's configured DATABASE_URL.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "apps/api");
const migrationPath = path.join(api, "prisma/migrations");
const host = "127.0.0.1";
const port = 55437;
const user = "postgres";
const password = "postgres";
const database = "lcsp_api_w13_r2_repair";
const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
const { Client } = createRequire(path.join(api, "package.json"))("pg");
let checks = 0;

function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

function normalize(value) {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function run(label, args) {
  const result = spawnSync("rtk", ["proxy", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      NODE_OPTIONS: "--experimental-vm-modules",
      XDG_CACHE_HOME: path.join(api, ".cache"),
    },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000,
  });
  console.log(`${label}: exit ${result.status}`);
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw (
      result.error ?? new Error(`${label} failed with exit ${result.status}`)
    );
  }
  return result;
}

async function query(connectionString, text, values = []) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

async function ensureDatabase() {
  const adminUrl = `postgresql://${user}:${password}@${host}:${port}/postgres`;
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database],
    );
    if (existing.rowCount === 0)
      await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.end();
  }
}

const expectedChecks = {
  Assessment_lifecycle_pair_check:
    'CHECK ((("lifecycleState" IS NULL) = ("lifecycleRevision" IS NULL)))',
  Assessment_lifecycle_revision_check: 'CHECK (("lifecycleRevision" >= 0))',
  Assessment_blocker_check: `CHECK ((((NOT ("lifecycleState" IS DISTINCT FROM 'BLOCKED'::"AssessmentLifecycleState")) AND ("blockerReason" IS NOT NULL) AND ("blockerReference" IS NOT NULL) AND (jsonb_typeof("blockerReference") = 'object'::text)) OR (("lifecycleState" IS DISTINCT FROM 'BLOCKED'::"AssessmentLifecycleState") AND ("blockerReason" IS NULL) AND ("blockerReference" IS NULL))))`,
  AssessmentRuntime_event_sequence_check: 'CHECK (("eventSequence" >= 0))',
  AssessmentRuntime_lease_pair_check:
    'CHECK ((("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)))',
  AssessmentRuntime_lease_execution_check:
    'CHECK ((("leaseToken" IS NULL) OR ("currentExecutionId" IS NOT NULL)))',
  AssessmentEvent_sequence_check: "CHECK ((sequence > 0))",
  AssessmentEvent_payload_check:
    "CHECK ((jsonb_typeof(payload) = 'object'::text))",
  AssessmentEvent_token_usage_check:
    'CHECK ((("tokenUsage" IS NULL) OR (jsonb_typeof("tokenUsage") = \'object\'::text)))',
  AssessmentEvent_child_lineage_check:
    'CHECK (((("actorType" <> \'SUBAGENT\'::"AssessmentEventActorType") AND ("parentExecutionId" IS NULL) AND ("taskId" IS NULL)) OR (("executionId" IS NOT NULL) AND ("parentExecutionId" IS NOT NULL) AND ("taskId" IS NOT NULL))))',
  AssessmentEvent_parent_execution_check:
    'CHECK ((("executionId" IS DISTINCT FROM "parentExecutionId") OR ("executionId" IS NULL)))',
};

const expectedForeignKeys = {
  AssessmentRuntime_assessmentId_fkey:
    'FOREIGN KEY ("assessmentId") REFERENCES "Assessment"(id) ON UPDATE RESTRICT ON DELETE CASCADE',
  AssessmentEvent_assessmentId_fkey:
    'FOREIGN KEY ("assessmentId") REFERENCES "Assessment"(id) ON UPDATE RESTRICT ON DELETE CASCADE',
  AssessmentEvent_assessmentId_threadId_fkey:
    'FOREIGN KEY ("assessmentId", "threadId") REFERENCES "AssessmentRuntime"("assessmentId", "threadId") ON UPDATE RESTRICT ON DELETE CASCADE',
  AssessmentEvent_outboxMessageId_assessmentId_fkey:
    'FOREIGN KEY ("outboxMessageId", "assessmentId") REFERENCES "OutboxMessage"(id, "aggregateId") ON UPDATE RESTRICT ON DELETE RESTRICT',
};

await ensureDatabase();
run("prisma-generate", ["pnpm", "--dir", api, "exec", "prisma", "generate"]);
run("migrate-deploy", [
  "pnpm",
  "--dir",
  api,
  "exec",
  "prisma",
  "migrate",
  "deploy",
]);

const migrationNames = readdirSync(migrationPath)
  .filter((name) => name !== "migration_lock.toml")
  .sort();
const appliedMigrations = await query(
  databaseUrl,
  'SELECT migration_name FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL ORDER BY migration_name',
);
check(
  "all ordered migrations applied",
  appliedMigrations.rows.map((row) => row.migration_name),
  migrationNames,
);

const constraints = await query(
  databaseUrl,
  `SELECT conname, pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
    WHERE conname = ANY($1::text[])
    ORDER BY conname`,
  [Object.keys(expectedChecks).concat(Object.keys(expectedForeignKeys))],
);
const definitions = Object.fromEntries(
  constraints.rows.map((row) => [row.conname, row.definition]),
);
for (const [name, definition] of Object.entries(expectedChecks)) {
  assert.ok(definitions[name], `${name} is deployed`);
  check(
    `${name} definition`,
    normalize(definitions[name]),
    normalize(definition),
  );
}
for (const [name, definition] of Object.entries(expectedForeignKeys)) {
  assert.ok(definitions[name], `${name} is deployed`);
  check(
    `${name} definition`,
    normalize(definitions[name]),
    normalize(definition),
  );
}

run("assessment-lifecycle-protocol", [
  "pnpm",
  "--dir",
  api,
  "exec",
  "tsx",
  "--test",
  "test/assessment-lifecycle-protocol.test.ts",
]);
run("assessment-runtime-control", [
  "pnpm",
  "--dir",
  api,
  "exec",
  "jest",
  "--config",
  "./test/jest-e2e.ts",
  "--runInBand",
  "--runTestsByPath",
  "test/assessment-runtime-control.e2e-spec.ts",
]);

console.log(
  `PASS: ${checks} migration constraint assertions; ordered migrate deploy, lifecycle protocol, and five runtime-control tests passed on ${databaseUrl}`,
);
