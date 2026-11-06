// Run after the API build against a task-owned loopback PostgreSQL server.
// LCSP_TEST_PG_PORT=<port> node tests/assessment-hitl-phase2-upgrade.mjs
// Creates one unique database; no reset, drop, live data export, or model calls.
// Copies the pre-Phase2 migration tree into ignored .cache, seeds guarded history,
// applies Phase2 and subsequent migrations, and checks Prisma timestamps across DB defaults.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { root, apiDir } from "./support/compliance-rule-set-stack.mjs";

const requireApi = createRequire(path.join(apiDir, "package.json"));
const { Client } = requireApi("pg");
const phase2Migrations = [
  "20261104120000_shared_human_request_dependencies",
  "20261104130000_human_answer_review_checkpoint_binding",
];
const port = Number(process.env.LCSP_TEST_PG_PORT);
assert.ok(
  Number.isInteger(port) && port > 1024,
  "An explicit owned test PostgreSQL port is required",
);
const suffix = randomUUID().replaceAll("-", "");
const database = "lcsp360_final_hitl_upgrade_" + suffix;
const baseUrl =
  "postgresql://postgres:postgres@127.0.0.1:" + port + "/" + database;
const cacheRoot = path.join(root, ".cache/t31-phase2-upgrade");
mkdirSync(cacheRoot, { recursive: true });
const temporaryDirectory = mkdtempSync(path.join(cacheRoot, "run-"));
const oldMigrations = path.join(temporaryDirectory, "baseline/migrations");
mkdirSync(oldMigrations, { recursive: true });
const migrationRoot = path.join(apiDir, "prisma/migrations");
const migrationNames = readdirSync(migrationRoot)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
for (const name of phase2Migrations) assert.ok(migrationNames.includes(name));
const baselineNames = migrationNames.filter(
  (name) => name < phase2Migrations[0],
);
const upgradeNames = migrationNames.filter(
  (name) => name >= phase2Migrations[0],
);
assert.ok(baselineNames.length > 0, "The pre-Phase2 baseline must exist");
for (const name of baselineNames) {
  cpSync(path.join(migrationRoot, name), path.join(oldMigrations, name), {
    recursive: true,
    errorOnExist: true,
  });
}
copyFileSync(
  path.join(migrationRoot, "migration_lock.toml"),
  path.join(oldMigrations, "migration_lock.toml"),
);
const baselineSchema = path.join(temporaryDirectory, "baseline/schema.prisma");
const schema = spawnSync(
  "git",
  ["show", "HEAD:apps/api/prisma/schema.prisma"],
  { cwd: root, encoding: "utf8" },
);
assert.equal(schema.status, 0, schema.stderr);
writeFileSync(baselineSchema, schema.stdout);
const baselineConfig = path.join(temporaryDirectory, "baseline.config.mjs");
writeFileSync(
  baselineConfig,
  "import { defineConfig } from " +
    JSON.stringify(pathToFileURL(requireApi.resolve("prisma/config")).href) +
    ";\n" +
    "export default defineConfig({schema:" +
    JSON.stringify(baselineSchema) +
    ",migrations:{path:" +
    JSON.stringify(oldMigrations) +
    "},datasource:{url:process.env.DATABASE_URL}});\n",
);
const migrate = (config) => {
  const result = spawnSync(
    "pnpm",
    [
      "--dir",
      apiDir,
      "exec",
      "prisma",
      "migrate",
      "deploy",
      ...(config ? ["--config", config] : []),
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
      env: {
        ...process.env,
        DATABASE_URL: baseUrl,
        TMPDIR: temporaryDirectory,
      },
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
};
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (actual, message) => {
  assert.ok(actual, message);
  checks++;
};
const admin = new Client({
  host: "127.0.0.1",
  port,
  user: "postgres",
  database: "postgres",
});
await admin.connect();
const existing = await admin.query(
  "SELECT 1 FROM pg_database WHERE datname=$1",
  [database],
);
eq(existing.rowCount, 0, "Create-only database name must be unused");
await admin.query('CREATE DATABASE "' + database + '"');
await admin.query(
  'ALTER DATABASE "' + database + "\" SET timezone TO 'Asia/Ho_Chi_Minh'",
);
const serverTimezone = (await admin.query("SHOW TimeZone")).rows[0].TimeZone;
const baselineLog = migrate(baselineConfig);
const db = new Client({ connectionString: baseUrl });
await db.connect();
const q = (sql, values = []) => db.query(sql, values);
const sqlRejects = async (sql, values, code, message) => {
  let failure;
  try {
    await q(sql, values);
  } catch (error) {
    failure = error;
  }
  ok(failure, message);
  eq(failure.code, code, message);
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const historyTables = [
  "AssessmentHumanRequest",
  "AssessmentCase",
  "AssessmentCaseFact",
  "AssessmentEvidence",
  "AssessmentCaseFactEvidence",
  "AssessmentDecisionCoverage",
  "AssessmentRuntime",
  "AssessmentRuntimeTurn",
];
const history = async () => {
  const snapshot = {};
  for (const table of historyTables) {
    snapshot[table] = (
      await q(
        'SELECT to_jsonb(t) AS row FROM "' +
          table +
          '" t ORDER BY to_jsonb(t)::text',
      )
    ).rows.map((entry) => entry.row);
  }
  return snapshot;
};
const owner = randomUUID();
const source = randomUUID();
const preparation = randomUUID();
const ruleSet = randomUUID();
const commit = "d".repeat(40);
const ruleIds = ["upgrade-rule-a", "upgrade-rule-b"];
const requests = [];
let prisma;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPgOptions = process.env.PGOPTIONS;
try {
  eq(
    (
      await q(
        'SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
      )
    ).rows[0].n,
    baselineNames.length,
    "Only baseline migrations applied before seeding",
  );
  eq(
    (
      await q(
        "SELECT to_regclass('public.\"AssessmentHumanRequestDependency\"') AS name",
      )
    ).rows[0].name,
    null,
    "Dependencies do not exist before upgrade",
  );
  await q(
    'INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount","updatedAt") VALUES($1,$2,\'not-a-login-fixture\',true,0,now())',
    [owner, "upgrade-" + suffix + "@example.test"],
  );
  await q(
    "INSERT INTO \"LegalSourceVersion\"(id,version,status,\"sourceManifest\") VALUES($1,$2,'ACTIVE','{}')",
    [source, "upgrade-source-" + suffix],
  );
  await q(
    'INSERT INTO "RuleSetPreparationRun"(id,"idempotencyKey","legalSourceVersionId","requestedBy","correlationId") VALUES($1,$2,$3,\'upgrade-fixture\',$4)',
    [preparation, "prepare-" + suffix, source, randomUUID()],
  );
  await q(
    'INSERT INTO "ComplianceRuleSetVersion"(id,version,"legalSourceVersionId","preparationRunId","lifecycleState","ruleSetDigest","validationOutcome","validatedAt","activatedAt") VALUES($1,$2,$3,$4,\'ACTIVE\',$5,\'PASSED\',now(),now())',
    [ruleSet, "upgrade-rules-" + suffix, source, preparation, "a".repeat(64)],
  );
  for (const [ordinal, ruleId] of ruleIds.entries()) {
    await q(
      'INSERT INTO "AssessmentRule"(id,"ruleSetVersionId","assessmentRuleId","assessmentRuleVersion",concept,"legalIntent","applicabilityGuidance",criteria,contract,"sourceFingerprint","contentDigest",ordinal) VALUES($1,$2,$3,\'v1\',\'Synthetic upgrade fixture\',\'Persistence only\',\'Fixture scope\',$4::jsonb,\'{}\',$5,$5,$6)',
      [
        randomUUID(),
        ruleSet,
        ruleId,
        JSON.stringify([{ criterionId: ruleId + "-criterion" }]),
        "b".repeat(64),
        ordinal,
      ],
    );
  }
  const seedAssessment = async (label, auditMode = "LEGACY_FULL") => {
    const id = randomUUID(),
      thread = randomUUID(),
      execution = randomUUID(),
      checkpoint = randomUUID();
    const connection = randomUUID(),
      snapshot = randomUUID(),
      scan = randomUUID();
    await q(
      'INSERT INTO "Assessment"(id,"ownerId",name,"lifecycleState","lifecycleRevision","updatedAt") VALUES($1,$2,$3,\'CREATED\',0,now())',
      [id, owner, label],
    );
    await q(
      'INSERT INTO "RepositoryConnection"(id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES($1,$2,$3,\'upgrade-fixture\',$4,\'fixture\',\'fixture/upgrade\',\'main\',\'{}\')',
      [connection, id, owner, "repo-" + id],
    );
    await q(
      'INSERT INTO "RepositorySnapshot"(id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES($1,$2,$3,$4,\'fixture/upgrade\',$5,\'{}\',$6)',
      [snapshot, id, connection, "repo-" + id, commit, owner],
    );
    await q(
      'INSERT INTO "RepositoryScanJob"(id,"assessmentId","snapshotId","idempotencyKey","triggerSource","correlationId","updatedAt") VALUES($1,$2,$3,$4,\'MANUAL\',$5,now())',
      [scan, id, snapshot, "scan-" + id, randomUUID()],
    );
    await q(
      'INSERT INTO "AssessmentCase"("assessmentId","ruleSetVersionId","repositorySnapshotId","repositoryScanJobId","repositoryCommit","auditMode","updatedAt") VALUES($1,$2,$3,$4,$5,$6,now())',
      [id, ruleSet, snapshot, scan, commit, auditMode],
    );
    for (const ruleId of ruleIds) {
      await q(
        'INSERT INTO "AssessmentDecisionCoverage"("assessmentId","assessmentRuleId","ruleSetVersionId","assessmentRuleVersion","updatedAt") VALUES($1,$2,$3,\'v1\',now())',
        [id, ruleId, ruleSet],
      );
    }
    await q(
      'INSERT INTO "AssessmentRuntime"("assessmentId","threadId","rootAgentVersion","checkpointNamespace","checkpointId","currentExecutionId","executionState","leaseToken","leaseExpiresAt","updatedAt") VALUES($1,$2,\'upgrade-fixture-v1\',\'\',$3,$4,\'RUNNING\',$5,CURRENT_TIMESTAMP+interval \'1 hour\',now())',
      [id, thread, checkpoint, execution, randomUUID()],
    );
    await q(
      'INSERT INTO "AssessmentRuntimeTurn"(id,"assessmentId","threadId",boundary,"logicalRunId","correlationId","contextJson","updatedAt") VALUES($1,$2,$3,\'ASSESSMENT_ROOT\',$2,$4,\'{}\',now())',
      [execution, id, thread, randomUUID()],
    );
    let auditRequestId = null;
    if (auditMode === "CUSTOMER_SELECTED") {
      auditRequestId = randomUUID();
      await q(
        'INSERT INTO "AssessmentRuleAuditRequest"("requestId","assessmentId","requestRevision","idempotencyKey","requestDigest","scopeMode","status","ruleSetVersionId","ruleSetDigest","repositorySnapshotId","repositoryCommit") VALUES($1,$2,1,$3,$4,\'SELECTED_RULES\',\'WAITING_FOR_CUSTOMER\',$5,$6,$7,$8)',
        [auditRequestId, id, "selected-" + auditRequestId, "8".repeat(64), ruleSet, "a".repeat(64), snapshot, commit],
      );
      await q(
        'INSERT INTO "AssessmentRuleAuditItem"("requestId","assessmentRuleId","assessmentRuleVersion",ordinal) VALUES($1,$2,\'v1\',0)',
        [auditRequestId, ruleIds[0]],
      );
      await q('UPDATE "AssessmentCase" SET "auditRequestRevision"=1 WHERE "assessmentId"=$1', [id]);
      await q('UPDATE "AssessmentRuntime" SET "currentAuditRequestId"=$2 WHERE "assessmentId"=$1', [id, auditRequestId]);
    }
    await q(
      'UPDATE "Assessment" SET "lifecycleState"=\'ACTIVE\',"lifecycleRevision"=1 WHERE id=$1',
      [id],
    );
    await q(
      'UPDATE "AssessmentDecisionCoverage" SET "resolutionState"=\'INVESTIGATING\' WHERE "assessmentId"=$1 AND "assessmentRuleId"=$2',
      [id, ruleIds[0]],
    );
    return { id, thread, execution, checkpoint, snapshot, auditRequestId };
  };
  const request = async (assessment, label) => {
    const requestId = randomUUID();
    await q(
      'INSERT INTO "AssessmentHumanRequest"("requestId","assessmentId","threadId","caseRevision","assessmentRuleId","criterionIds",question,"unresolvedFact","decisionImpact","resolutionAttempts","controlType",choices,"idempotencyKey","requestDigest","checkpointId") VALUES($1,$2,$3,0,$4,$5::jsonb,$6,$6,\'{}\',\'[]\',\'TEXT\',\'[]\',$7,$8,$9)',
      [
        requestId,
        assessment.id,
        assessment.thread,
        ruleIds[0],
        JSON.stringify([ruleIds[0] + "-criterion"]),
        label,
        "request-" + requestId,
        "c".repeat(64),
        assessment.checkpoint,
      ],
    );
    const entry = { ...assessment, requestId, label, revision: 0, answers: [] };
    requests.push(entry);
    return entry;
  };
  const answer = async (entry, unknown, caseRevision) => {
    const revision = entry.revision + 1;
    const audit = {
      idempotencyKey: "answer-" + entry.requestId + "-" + revision,
      requestDigest: "f".repeat(64),
      actorId: owner,
      answeredAt: new Date().toISOString(),
      caseRevision,
      requestRevision: revision,
      doesNotKnow: unknown,
      answer: unknown ? null : "A genuine representative answer",
      checkpointId: entry.checkpoint,
    };
    const answers = [...entry.answers, audit];
    await q(
      'UPDATE "AssessmentHumanRequest" SET answers=$2::jsonb,"requestRevision"=$3 WHERE "requestId"=$1',
      [entry.requestId, JSON.stringify(answers), revision],
    );
    entry.revision = revision;
    entry.answers = answers;
  };
  const normal = await seedAssessment("populated-unknown-history");
  const waiting = await request(normal, "Unknown with original checkpoint");
  await answer(waiting, true, 0);
  await answer(waiting, true, 0);
  const resolved = await request(
    normal,
    "Known after an earlier unknown answer",
  );
  await answer(resolved, true, 0);
  await q(
    'UPDATE "AssessmentCase" SET "caseRevision"=1 WHERE "assessmentId"=$1',
    [normal.id],
  );
  const fact = randomUUID(),
    evidence = randomUUID();
  await q(
    'INSERT INTO "AssessmentCaseFact"("factId","assessmentId","caseRevision",kind,authority,statement) VALUES($1,$2,1,\'FACT\',\'HUMAN_PROVIDED\',\'Accepted representative answer\')',
    [fact, normal.id],
  );
  await q(
    'INSERT INTO "AssessmentEvidence"("evidenceId","assessmentId",type,"repositoryCommit","contentSha256",payload) VALUES($1,$2,\'HUMAN_ANSWER\',$3,$4,$5::jsonb)',
    [
      evidence,
      normal.id,
      commit,
      "sha256:" + "e".repeat(64),
      JSON.stringify({ requestId: resolved.requestId }),
    ],
  );
  await q(
    'INSERT INTO "AssessmentCaseFactEvidence"("assessmentId","factId","evidenceId") VALUES($1,$2,$3)',
    [normal.id, fact, evidence],
  );
  await answer(resolved, false, 1);
  await q(
    'UPDATE "AssessmentHumanRequest" SET status=\'RESOLVED\',"resolvedFactId"=$2,"resolvedAt"=now() WHERE "requestId"=$1',
    [resolved.requestId, fact],
  );
  const cancelled = await request(normal, "Cancelled historical question");
  await q(
    'UPDATE "AssessmentHumanRequest" SET status=\'CANCELLED\' WHERE "requestId"=$1',
    [cancelled.requestId],
  );
  const superseded = await request(normal, "Superseded historical question");
  await answer(superseded, true, 1);
  await q(
    'UPDATE "AssessmentHumanRequest" SET status=\'SUPERSEDED\' WHERE "requestId"=$1',
    [superseded.requestId],
  );
  const empty = await seedAssessment("open-without-answer");
  await request(empty, "Unanswered question");
  const foreign = await seedAssessment("foreign-assessment");
  const foreignRequest = await request(foreign, "Foreign assessment question");
  await answer(foreignRequest, true, 0);
  const expired = await seedAssessment("expired-review-lease");
  const expiredRequest = await request(expired, "Expired lease question");
  await answer(expiredRequest, true, 0);
  const unauthorized = await seedAssessment("no-review-authorization");
  const unauthorizedRequest = await request(
    unauthorized,
    "Unreviewed question",
  );
  await answer(unauthorizedRequest, true, 0);
  for (const item of [normal, empty, foreign, expired, unauthorized]) {
    await q(
      'UPDATE "AssessmentDecisionCoverage" SET "resolutionState"=\'WAITING_FOR_INPUT\' WHERE "assessmentId"=$1 AND "assessmentRuleId"=$2',
      [item.id, ruleIds[0]],
    );
    await q(
      'UPDATE "Assessment" SET "lifecycleState"=\'WAITING_FOR_HUMAN\',"lifecycleRevision"=2 WHERE id=$1',
      [item.id],
    );
  }
  for (const entry of [waiting, expiredRequest]) {
    await q(
      'UPDATE "AssessmentRuntimeTurn" SET "contextJson"=$2::jsonb WHERE id=$1',
      [
        entry.execution,
        JSON.stringify({
          humanAnswerReview: {
            checkpointId: entry.checkpoint,
            requests: [
              { requestId: entry.requestId, requestRevision: entry.revision },
            ],
          },
        }),
      ],
    );
  }
  await q(
    'UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=CURRENT_TIMESTAMP-interval \'1 minute\' WHERE "assessmentId"=$1',
    [expired.id],
  );
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    [waiting.requestId, randomUUID()],
    "23514",
    "Old guard rejects even an authorized review rebind",
  );
  const before = await history();
  eq(
    before.AssessmentHumanRequest.length,
    8,
    "Representative histories exist before the upgrade",
  );
  const upgradeLog = migrate();
  eq(
    (
      await q(
        'SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
      )
    ).rows[0].n,
    migrationNames.length,
    "Both new migrations were applied",
  );
  eq(
    await history(),
    before,
    "Upgrade preserves all pre-existing history, facts, pins, runtime bindings and coverage",
  );
  const backfill = (
    await q(
      'SELECT "requestId","assessmentId","assessmentRuleId","criterionIds" FROM "AssessmentHumanRequestDependency" ORDER BY "requestId"',
    )
  ).rows;
  const expectedBackfill = before.AssessmentHumanRequest.map((row) => ({
    requestId: row.requestId,
    assessmentId: row.assessmentId,
    assessmentRuleId: row.assessmentRuleId,
    criterionIds: row.criterionIds,
  })).sort((a, b) => a.requestId.localeCompare(b.requestId));
  eq(
    backfill,
    expectedBackfill,
    "Every status and history receives exactly its original dependency",
  );
  eq(
    (
      await q(
        'SELECT count(*)::int AS n FROM "AssessmentHumanRequestRegistration"',
      )
    ).rows[0].n,
    0,
    "Upgrade does not fabricate registration receipts",
  );
  migrate();
  eq(
    (
      await q(
        'SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
      )
    ).rows[0].n,
    migrationNames.length,
    "Migration deployment replay does not rerun migrations",
  );
  eq(
    (
      await q(
        'SELECT count(*)::int AS n FROM "AssessmentHumanRequestDependency"',
      )
    ).rows[0].n,
    requests.length,
    "Deployment replay does not duplicate dependencies",
  );
  eq(await history(), before, "Deployment replay preserves all history");

  const insertDependency =
    'INSERT INTO "AssessmentHumanRequestDependency"("requestId","assessmentId","assessmentRuleId","criterionIds") VALUES($1,$2,$3,\'[]\')';
  await sqlRejects(
    insertDependency,
    [foreignRequest.requestId, normal.id, ruleIds[1]],
    "23503",
    "Dependency cannot cross assessment ownership",
  );
  await sqlRejects(
    insertDependency,
    [waiting.requestId, normal.id, "missing-rule"],
    "23503",
    "Dependency must reference this assessment's coverage",
  );
  await sqlRejects(
    insertDependency,
    [waiting.requestId, normal.id, ruleIds[0]],
    "23505",
    "Request-rule dependency is unique",
  );
  await q(insertDependency, [waiting.requestId, normal.id, ruleIds[1]]);
  eq(
    (
      await q(
        'SELECT count(*)::int AS n FROM "AssessmentHumanRequestDependency" WHERE "requestId"=$1',
        [waiting.requestId],
      )
    ).rows[0].n,
    2,
    "A second explicit rule dependency can be registered",
  );
  const registrationSql =
    'INSERT INTO "AssessmentHumanRequestRegistration"("assessmentId","idempotencyKey","requestId","requestDigest","caseRevision","requestRevision") VALUES($1,$2,$3,$4,1,$5)';
  await q(registrationSql, [
    normal.id,
    "shared-registration",
    waiting.requestId,
    "a".repeat(64),
    waiting.revision,
  ]);
  await sqlRejects(
    registrationSql,
    [
      normal.id,
      "shared-registration",
      waiting.requestId,
      "a".repeat(64),
      waiting.revision,
    ],
    "23505",
    "Registration receipt replay identity is unique",
  );
  await sqlRejects(
    registrationSql,
    [
      normal.id,
      "foreign-registration",
      foreignRequest.requestId,
      "a".repeat(64),
      foreignRequest.revision,
    ],
    "23503",
    "Registration receipt cannot cross assessment ownership",
  );

  const { PrismaService } = await import(
    pathToFileURL(
      path.join(apiDir, "dist/src/infrastructure/prisma/prisma.service.js"),
    ).href
  );
  const timezoneCases = [
    {
      databaseTimezone: "UTC",
      inheritedOptions:
        "-c timezone=Asia/Ho_Chi_Minh -c statement_timeout=17000",
      expectedTimeout: "17s",
    },
    {
      databaseTimezone: "Asia/Ho_Chi_Minh",
      inheritedOptions: "",
      expectedTimeout: "0",
    },
    {
      databaseTimezone: "Asia/Ho_Chi_Minh",
      inheritedOptions: "-c statement_timeout=17000",
      urlOptions: "-c timezone=America/New_York -c statement_timeout=19000",
      expectedTimeout: "19s",
    },
  ];
  const timezoneResults = [];
  for (const item of timezoneCases) {
    await admin.query(
      'ALTER DATABASE "' +
        database +
        "\" SET timezone TO '" +
        item.databaseTimezone +
        "'",
    );
    process.env.PGOPTIONS = "";
    const raw = new Client({ connectionString: baseUrl });
    await raw.connect();
    eq(
      (await raw.query("SHOW TimeZone")).rows[0].TimeZone,
      item.databaseTimezone,
      "Raw driver observes the requested database default",
    );
    const url = new URL(baseUrl);
    if (item.urlOptions) url.searchParams.set("options", item.urlOptions);
    process.env.DATABASE_URL = url.toString();
    process.env.PGOPTIONS = item.inheritedOptions;
    prisma = new PrismaService();
    try {
      const setting = await prisma.$queryRawUnsafe(
        "SELECT current_setting('TimeZone') AS timezone,current_setting('statement_timeout') AS timeout",
      );
      eq(
        setting[0].timezone,
        "UTC",
        "Prisma session must enforce UTC despite DB/URL/environment defaults",
      );
      eq(
        setting[0].timeout,
        item.expectedTimeout,
        "Unrelated options retain the driver's URL-over-environment precedence",
      );
      const future = new Date(Date.now() + 60000);
      const past = new Date(Date.now() - 60000);
      await prisma.assessmentRuntime.update({
        where: { assessmentId: normal.id },
        data: { leaseExpiresAt: future },
      });
      await prisma.assessmentRuntime.update({
        where: { assessmentId: expired.id },
        data: { leaseExpiresAt: past },
      });
      const leases = (
        await raw.query(
          'SELECT "assessmentId",extract(epoch FROM "leaseExpiresAt")*1000 AS ms,"leaseExpiresAt">CURRENT_TIMESTAMP AS live FROM "AssessmentRuntime" WHERE "assessmentId"=ANY($1::text[])',
          [[normal.id, expired.id]],
        )
      ).rows;
      const storedFuture = leases.find((row) => row.assessmentId === normal.id);
      const storedPast = leases.find((row) => row.assessmentId === expired.id);
      eq(
        Number(storedFuture.ms),
        future.getTime(),
        "Raw PostgreSQL stores the precise future instant written through Prisma",
      );
      eq(
        Number(storedPast.ms),
        past.getTime(),
        "Raw PostgreSQL stores the precise expired instant written through Prisma",
      );
      eq(storedFuture.live, true, "SQL accepts a genuinely live lease");
      eq(storedPast.live, false, "SQL rejects a genuinely expired lease");
      const reread = await prisma.assessmentRuntime.findUnique({
        where: { assessmentId: normal.id },
      });
      eq(
        reread.leaseExpiresAt.getTime(),
        future.getTime(),
        "Prisma roundtrip and raw database instant agree",
      );
      timezoneResults.push({
        ...item,
        sessionTimezone: setting[0].timezone,
        futureDriftMs: Number(storedFuture.ms) - future.getTime(),
        expiredDriftMs: Number(storedPast.ms) - past.getTime(),
      });
    } finally {
      await prisma.$disconnect();
      prisma = undefined;
      await raw.end();
    }
  }
  const newCheckpoint = randomUUID();
  await q(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    [waiting.requestId, newCheckpoint],
  );
  eq(
    (
      await q(
        'SELECT "checkpointId" FROM "AssessmentHumanRequest" WHERE "requestId"=$1',
        [waiting.requestId],
      )
    ).rows[0].checkpointId,
    newCheckpoint,
    "Authorized unchanged UNKNOWN request can rebind under a live lease",
  );
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    [expiredRequest.requestId, randomUUID()],
    "23514",
    "Expired review lease cannot rebind checkpoint",
  );
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    [unauthorizedRequest.requestId, randomUUID()],
    "23514",
    "Live runtime without exact review receipt cannot rebind checkpoint",
  );
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    [waiting.requestId, randomUUID()],
    "23514",
    "Older UNKNOWN answer cannot authorize another checkpoint rebind",
  );
  await q(
    'UPDATE "AssessmentRuntime" SET "leaseExpiresAt"=CURRENT_TIMESTAMP+interval \'1 minute\' WHERE "assessmentId"=$1',
    [expired.id],
  );
  await q(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    [expiredRequest.requestId, randomUUID()],
  );
  eq(
    (
      await q(
        'SELECT answers,"requestRevision","resolvedFactId" FROM "AssessmentHumanRequest" WHERE "requestId"=$1',
        [waiting.requestId],
      )
    ).rows[0],
    {
      answers: waiting.answers,
      requestRevision: waiting.revision,
      resolvedFactId: null,
    },
    "Review checkpoint rebind preserves unknown history and creates no resolved fact",
  );
  // Test the selected-audit branch with real database guards. These rows are
  // synthetic persistence fixtures and cannot certify native runtime capacity.
  const selected = await seedAssessment("selected-audit-review", "CUSTOMER_SELECTED");
  const selectedQuestion = await request(selected, "Selected audit unknown question");
  await answer(selectedQuestion, true, 0);
  await q(
    'UPDATE "AssessmentDecisionCoverage" SET "resolutionState"=\'WAITING_FOR_INPUT\' WHERE "assessmentId"=$1 AND "assessmentRuleId"=$2',
    [selected.id, ruleIds[0]],
  );
  await q(
    'UPDATE "Assessment" SET "lifecycleState"=\'WAITING_FOR_HUMAN\',"lifecycleRevision"=2 WHERE id=$1',
    [selected.id],
  );
  const reviewGrant = {
    humanAnswerReview: {
      checkpointId: selectedQuestion.checkpoint,
      requests: [{ requestId: selectedQuestion.requestId, requestRevision: selectedQuestion.revision }],
    },
  };
  const setSelectedContext = (value) => q(
    'UPDATE "AssessmentRuntimeTurn" SET "contextJson"=$2::jsonb WHERE id=$1',
    [selected.execution, JSON.stringify(value)],
  );
  const rebindSelected = [selectedQuestion.requestId, randomUUID()];
  await q('UPDATE "AssessmentRuntime" SET "currentAuditRequestId"=NULL WHERE "assessmentId"=$1', [selected.id]);
  await setSelectedContext(reviewGrant);
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    rebindSelected, "23514", "CUSTOMER_SELECTED cannot use the null-audit legacy review branch",
  );
  const auditRequestId = selected.auditRequestId;
  await q('UPDATE "AssessmentRuntime" SET "currentAuditRequestId"=$2 WHERE "assessmentId"=$1', [selected.id, auditRequestId]);
  // A dependency on an unselected rule is deliberately insufficient.
  await q(insertDependency, [selectedQuestion.requestId, selected.id, ruleIds[1]]);
  await setSelectedContext({ ...reviewGrant, auditRequestId: randomUUID(), checkpointThreadId: auditRequestId });
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    rebindSelected, "23514", "A review grant from another audit cannot rebind this checkpoint",
  );
  await setSelectedContext({ ...reviewGrant, auditRequestId, checkpointThreadId: selected.thread });
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    rebindSelected, "23514", "Selected audit review requires its exact audit checkpoint thread",
  );
  await setSelectedContext({ ...reviewGrant, auditRequestId, checkpointThreadId: auditRequestId });
  await sqlRejects(
    'UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1',
    rebindSelected, "23514", "A human request with no selected dependency cannot rebind",
  );
  await q(insertDependency, [selectedQuestion.requestId, selected.id, ruleIds[0]]);
  await q('UPDATE "AssessmentHumanRequest" SET "checkpointId"=$2 WHERE "requestId"=$1', rebindSelected);
  eq(
    (await q('SELECT "checkpointId",answers,"requestRevision","resolvedFactId" FROM "AssessmentHumanRequest" WHERE "requestId"=$1', [selectedQuestion.requestId])).rows[0],
    { checkpointId: rebindSelected[1], answers: selectedQuestion.answers, requestRevision: selectedQuestion.revision, resolvedFactId: null },
    "Exact selected audit UNKNOWN rebind preserves answer history and creates no fact",
  );
  eq(
    (await q('SELECT count(*)::int AS n FROM "AssessmentCaseFact"')).rows[0].n,
    1,
    "Migration and review guard checks create no additional fact",
  );
  eq(
    (await q('SELECT count(*)::int AS n FROM "AssessmentEvidence"')).rows[0].n,
    1,
    "Migration and review guard checks create no additional evidence",
  );
  eq(
    (
      await q(
        'SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL',
      )
    ).rows[0].n,
    0,
    "No migration is unfinished",
  );
  console.log(
    JSON.stringify({
      gate: "PHASE2_POPULATED_UPGRADE_AND_PRISMA_TIMEZONE",
      result: "PASS",
      assertions: checks,
      database,
      serverTimezone,
      baselineMigrations: baselineNames.length,
      finalMigrations: migrationNames.length,
      representativeRequests: requests.length,
      originalHistorySha256: sha(JSON.stringify(before)),
      backfilledDependencies: backfill.length,
      timezoneCases: timezoneResults,
      migrationLog: {
        baseline: baselineLog.trim().split("\n").slice(-3),
        upgrade: upgradeLog.trim().split("\n").slice(-8),
      },
      scope:
        "Local isolated representative data; real migrations and built PrismaService. Not a staging deployment or production-data upgrade.",
      sourceFiles: [
        "apps/api/src/infrastructure/prisma/prisma.service.ts",
        "tests/assessment-hitl-phase2-upgrade.mjs",
        ...upgradeNames.map(
          (name) => "apps/api/prisma/migrations/" + name + "/migration.sql",
        ),
      ].map((file) => ({
        path: file,
        sha256: sha(readFileSync(path.join(root, file))),
      })),
    }),
  );
} finally {
  if (prisma) await prisma.$disconnect();
  await db.end();
  await admin.end();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalPgOptions === undefined) delete process.env.PGOPTIONS;
  else process.env.PGOPTIONS = originalPgOptions;
}
