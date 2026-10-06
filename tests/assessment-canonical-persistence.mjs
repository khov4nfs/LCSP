// Run: rtk proxy node tests/assessment-canonical-persistence.mjs [log-directory]
// Creates and removes its own Docker PostgreSQL; never reads a configured DB URL.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "apps/api");
const { Pool } = createRequire(path.join(api, "package.json"))("pg");
const logs = process.argv[2]
  ? path.resolve(process.argv[2])
  : mkdtempSync(path.join(tmpdir(), "lcsp-w12-"));
mkdirSync(logs, { recursive: true });
const migration = "20261005140000_assessment_canonical_persistence";
const baselineRef = "988e51f4d307343f49a0facbcc66aed9e95ae772";
const container = `lcsp-w12-test-${process.pid}-${randomUUID().slice(0, 8)}`;
const commands = [];
let checks = 0;
function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function run(label, args, env = {}, allowed = [0]) {
  const result = spawnSync("rtk", ["proxy", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const receipt = {
    label,
    argv: ["rtk", "proxy", ...args],
    env,
    exit: result.status,
    signal: result.signal,
  };
  commands.push(receipt);
  writeFileSync(
    path.join(logs, "commands.json"),
    JSON.stringify(commands, null, 2),
  );
  writeFileSync(path.join(logs, `${label}.stdout`), result.stdout ?? "");
  writeFileSync(path.join(logs, `${label}.stderr`), result.stderr ?? "");
  console.log(`${label}: exit ${result.status}`);
  assert.ok(
    allowed.includes(result.status),
    `${label}: ${result.error ?? result.stderr}`,
  );
  return { stdout: result.stdout, status: result.status };
}
const prisma = (label, args, url) =>
  run(label, ["pnpm", "--dir", api, "exec", "prisma", ...args], {
    DATABASE_URL: url,
  });
const pools = [];
function pool(url) {
  const p = new Pool({ connectionString: url });
  pools.push(p);
  return p;
}
const quoted = (name) => `"${name.replaceAll('"', '""')}"`;
async function snapshot(db) {
  const { rows } = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
  );
  const result = {};
  for (const { tablename } of rows) {
    const { rows: data } = await db.query(
      `SELECT to_jsonb(t) AS row FROM ${quoted(tablename)} t ORDER BY to_jsonb(t)::text`,
    );
    result[tablename] = data.map(({ row }) => {
      if (tablename === "Assessment")
        for (const field of [
          "lifecycleState",
          "lifecycleRevision",
          "blockerReason",
          "blockerReference",
        ])
          delete row[field];
      return row;
    });
  }
  return result;
}
async function seed(db) {
  await db.query(`
    INSERT INTO "User" (id,email,"passwordHash","emailVerified","failedLoginCount","updatedAt")
      VALUES ('owner-a','a@w12.test','synthetic',true,0,now()),('owner-b','b@w12.test','synthetic',true,0,now());
    INSERT INTO "Assessment" (id,"ownerId",name,status,"updatedAt")
      SELECT 'legacy-' || s::text,'owner-a','historical ' || s::text,s,now() FROM unnest(enum_range(NULL::"AssessmentStatus")) s;
    INSERT INTO "AssessmentRuntimeTurn" (id,"assessmentId","threadId",boundary,"logicalRunId","correlationId",state,"contextJson","checkpointJson","updatedAt")
      VALUES ('turn-v1','legacy-READY_FOR_REVIEW','v1-thread','legacy','v1-run','v1-correlation','COMPLETED','{"private":"synthetic v1 context"}','{"checkpoint":"v1"}',now());
    INSERT INTO "AssessmentRuntimeEvent" (id,"assessmentId","runId","correlationId",sequence,"eventType","runStatus",stage,summary)
      VALUES ('event-v1','legacy-READY_FOR_REVIEW','v1-run','v1-correlation',1,'RUN_COMPLETED','COMPLETED','FINAL_ASSESSMENT','historical event');
    INSERT INTO "AssessmentInterviewThread" (id,"assessmentId","stateJson","updatedAt")
      VALUES ('interview-v1','legacy-WIZARD_SUBMITTED','{"historical":true}',now());
    INSERT INTO "EngineeringRuleAssessment" (id,"assessmentId","engineeringRuleId","engineeringRuleVersion","repositoryVersion","contextRevision",status,"resultId",criteria,limitations,execution,attempt,"updatedAt")
      VALUES ('decision-v1','legacy-READY_FOR_REVIEW','ER-old','old-rule','old-repo',3,'COMPLETED','result-v1','{"meaning":"historical only"}',ARRAY[]::text[],'{}',1,now());
    INSERT INTO "OutboxMessage" (id,"aggregateType","aggregateId","eventType",payload)
      VALUES ('outbox-v1','ASSESSMENT','legacy-WIZARD_SUBMITTED','legacy.command','{"historical":true}');
    INSERT INTO "BillingWallet" (id,"userId","availableCredits","updatedAt") VALUES ('wallet-v1','owner-a',10000,now());
    INSERT INTO "BillingReservation" (id,"userId","walletId","assessmentId","amountCredits","updatedAt")
      VALUES ('reservation-v1','owner-a','wallet-v1','legacy-READY_FOR_REVIEW',200,now());
    INSERT INTO "LlmUsageEvent" (id,"userId","assessmentId",provider,model,"invocationId","reservationId","inputTokens","totalTokens")
      VALUES ('usage-v1','owner-a','legacy-READY_FOR_REVIEW','synthetic','synthetic','invocation-v1','reservation-v1',10,10);
    INSERT INTO "LegalCorpusVersion" (id,version,status,"sourceManifest") VALUES ('corpus-v1','v1','APPROVED','{"historical":true}');
    INSERT INTO "LegalRuleCatalogVersion" (id,version,status,"ruleRefs") VALUES ('catalog-v1','v1','APPROVED','[]');
    INSERT INTO "CorpusApprovalRecord" (id,"legalCorpusVersionId","approvedBy",status,"scopeDescription")
      VALUES ('corpus-approval-v1','corpus-v1','owner-a','APPROVED','historical');
    INSERT INTO "RuleApprovalRecord" (id,"legalRuleCatalogVersionId","approvedBy",status,"scopeDescription")
      VALUES ('rule-approval-v1','catalog-v1','owner-a','APPROVED','historical');
  `);
}
async function constraints(db, label) {
  const enums = (
    await db.query(`SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname IN
    ('AssessmentLifecycleState','AgentExecutionState','BlockerReason','AssessmentEventType','AssessmentEventActorType') GROUP BY t.typname`)
  ).rows;
  const prismaEnums = createRequire(path.join(api, "package.json"))(
    "@prisma/client",
  );
  for (const name of [
    "AssessmentLifecycleState",
    "AgentExecutionState",
    "BlockerReason",
    "AssessmentEventType",
    "AssessmentEventActorType",
  ]) {
    const values = Object.values(prismaEnums[name]);
    check(name, enums.find((e) => e.typname === name)?.values, values);
    check(
      `${name} uppercase persistence values`,
      values.every((value) => /^[A-Z][A-Z0-9_]*$/.test(value)),
      true,
    );
  }
  const { rows } =
    await db.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid IN ('"Assessment"'::regclass,'"AssessmentRuntime"'::regclass,'"AssessmentEvent"'::regclass,'"OutboxMessage"'::regclass) ORDER BY conname`);
  writeFileSync(
    path.join(logs, `${label}-constraints.json`),
    JSON.stringify(rows, null, 2),
  );
  const names = rows.map((r) => r.conname);
  for (const name of [
    "AssessmentRuntime_pkey",
    "AssessmentRuntime_assessmentId_fkey",
    "AssessmentEvent_pkey",
    "AssessmentEvent_assessmentId_fkey",
    "AssessmentEvent_assessmentId_threadId_fkey",
    "AssessmentEvent_outboxMessageId_assessmentId_fkey",
    "Assessment_lifecycle_pair_check",
    "Assessment_lifecycle_revision_check",
    "Assessment_blocker_check",
    "AssessmentRuntime_event_sequence_check",
    "AssessmentRuntime_lease_pair_check",
    "AssessmentRuntime_lease_execution_check",
    "AssessmentEvent_sequence_check",
    "AssessmentEvent_payload_check",
    "AssessmentEvent_token_usage_check",
    "AssessmentEvent_child_lineage_check",
    "AssessmentEvent_parent_execution_check",
  ])
    check(name, names.includes(name), true);
  check(
    "thread composite FK",
    rows.find((r) => r.conname === "AssessmentEvent_assessmentId_threadId_fkey")
      .definition,
    'FOREIGN KEY ("assessmentId", "threadId") REFERENCES "AssessmentRuntime"("assessmentId", "threadId") ON UPDATE RESTRICT ON DELETE CASCADE',
  );
  check(
    "outbox composite FK",
    rows.find(
      (r) => r.conname === "AssessmentEvent_outboxMessageId_assessmentId_fkey",
    ).definition,
    'FOREIGN KEY ("outboxMessageId", "assessmentId") REFERENCES "OutboxMessage"(id, "aggregateId") ON UPDATE RESTRICT ON DELETE RESTRICT',
  );
  const indexes = (
    await db.query(
      `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('AssessmentRuntime','AssessmentEvent','OutboxMessage') ORDER BY indexname`,
    )
  ).rows;
  writeFileSync(
    path.join(logs, `${label}-indexes.json`),
    JSON.stringify(indexes, null, 2),
  );
  for (const name of [
    "AssessmentRuntime_threadId_key",
    "AssessmentRuntime_assessmentId_threadId_key",
    "AssessmentEvent_outboxMessageId_key",
    "AssessmentEvent_assessmentId_sequence_key",
    "AssessmentEvent_outboxMessageId_assessmentId_key",
    "OutboxMessage_id_aggregateId_key",
  ])
    check(
      name,
      indexes.some(
        (r) =>
          r.indexname === name && r.indexdef.startsWith("CREATE UNIQUE INDEX"),
      ),
      true,
    );
}
async function reject(db, label, sql, params, code, constraint) {
  await assert.rejects(
    db.query(sql, params),
    (error) =>
      error.code === code && (!constraint || error.constraint === constraint),
    label,
  );
  checks++;
}
// Exercises the planned W1.3 transaction protocol; this is not an API implementation.
async function append(
  db,
  assessmentId,
  eventId,
  expectedRevision,
  abort = false,
) {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    const runtime = (
      await tx.query(
        'SELECT * FROM "AssessmentRuntime" WHERE "assessmentId"=$1 FOR UPDATE',
        [assessmentId],
      )
    ).rows[0];
    const existing = (
      await tx.query('SELECT * FROM "AssessmentEvent" WHERE "eventId"=$1', [
        eventId,
      ])
    ).rows[0];
    if (existing) {
      assert.equal(existing.assessmentId, assessmentId);
      await tx.query("COMMIT");
      return existing;
    }
    let eventType = "ACTIVITY_RECORDED";
    let payload = { kind: "MODEL", labelKey: "assessment.activity.reasoning" };
    if (expectedRevision !== undefined) {
      const fromState = (
        await tx.query(
          'SELECT "lifecycleState" FROM "Assessment" WHERE id=$1',
          [assessmentId],
        )
      ).rows[0].lifecycleState;
      const toState = expectedRevision === 0 ? "PREPARING" : "ACTIVE";
      const cas = await tx.query(
        'UPDATE "Assessment" SET "lifecycleState"=$3,"lifecycleRevision"="lifecycleRevision"+1 WHERE id=$1 AND "lifecycleRevision"=$2 RETURNING "lifecycleRevision"',
        [assessmentId, expectedRevision, toState],
      );
      assert.equal(cas.rowCount, 1, "stale lifecycle revision");
      eventType = "ASSESSMENT_LIFECYCLE_CHANGED";
      payload = {
        fromState,
        toState,
        assessmentRevision: cas.rows[0].lifecycleRevision,
      };
    }
    const sequence = (
      await tx.query(
        'UPDATE "AssessmentRuntime" SET "eventSequence"="eventSequence"+1 WHERE "assessmentId"=$1 RETURNING "eventSequence"',
        [assessmentId],
      )
    ).rows[0].eventSequence;
    const timestamp = new Date().toISOString();
    await tx.query(
      'INSERT INTO "OutboxMessage" (id,"aggregateType","aggregateId","eventType",payload) VALUES ($1,\'ASSESSMENT\',$2,$3,$4)',
      [
        eventId,
        assessmentId,
        eventType,
        {
          eventId,
          assessmentId,
          threadId: runtime.threadId,
          sequence,
          timestamp,
          actorType: "API",
          eventType,
          payload,
        },
      ],
    );
    const event = (
      await tx.query(
        'INSERT INTO "AssessmentEvent" ("eventId","assessmentId","threadId",sequence,"eventType","actorType",payload,"outboxMessageId",timestamp) VALUES ($1::uuid,$2,$3,$4,$5,\'API\',$6,$1::text,$7) RETURNING *',
        [
          eventId,
          assessmentId,
          runtime.threadId,
          sequence,
          eventType,
          payload,
          timestamp,
        ],
      )
    ).rows[0];
    if (abort) throw new Error("injected rollback");
    await tx.query("COMMIT");
    return event;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
async function exercise(db, label) {
  await constraints(db, label);
  await db.query(`INSERT INTO "User" (id,email,"passwordHash","emailVerified","failedLoginCount","updatedAt") VALUES ('test-owner','runtime@w12.test','synthetic',true,0,now());
    INSERT INTO "Assessment" (id,"ownerId",name,"lifecycleState","lifecycleRevision","updatedAt") VALUES ('a','test-owner','a','CREATED',0,now()),('b','test-owner','b','CREATED',0,now()),('v1','test-owner','v1',NULL,NULL,now());`);
  const threadA = randomUUID(),
    threadB = randomUUID();
  const insertRuntime =
    'INSERT INTO "AssessmentRuntime" ("assessmentId","threadId","rootAgentVersion","checkpointNamespace","updatedAt") VALUES ($1,$2::uuid,\'root-v2\',$2::text,now())';
  await db.query(insertRuntime, ["a", threadA]);
  await db.query(insertRuntime, ["b", threadB]);
  await reject(
    db,
    "one runtime per assessment",
    insertRuntime,
    ["a", randomUUID()],
    "23505",
    "AssessmentRuntime_pkey",
  );
  await reject(
    db,
    "one assessment per thread",
    insertRuntime,
    ["v1", threadA],
    "23505",
    "AssessmentRuntime_threadId_key",
  );
  await reject(
    db,
    "runtime orphan",
    insertRuntime,
    ["missing", randomUUID()],
    "23503",
  );
  await reject(
    db,
    "lifecycle pair",
    'UPDATE "Assessment" SET "lifecycleRevision"=0 WHERE id=\'v1\'',
    [],
    "23514",
    "Assessment_lifecycle_pair_check",
  );
  await reject(
    db,
    "negative revision",
    'UPDATE "Assessment" SET "lifecycleRevision"=-1 WHERE id=\'a\'',
    [],
    "23514",
  );
  await reject(
    db,
    "V1 blocker NULL loophole",
    "UPDATE \"Assessment\" SET \"blockerReason\"='LEGAL_PORTFOLIO_UNAVAILABLE',\"blockerReference\"='{}' WHERE id='v1'",
    [],
    "23514",
    "Assessment_blocker_check",
  );
  await reject(
    db,
    "nonblocked blocker",
    "UPDATE \"Assessment\" SET \"blockerReason\"='LEGAL_PORTFOLIO_UNAVAILABLE',\"blockerReference\"='{}' WHERE id='a'",
    [],
    "23514",
  );
  await reject(
    db,
    "blocked missing reference",
    "UPDATE \"Assessment\" SET \"lifecycleState\"='BLOCKED',\"blockerReason\"='LEGAL_PORTFOLIO_UNAVAILABLE' WHERE id='a'",
    [],
    "23514",
  );
  await reject(
    db,
    "negative counter",
    'UPDATE "AssessmentRuntime" SET "eventSequence"=-1 WHERE "assessmentId"=\'a\'',
    [],
    "23514",
  );
  await reject(
    db,
    "lease pair",
    'UPDATE "AssessmentRuntime" SET "leaseToken"=$1 WHERE "assessmentId"=\'a\'',
    [randomUUID()],
    "23514",
  );
  await reject(
    db,
    "lease execution",
    'UPDATE "AssessmentRuntime" SET "leaseToken"=$1,"leaseExpiresAt"=now() WHERE "assessmentId"=\'a\'',
    [randomUUID()],
    "23514",
  );
  const firstId = randomUUID();
  const first = await append(db, "a", firstId, 0);
  check("first sequence", first.sequence, 1);
  check("paired lifecycle event", first.payload, {
    fromState: "CREATED",
    toState: "PREPARING",
    assessmentRevision: 1,
  });
  check(
    "outbox persisted envelope",
    (
      await db.query('SELECT payload FROM "OutboxMessage" WHERE id=$1', [
        firstId,
      ])
    ).rows[0].payload,
    {
      eventId: first.eventId,
      assessmentId: first.assessmentId,
      threadId: first.threadId,
      sequence: first.sequence,
      timestamp: first.timestamp.toISOString(),
      actorType: first.actorType,
      eventType: first.eventType,
      payload: first.payload,
    },
  );
  const replay = await Promise.all(
    Array.from({ length: 8 }, () => append(db, "a", firstId, 0)),
  );
  check(
    "replays return persisted event",
    replay.every((e) => e.sequence === 1 && e.eventId === firstId),
    true,
  );
  const concurrent = await Promise.all(
    Array.from({ length: 12 }, () => append(db, "a", randomUUID())),
  );
  check(
    "monotonic concurrent allocation",
    concurrent.map((e) => e.sequence).sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, i) => i + 2),
  );
  const before = await snapshot(db);
  await assert.rejects(
    append(db, "a", randomUUID(), 0),
    /stale lifecycle revision/,
  );
  checks++;
  await assert.rejects(
    append(db, "a", randomUUID(), 1, true),
    /injected rollback/,
  );
  checks++;
  check("state counter event outbox rollback", await snapshot(db), before);
  const foreign = await append(db, "b", randomUUID());
  check("sequences isolated", foreign.sequence, 1);
  const eventSql =
    'INSERT INTO "AssessmentEvent" ("eventId","assessmentId","threadId",sequence,"eventType","actorType",payload,"outboxMessageId") VALUES ($1,$2,$3,$4,\'ACTIVITY_RECORDED\',$5,$6,$7)';
  const freshOutbox = randomUUID();
  await db.query(
    "INSERT INTO \"OutboxMessage\" (id,\"aggregateType\",\"aggregateId\",\"eventType\",payload) VALUES ($1,'ASSESSMENT','a','ACTIVITY_RECORDED','{}')",
    [freshOutbox],
  );
  await reject(
    db,
    "duplicate event identity",
    eventSql,
    [firstId, "a", threadA, 100, "API", {}, freshOutbox],
    "23505",
    "AssessmentEvent_pkey",
  );
  await reject(
    db,
    "duplicate sequence",
    eventSql,
    [randomUUID(), "a", threadA, 1, "API", {}, freshOutbox],
    "23505",
    "AssessmentEvent_assessmentId_sequence_key",
  );
  await reject(
    db,
    "cross-assessment thread",
    eventSql,
    [randomUUID(), "a", threadB, 100, "API", {}, freshOutbox],
    "23503",
    "AssessmentEvent_assessmentId_threadId_fkey",
  );
  await reject(
    db,
    "cross-assessment outbox",
    eventSql,
    [randomUUID(), "a", threadA, 100, "API", {}, foreign.outboxMessageId],
    "23505",
  );
  const wrongOutbox = randomUUID();
  await db.query(
    "INSERT INTO \"OutboxMessage\" (id,\"aggregateType\",\"aggregateId\",\"eventType\",payload) VALUES ($1,'ASSESSMENT','b','ACTIVITY_RECORDED','{}')",
    [wrongOutbox],
  );
  await reject(
    db,
    "wrong aggregate FK",
    eventSql,
    [randomUUID(), "a", threadA, 100, "API", {}, wrongOutbox],
    "23503",
    "AssessmentEvent_outboxMessageId_assessmentId_fkey",
  );
  await reject(
    db,
    "missing outbox",
    eventSql,
    [randomUUID(), "a", threadA, 100, "API", {}, randomUUID()],
    "23503",
  );
  await reject(
    db,
    "nonpositive sequence",
    eventSql,
    [randomUUID(), "a", threadA, 0, "API", {}, freshOutbox],
    "23514",
  );
  await reject(
    db,
    "payload object",
    eventSql,
    [randomUUID(), "a", threadA, 100, "API", JSON.stringify([]), freshOutbox],
    "23514",
  );
  await reject(
    db,
    "subagent lineage",
    eventSql,
    [randomUUID(), "a", threadA, 100, "SUBAGENT", {}, freshOutbox],
    "23514",
  );
  await reject(
    db,
    "outbox deletion restricted",
    'DELETE FROM "OutboxMessage" WHERE id=$1',
    [firstId],
    "23503",
  );
  await reject(
    db,
    "mapping update restricted",
    'UPDATE "AssessmentRuntime" SET "threadId"=$1 WHERE "assessmentId"=\'a\'',
    [randomUUID()],
    "23503",
  );
  const next = async () =>
    (
      await db.query(`SELECT e.sequence FROM "AssessmentEvent" e JOIN "OutboxMessage" o ON o.id=e."outboxMessageId"
    WHERE e."assessmentId"='a' AND o.status <> 'PUBLISHED' AND NOT EXISTS
      (SELECT 1 FROM "AssessmentEvent" p JOIN "OutboxMessage" po ON po.id=p."outboxMessageId"
       WHERE p."assessmentId"=e."assessmentId" AND p.sequence<e.sequence AND po.status <> 'PUBLISHED') ORDER BY e.sequence`)
    ).rows.map((r) => r.sequence);
  check("ordered predecessor lookup", await next(), [1]);
  await db.query(
    "UPDATE \"OutboxMessage\" SET status='FAILED',\"nextAttemptAt\"=now()+interval '1 hour' WHERE id=$1",
    [firstId],
  );
  check("failed predecessor blocks successors", await next(), [1]);
  await db.query(
    'UPDATE "OutboxMessage" SET status=\'PUBLISHED\',"publishedAt"=now() WHERE id=$1',
    [firstId],
  );
  check("published predecessor unlocks next", await next(), [2]);
  check(
    "counter equals committed events",
    (
      await db.query(
        'SELECT "eventSequence" FROM "AssessmentRuntime" WHERE "assessmentId"=\'a\'',
      )
    ).rows[0].eventSequence,
    13,
  );
  check(
    "counter event outbox match",
    Number(
      (
        await db.query(
          'SELECT count(*) FROM "AssessmentEvent" e JOIN "OutboxMessage" o ON o.id=e."outboxMessageId" AND o."aggregateId"=e."assessmentId" WHERE e."assessmentId"=\'a\'',
        )
      ).rows[0].count,
    ),
    13,
  );
}

try {
  const sql = readFileSync(
    path.join(api, "prisma/migrations", migration, "migration.sql"),
    "utf8",
  );
  check(
    "expand only SQL",
    /^\s*(DROP|DELETE|TRUNCATE|UPDATE)\b/im.test(sql),
    false,
  );
  const historical = path.join(logs, "baseline/prisma");
  mkdirSync(path.join(historical, "migrations"), { recursive: true });
  const headSchema = run("baseline-schema", [
    "git",
    "show",
    `${baselineRef}:apps/api/prisma/schema.prisma`,
  ]).stdout;
  writeFileSync(path.join(historical, "schema.prisma"), headSchema);
  const entries = readdirSync(path.join(api, "prisma/migrations")).sort();
  check(
    "one last ordered migration",
    entries.filter((e) => e !== "migration_lock.toml").at(-1),
    migration,
  );
  for (const name of entries)
    if (name !== migration)
      cpSync(
        path.join(api, "prisma/migrations", name),
        path.join(historical, "migrations", name),
        { recursive: true },
      );
  run("docker-create", [
    "docker",
    "run",
    "-d",
    "--name",
    container,
    "--label",
    "lcsp.test=w12",
    "-e",
    "POSTGRES_PASSWORD=w12_disposable",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  run("docker-ready", [
    "docker",
    "exec",
    container,
    "sh",
    "-c",
    "for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -U postgres && exit 0; sleep 1; done; exit 1",
  ]);
  const address = run("docker-port", [
    "docker",
    "port",
    container,
    "5432/tcp",
  ]).stdout.trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const url = (name) =>
    `postgresql://postgres:w12_disposable@${address}/${name}`;
  for (const name of ["w12_clean", "w12_upgrade"])
    run(`create-${name}`, [
      "docker",
      "exec",
      container,
      "createdb",
      "-U",
      "postgres",
      name,
    ]);
  const config = path.join(logs, "baseline.config.mjs");
  writeFileSync(
    config,
    `import {createRequire} from 'node:module'; const {defineConfig}=createRequire(${JSON.stringify(path.join(api, "package.json"))})('prisma/config'); export default defineConfig({schema:${JSON.stringify(path.join(historical, "schema.prisma"))},migrations:{path:${JSON.stringify(path.join(historical, "migrations"))}},datasource:{url:process.env.DATABASE_URL}});`,
  );
  prisma("validate", ["validate"], url("w12_clean"));
  prisma("generate", ["generate"], url("w12_clean"));
  prisma(
    "baseline-deploy",
    ["migrate", "deploy", "--config", config],
    url("w12_upgrade"),
  );
  const upgrade = pool(url("w12_upgrade")),
    clean = pool(url("w12_clean"));
  await seed(upgrade);
  const preserved = await snapshot(upgrade);
  writeFileSync(
    path.join(logs, "preserved-counts.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(preserved).map(([name, rows]) => [name, rows.length]),
      ),
      null,
      2,
    ),
  );
  const baselineDiff = run(
    "baseline-drift",
    [
      "pnpm",
      "--dir",
      api,
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--config",
      config,
      "--from-config-datasource",
      "--to-schema",
      path.join(historical, "schema.prisma"),
      "--script",
      "--exit-code",
    ],
    { DATABASE_URL: url("w12_upgrade") },
    [0, 2],
  );
  prisma("clean-deploy", ["migrate", "deploy"], url("w12_clean"));
  prisma("upgrade-deploy", ["migrate", "deploy"], url("w12_upgrade"));
  const after = await snapshot(upgrade);
  delete after.AssessmentRuntime;
  delete after.AssessmentEvent;
  check("every V1 table and row preserved", after, preserved);
  check(
    "V1 lifecycle remains unassigned",
    Number(
      (
        await upgrade.query(
          'SELECT count(*) FROM "Assessment" WHERE "lifecycleState" IS NULL AND "lifecycleRevision" IS NULL',
        )
      ).rows[0].count,
    ),
    7,
  );
  check(
    "no invented V2 runtime",
    Number(
      (await upgrade.query('SELECT count(*) FROM "AssessmentRuntime"')).rows[0]
        .count,
    ),
    0,
  );
  check(
    "no semantic event backfill",
    Number(
      (await upgrade.query('SELECT count(*) FROM "AssessmentEvent"')).rows[0]
        .count,
    ),
    0,
  );
  for (const [label, db] of [
    ["clean", clean],
    ["upgrade", upgrade],
  ]) {
    const currentDiff = run(
      `${label}-drift`,
      [
        "pnpm",
        "--dir",
        api,
        "exec",
        "prisma",
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        path.join(api, "prisma/schema.prisma"),
        "--script",
        "--exit-code",
      ],
      { DATABASE_URL: url(`w12_${label}`) },
      [0, 2],
    );
    check(
      `${label} drift unchanged from V1`,
      currentDiff.stdout,
      baselineDiff.stdout,
    );
    await exercise(db, label);
    const beforeReplay = await snapshot(db);
    prisma(`${label}-redeploy`, ["migrate", "deploy"], url(`w12_${label}`));
    check(
      `${label} migration replay preserves rows`,
      await snapshot(db),
      beforeReplay,
    );
  }
  console.log(
    `PASS: ${checks} assertions; clean install and populated upgrade. Whole-schema drift exit ${baselineDiff.status}, identical to V1 baseline (not a whole-schema PASS). Logs: ${logs}`,
  );
  writeFileSync(
    path.join(logs, "result.json"),
    JSON.stringify(
      { outcome: "PASS", checks, baselineDriftExit: baselineDiff.status, logs },
      null,
      2,
    ),
  );
} finally {
  await Promise.all(pools.map((p) => p.end()));
  run("docker-remove", ["docker", "rm", "-f", container]);
}
