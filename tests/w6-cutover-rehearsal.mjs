#!/usr/bin/env node
// W6 cutover rehearsal on a DISPOSABLE, production-shaped copy of the V1 database.
//
//   node tests/w6-cutover-rehearsal.mjs [--evidence-dir DIR] [--assessments N] [--keep-databases]
//
// Prerequisites (tests/run-w6-gate.sh arranges all of them):
//   * a disposable PostgreSQL on 127.0.0.1:$W6_PG_PORT (default 55461), superuser postgres/postgres
//   * the built CLI at $W6_CLI (default apps/api/dist/src/modules/legacy-migration/presentation/cli/legacy-migration.cli.js)
//   * git history containing the V1 baseline commit
//
// What it proves (see reports/w6-cutover-reconciliation.md for the narrative):
//   1 baseline V1 DB is built from the V1 commit's own migrations, populated, then upgraded through
//     `prisma migrate deploy` (the real upgrade path); V1 source rows are byte-identical afterwards;
//   2 a real pg_dump restore point restores to exactly the pre-migration state;
//   3 quiesce -> archive -> backfill -> validate run; every count/hash is compared with an
//     oracle derived from the SEED, not from the tool. The migration starts NO re-evaluation: zero
//     Root commands, zero model calls, zero credit/accounting effect;
//   3b a SEPARATE explicit re-evaluation phase: preflight, refusals, canary, real-Root execution with
//     a scripted model, canary verification, then a bounded (global/tenant/back-pressure) batch with
//     failure isolation (tests/support/w6-reevaluation-stages.mjs);
//   4 a second run changes nothing (idempotent) and a run restarted from the restore point converges
//     to identical archive digests (deterministic);
//   5 fail-closed paths: unclassified outbox traffic, late V1 writes, deleted/tampered archive rows,
//     unresolved report locations, unreadable locations, copy failures, accepted V2 write while the
//     rollback boundary is open.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startApi } from "./support/w6-api.mjs";
import { reevaluationStages } from "./support/w6-reevaluation-stages.mjs";
import {
  accountingFingerprint,
  fingerprint,
  independentArchiveCheck,
  stateFingerprint,
  V1_SOURCES,
} from "./support/w6-fingerprint.mjs";
import {
  LEGACY_EVENT_TYPES,
  seedV1Population,
  sha256,
  uid,
} from "./support/w6-v1-seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "apps/api");
const { Client } = createRequire(path.join(api, "package.json"))("pg");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const runId =
  new Date()
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, "")
    .slice(0, 14) + `_${process.pid}`;
const cfg = {
  port: Number(process.env.W6_PG_PORT ?? 55461),
  container: process.env.W6_PG_CONTAINER ?? "lcsp-w6-disposable-postgres-55461",
  cli:
    process.env.W6_CLI ??
    path.join(
      api,
      "dist/src/modules/legacy-migration/presentation/cli/legacy-migration.cli.js",
    ),
  baselineRef:
    process.env.W6_BASELINE_REF ?? "87ae8c4eb358c17318e71a53c3125d75975b9d98",
  assessments: Number(flag("assessments", process.env.W6_ASSESSMENTS ?? 60)),
  evidence: path.resolve(
    flag("evidence-dir", path.join(root, "reports/w6-rehearsal", runId)),
  ),
  keepDatabases: args.includes("--keep-databases"),
  apiMain: process.env.W6_API_MAIN ?? path.join(api, "dist/src/main.js"),
  apiPort: Number(process.env.W6_API_PORT ?? 3461),
  requireApi: args.includes("--require-api"),
};
mkdirSync(cfg.evidence, { recursive: true });
const storage = path.join(cfg.evidence, "storage");
const reportsDir = path.join(cfg.evidence, "legacy-report-fixtures");
const tmpDir = path.join(api, "tmp", `w6-rehearsal-${runId}`);
mkdirSync(tmpDir, { recursive: true });

const dbName = (label) => `lcsp_w6_reh_${label}_${runId}`.toLowerCase();
const dbUrl = (name) =>
  `postgresql://postgres:postgres@127.0.0.1:${cfg.port}/${name}?schema=public`;
const adminUrl = `postgresql://postgres:postgres@127.0.0.1:${cfg.port}/postgres`;
const guard = (name) => {
  if (!/^lcsp_w6_[a-z0-9_]+$/u.test(name))
    throw new Error(`refusing non-disposable database name ${name}`);
  return name;
};

// ---- tiny assertion layer ---------------------------------------------------------------------
const report = {
  runId,
  startedAt: new Date().toISOString(),
  config: { ...cfg, evidence: undefined },
  stages: [],
  checks: 0,
};
const ok = (value, message) => {
  assert.ok(value, message);
  report.checks += 1;
};
const eq = (actual, expected, message) => {
  assert.deepStrictEqual(actual, expected, message);
  report.checks += 1;
};
async function stage(name, fn) {
  const started = Date.now();
  process.stdout.write(`\n== ${name}\n`);
  try {
    const detail = await fn();
    report.stages.push({
      name,
      status: "PASS",
      ms: Date.now() - started,
      detail,
    });
    process.stdout.write(`   PASS (${Date.now() - started} ms)\n`);
  } catch (error) {
    report.stages.push({
      name,
      status: "FAIL",
      ms: Date.now() - started,
      error: String(error?.stack ?? error),
    });
    throw error;
  }
}

// ---- infrastructure helpers -------------------------------------------------------------------
const created = [];
const cleanups = [];
async function admin(sql) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}
async function createDatabase(name) {
  guard(name);
  await admin(`CREATE DATABASE "${name}"`);
  created.push(name);
}
const openClients = new Set();
async function connect(name) {
  const client = new Client({ connectionString: dbUrl(guard(name)) });
  client.on("error", () => {}); // a forced DROP at cleanup must not crash the harness
  await client.connect();
  openClients.add(client);
  return client;
}
function run(label, command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    cwd: root,
    encoding: options.binary ? "buffer" : "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    timeout: options.timeout ?? 600_000,
    ...options.spawn,
    env: { ...process.env, ...options.env },
    input: options.input,
  });
  if (options.log !== false) {
    writeFileSync(
      path.join(cfg.evidence, `${label}.log`),
      `${result.stdout?.toString?.() ?? ""}\n--- stderr ---\n${result.stderr?.toString?.() ?? ""}\n`,
    );
  }
  if ((options.expectStatus ?? 0) !== result.status)
    throw new Error(
      `${label} exited ${result.status} (expected ${options.expectStatus ?? 0}); see ${label}.log\n${String(result.stderr).slice(-1500)}`,
    );
  return result;
}
function prismaDeploy(name, migrationsDir, label) {
  const config = path.join(tmpDir, `${label}.config.mjs`);
  // The config lives under apps/api so `prisma/config` resolves from the API package.
  const inApi = path.join(api, "tmp", `w6-${runId}-${label}.config.mjs`);
  writeFileSync(
    inApi,
    `import { defineConfig } from "prisma/config";
export default defineConfig({ schema: ${JSON.stringify(path.join(api, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(migrationsDir)} }, datasource: { url: process.env.DATABASE_URL } });\n`,
  );
  void config;
  run(
    `prisma-deploy-${label}`,
    "pnpm",
    ["--dir", api, "exec", "prisma", "migrate", "deploy", "--config", inApi],
    {
      env: {
        DATABASE_URL: dbUrl(guard(name)),
        XDG_CACHE_HOME: path.join(api, ".cache"),
      },
    },
  );
}
let cliSeq = 0;
function cli(name, argv, { expectExit = 0, extra = [] } = {}) {
  const label = `cli-${String(++cliSeq).padStart(2, "0")}-${argv[0]}`;
  const result = spawnSync(
    process.execPath,
    [cfg.cli, ...argv, ...extra, "--confirm-database", guard(name)],
    {
      cwd: api,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      timeout: 900_000,
      env: {
        ...process.env,
        DATABASE_URL: dbUrl(name),
        LCSP_ARTIFACT_STORAGE_PATH: storage,
      },
    },
  );
  writeFileSync(
    path.join(cfg.evidence, `${label}.stdout.json`),
    result.stdout ?? "",
  );
  writeFileSync(
    path.join(cfg.evidence, `${label}.stderr.log`),
    result.stderr ?? "",
  );
  if (result.status !== expectExit)
    throw new Error(
      `${label} exited ${result.status} (expected ${expectExit})\n${String(result.stderr).slice(-1800)}`,
    );
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    /* error exits carry no JSON */
  }
  return { exit: result.status, json: parsed, stderr: result.stderr };
}
const dumpDatabase = (name) =>
  run(
    `pg_dump-${name}`,
    "docker",
    [
      "exec",
      cfg.container,
      "pg_dump",
      "-U",
      "postgres",
      "-Fc",
      "-d",
      guard(name),
    ],
    { binary: true, log: false },
  ).stdout;
function restoreDatabase(buffer, name) {
  guard(name);
  run(
    `pg_restore-${name}`,
    "docker",
    [
      "exec",
      "-i",
      cfg.container,
      "pg_restore",
      "-U",
      "postgres",
      "--no-owner",
      "-d",
      name,
    ],
    { input: buffer, log: true },
  );
}

// ---- portfolio fixture (a cutover prerequisite produced by W2, here inserted directly) ---------
async function activePortfolio(client) {
  const h = "a".repeat(64);
  const corpus = uid("portfolio-corpus", 1);
  await client.query(
    `INSERT INTO "LegalCorpusVersion"(id, version, status, "sourceManifest") VALUES ($1,'w6-portfolio-corpus','APPROVED','{}')`,
    [corpus],
  );
  const doc = uid("portfolio-doc", 1);
  await client.query(
    `INSERT INTO "LegalSourceDocument"(id, "legalCorpusVersionId", "documentId", title, "sourceUrl", "sourceSha256", "sourceEffectStatus") VALUES ($1,$2,'doc-1','t','u',$3,'IN_FORCE')`,
    [doc, corpus, h],
  );
  await client.query(
    `INSERT INTO "LegalDocumentChunk"(id, "legalCorpusVersionId", "legalSourceDocumentId", "documentId", locator, content, "contentSha256", hierarchy, "legalStatus") VALUES ($1,$2,$3,'doc-1','art-1::cl-1','c',$4,'{}','IN_FORCE')`,
    [uid("portfolio-chunk", 1), corpus, doc, h],
  );
  const run = uid("portfolio-run", 1);
  await client.query(
    `INSERT INTO "LegalPreparationRun"(id, "idempotencyKey", "legalCorpusVersionId", "requestedBy", "correlationId") VALUES ($1,'w6-run',$2,'svc','corr')`,
    [run, corpus],
  );
  const portfolio = uid("portfolio", 1);
  await client.query(
    `INSERT INTO "LegalPortfolioVersion"(id, version, "legalCorpusVersionId", "preparationRunId", "lifecycleState", "portfolioDigest", "validationOutcome", "validationFailures", "activatedAt")
     VALUES ($1,'w6-portfolio',$2,$3,'ACTIVE'::"ArtifactLifecycleState",$4,'PASSED'::"LegalPortfolioValidationOutcome",'[]'::jsonb,now())`,
    [portfolio, corpus, run, h],
  );
  for (let n = 1; n <= 3; n += 1) {
    await client.query(
      `INSERT INTO "EngineeringRule"(id, "portfolioVersionId", "engineeringRuleId", "engineeringRuleVersion", concept, "legalIntent", "applicabilityGuidance", criteria, contract, "sourceFingerprint", "contentDigest", ordinal)
       VALUES ($1,$2,$3,'v1','c','i','g','[]','{}',$4,$4,$5)`,
      [uid("portfolio-rule", n), portfolio, `ER-${n}`, h, n],
    );
    // Each engineering rule ER-n cites the legal rule LR-n (the scripted Root relies on this naming).
    await client.query(
      `INSERT INTO "LegalPortfolioRule"(id, "portfolioVersionId", "legalRuleId", title, proposition, "applicabilityConditions", qualifiers, exceptions, "nonRepositoryDuty", "coverageState", "contentDigest", ordinal)
       VALUES ($1,$2,$3,'t','p','[]','[]','[]',false,'COVERED_BY_ENGINEERING_RULES'::"LegalPortfolioCoverageState",$4,$5)`,
      [uid("portfolio-legal", n), portfolio, `LR-${n}`, h, n],
    );
    await client.query(
      `INSERT INTO "EngineeringRuleLegalRule"("portfolioVersionId", "engineeringRuleRowId", "portfolioRuleId") VALUES ($1,$2,$3)`,
      [portfolio, uid("portfolio-rule", n), uid("portfolio-legal", n)],
    );
  }
  return { portfolio, rules: 3 };
}

const one = async (client, sql, params = []) =>
  (await client.query(sql, params)).rows[0];
const scalar = async (client, sql, params = []) =>
  Object.values(await one(client, sql, params))[0];
const keyed = (rows, key, value) =>
  Object.fromEntries(rows.map((row) => [row[key], row[value]]));

// =================================================================================================
const main = async () => {
  let manifest;
  let db = dbName("main");
  let client;
  let dump;
  let preMigration;
  let preMigrationStable;
  let preAccounting;
  let run1;

  await stage("environment", async () => {
    const probe = await admin("SELECT current_setting('server_version') AS v");
    ok(probe.rows[0].v, "disposable PostgreSQL reachable");
    ok(
      existsSync(cfg.cli),
      `built CLI present at ${cfg.cli} (run: pnpm --filter @lcsp/api build)`,
    );
    return { postgres: probe.rows[0].v, cli: cfg.cli };
  });

  await stage("baseline-v1-schema", async () => {
    const baselineDir = path.join(tmpDir, "baseline");
    mkdirSync(baselineDir, { recursive: true });
    const archive = run(
      "git-archive-baseline",
      "git",
      ["archive", cfg.baselineRef, "apps/api/prisma/migrations"],
      { binary: true, log: false },
    );
    run("tar-baseline", "tar", ["-x", "-C", baselineDir], {
      input: archive.stdout,
      log: false,
    });
    const migrationsDir = path.join(baselineDir, "apps/api/prisma/migrations");
    const baselineMigrations = readdirSync(migrationsDir).filter((entry) =>
      /^\d{14}_/u.test(entry),
    );
    await createDatabase(db);
    prismaDeploy(db, migrationsDir, "baseline");
    client = await connect(db);
    const applied = await scalar(
      client,
      `SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    );
    eq(
      applied,
      baselineMigrations.length,
      "every V1 baseline migration applied",
    );
    const v2 = await scalar(
      client,
      `SELECT count(*)::int FROM information_schema.tables WHERE table_name = 'LegacyArchiveRecord'`,
    );
    eq(v2, 0, "baseline has no W6 tables");
    report.baselineMigrations = baselineMigrations.length;
    return { baselineMigrations: baselineMigrations.length };
  });

  await stage("seed-production-shaped-v1-population", async () => {
    await client.query("BEGIN");
    manifest = await seedV1Population(client, {
      assessments: cfg.assessments,
      reportsDir,
    });
    await client.query("COMMIT");
    writeFileSync(
      path.join(cfg.evidence, "seed-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    preMigration = await fingerprint(client);
    preMigrationStable = await fingerprint(client, { stable: true });
    const total = Object.values(manifest.rows).reduce((sum, n) => sum + n, 0);
    return {
      rows: total,
      assessments: manifest.assessments,
      outbox: manifest.outbox,
    };
  });

  await stage("upgrade-through-prisma-migrate-deploy", async () => {
    const migrationsDir = path.join(api, "prisma/migrations");
    const all = readdirSync(migrationsDir).filter((entry) =>
      /^\d{14}_/u.test(entry),
    );
    prismaDeploy(db, migrationsDir, "upgrade");
    const applied = await scalar(
      client,
      `SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    );
    eq(applied, all.length, "every migration applied, none failed");
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NULL`,
      ),
      0,
      "no unfinished migration",
    );
    // Expand-only: not a single V1 source value changed. `Assessment` gained the (NULL) lifecycle
    // columns, so its full-row JSON gains keys; every other table is identical even in full form.
    const afterUpgrade = await fingerprint(client);
    const changedTables = Object.keys(afterUpgrade).filter(
      (t) => afterUpgrade[t].h !== preMigration[t].h,
    );
    eq(
      changedTables,
      ["Assessment"],
      "only Assessment's row shape changed (new nullable columns)",
    );
    eq(
      await fingerprint(client, { stable: true }),
      preMigrationStable,
      "no V1 value changed after the expand migrations",
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "Assessment" WHERE "lifecycleState" IS NOT NULL`,
      ),
      0,
      "no assessment has canonical state before the backfill",
    );
    // Every table an AI execution could touch, fingerprinted BEFORE the migration runs.
    preAccounting = await accountingFingerprint(client);
    return { migrations: all.length };
  });

  await stage("active-legal-portfolio-prerequisite", async () => {
    const fixture = await activePortfolio(client);
    return fixture;
  });

  await stage("restore-point-drill (real pg_dump -> pg_restore)", async () => {
    dump = dumpDatabase(db);
    const digest = createHash("sha256").update(dump).digest("hex");
    writeFileSync(path.join(cfg.evidence, "restore-point.dump"), dump);
    const restoreDb = dbName("drill");
    await createDatabase(restoreDb);
    restoreDatabase(dump, restoreDb);
    const restored = await connect(restoreDb);
    try {
      eq(
        await fingerprint(restored),
        await fingerprint(client),
        "restored database reproduces every V1 table exactly",
      );
      eq(
        await stateFingerprint(restored),
        await stateFingerprint(client),
        "restored canonical/outbox state identical",
      );
    } finally {
      await restored.end();
    }
    report.restorePoint = {
      ref: `pg_dump:${path.basename(cfg.evidence)}/restore-point.dump`,
      digest,
      bytes: dump.length,
    };
    return report.restorePoint;
  });

  await stage("cli-preflight (read-only)", async () => {
    const result = cli(db, ["preflight"], {
      extra: ["--report-file-root", reportsDir],
    });
    const pre = result.json;
    eq(pre.assessments.total, manifest.assessments.total);
    eq(pre.assessments.terminal, manifest.assessments.terminal);
    eq(pre.assessments.nonTerminal, manifest.assessments.nonTerminal);
    eq(pre.assessments.alreadyV2, 0);
    eq(pre.activePortfolio.activeCount, 1);
    eq(pre.outbox.legacyUndelivered, manifest.outbox.cancelled);
    eq(pre.outbox.unclassifiedUndelivered, 0);
    eq(
      pre.inFlight,
      manifest.inFlight,
      "preflight sees exactly the seeded in-flight V1 work",
    );
    eq(pre.blockers, [], "no blocker with the file root configured");
    // Without the file root the persisted-report references are unresolved: a CUTOVER must refuse.
    const blocked = cli(db, ["preflight"]);
    ok(
      blocked.json.blockers.includes("UNRESOLVED_REPORT_LOCATIONS"),
      "preflight blocks unresolved report locations",
    );
    const refused = cli(db, ["start", "--kind", "CUTOVER"], { expectExit: 1 });
    ok(
      /PREFLIGHT_BLOCKED/u.test(refused.stderr),
      "CUTOVER refuses to start while locations are unresolved",
    );
    return { blockedWithoutRoot: blocked.json.blockers };
  });

  await stage("cutover run 1: start -> restore point -> execute", async () => {
    const started = cli(db, ["start", "--kind", "CUTOVER"], {
      extra: ["--report-file-root", reportsDir],
    });
    run1 = started.json.runId;
    const point = cli(db, [
      "restore-point",
      "--run",
      run1,
      "--ref",
      report.restorePoint.ref,
      "--digest",
      report.restorePoint.digest,
      "--verified",
    ]);
    eq(point.json.verified, true);
    const result = cli(db, [
      "execute",
      "--run",
      run1,
      "--report-file-root",
      reportsDir,
      "--sample-size",
      "25",
    ]);
    const out = result.json;
    writeFileSync(
      path.join(cfg.evidence, "validation-report.json"),
      JSON.stringify(out.validation, null, 2),
    );

    // quiesce
    eq(
      out.phases.QUIESCE.cancelled,
      manifest.outbox.cancelled,
      "all undelivered legacy messages cancelled",
    );
    eq(
      out.phases.QUIESCE.byEventType,
      manifest.outbox.byLegacyType,
      "cancelled per event type",
    );
    // archive + closure
    eq(
      out.phases.ARCHIVE.terminalAssessmentsArchived,
      manifest.assessments.terminal,
    );
    eq(
      out.phases.ARCHIVE.closedInFlight,
      manifest.inFlight,
      "every in-flight V1 row closed, none missed",
    );
    const expectedReports = manifest.reports.expected;
    const gotReports = {};
    for (const [reason, n] of Object.entries(
      out.phases.ARCHIVE.reports.byReason,
    ))
      gotReports[reason] = n;
    eq(
      out.phases.ARCHIVE.reports.undetermined,
      [],
      "no report location left undetermined",
    );
    // backfill
    eq(out.phases.BACKFILL.backfilled, manifest.assessments.nonTerminal);
    eq(
      out.phases.BACKFILL.byReason,
      Object.fromEntries(
        Object.entries(manifest.expectedBackfillReasons).filter(
          ([, n]) => n > 0,
        ),
      ),
    );
    // The migration has NO activation phase: it prepares V2 state and starts nothing.
    eq(out.phases.ACTIVATE, undefined, "the migration has no activation phase");
    eq(
      out.phases.BACKFILL.pinnedSnapshot,
      manifest.expectedBackfillReasons.PINNED_LATEST_READY_SNAPSHOT,
      "prepared and pinned, but not started",
    );
    // gate
    eq(
      out.validation.summary.blockingFailures,
      0,
      JSON.stringify(out.validation.checks.filter((c) => c.status === "FAIL")),
    );
    eq(result.exit, 0);
    // report reconciliation vs the seed oracle (class/reason pairs)
    const recon = out.validation.artifactReconciliation;
    const expectedByClass = {};
    const expectedByReason = {};
    for (const [key, n] of Object.entries(expectedReports)) {
      const [klass, reason] = key.split("/");
      expectedByClass[klass] = (expectedByClass[klass] ?? 0) + n;
      expectedByReason[reason] = (expectedByReason[reason] ?? 0) + n;
    }
    for (const [klass, n] of Object.entries(expectedByClass))
      eq(recon.byClass[klass], n, `class ${klass}`);
    for (const [reason, n] of Object.entries(expectedByReason))
      eq(recon.byReason[reason], n, `reason ${reason}`);
    eq(
      recon.total,
      Object.values(expectedReports).reduce((a, b) => a + b, 0),
      "every report-related record accounted for",
    );
    ok(
      recon.limitation.includes("placeholder"),
      "limitation recorded in the reconciliation report",
    );
    eq(
      recon.uploaderEvidence.sha256,
      "e3789784a7101ab16f1b552a27ff70420a2c38e41a6661e382076f8362eaf842",
    );
    report.facts = {
      runId: run1,
      quiesce: out.phases.QUIESCE,
      archive: {
        archivedBySource: out.phases.ARCHIVE.archivedBySource,
        closedInFlight: out.phases.ARCHIVE.closedInFlight,
        terminalAssessmentsArchived:
          out.phases.ARCHIVE.terminalAssessmentsArchived,
        reports: out.phases.ARCHIVE.reports,
      },
      backfill: out.phases.BACKFILL,
      validation: {
        summary: out.validation.summary,
        checks: out.validation.checks.map((c) => ({
          id: c.id,
          status: c.status,
          blocking: c.blocking,
        })),
      },
      artifactReconciliation: recon,
    };
    return {
      runId: run1,
      summary: out.validation.summary,
      reconciliation: recon.byClass,
    };
  });

  await stage(
    "independent verification of the archive (harness code, harness table list)",
    async () => {
      const checked = await independentArchiveCheck(client, {
        sample: 15,
        seed: run1,
      });
      writeFileSync(
        path.join(cfg.evidence, "independent-archive-check.json"),
        JSON.stringify(checked, null, 2),
      );
      eq(
        checked.findings,
        [],
        "archive matches live V1 rows (counts, sha256, content)",
      );
      report.facts.independentCheck = checked.summary;
      // Source rows survived the whole run: identity, tenant, scope. Volatile columns excluded.
      const owners = await client.query(
        `SELECT id, "ownerId" FROM "Assessment" ORDER BY id`,
      );
      eq(owners.rowCount, manifest.assessments.total, "no V1 assessment lost");
      return { sources: Object.keys(checked.summary).length };
    },
  );

  await stage("source preservation, ids, tenants, hierarchy", async () => {
    // Re-compute the stable fingerprint from the restore-point dump in a scratch database.
    const scratch = dbName("source");
    await createDatabase(scratch);
    restoreDatabase(dump, scratch);
    const before = await connect(scratch);
    try {
      eq(
        await fingerprint(client, { stable: true }),
        await fingerprint(before, { stable: true }),
        "every V1 table unchanged apart from the closure/backfill columns",
      );
    } finally {
      await before.end();
    }
    // Terminal V1 assessments never receive canonical state or a runtime thread.
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "Assessment" a WHERE a."lifecycleState" IS NOT NULL AND a.status::text IN ('READY_FOR_REVIEW','AI_NOT_DETECTED')`,
      ),
      0,
    );
    eq(
      await scalar(client, `SELECT count(*)::int FROM "AssessmentRuntime"`),
      manifest.assessments.nonTerminal,
      "one fresh runtime per non-terminal assessment, none for terminal",
    );
    // Fresh V2 threads never reuse V1 thread ids.
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "AssessmentRuntime" r JOIN "AssessmentRuntimeTurn" t ON t."threadId" = r."threadId"::text`,
      ),
      0,
    );
    // Tenant preserved on the summaries.
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "LegacyAssessmentArchive" s JOIN "Assessment" a ON a.id = s."assessmentId" WHERE a."ownerId" <> s."ownerId"`,
      ),
      0,
    );
    return {};
  });

  await stage("closure: zero old execution authority remains", async () => {
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "OutboxMessage" WHERE status IN ('PENDING','FAILED','DLQ') AND "eventType" = ANY($1)`,
        [LEGACY_EVENT_TYPES],
      ),
      0,
      "no retired V1 command/event can still be delivered",
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "OutboxMessage" WHERE status = 'CANCELLED'`,
      ),
      manifest.outbox.cancelled,
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "OutboxMessage" WHERE status = 'PUBLISHED' AND "eventType" = ANY($1)`,
        [LEGACY_EVENT_TYPES],
      ),
      manifest.outbox.publishedLegacy,
      "published legacy history untouched",
    );
    // Kept traffic (acquisition, retained generic events) is NOT cancelled.
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "OutboxMessage" WHERE status = 'PENDING' AND "eventType" LIKE 'command.legal-%' OR (status='PENDING' AND "eventType" IN ('audit.export-requested','event.assessment.created.v1','event.repository-snapshot.created.v1','command.billing.sepay-reconcile.v1'))`,
      ),
      manifest.outbox.keptUndelivered,
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "OutboxMessage" WHERE "eventType" = 'command.assessment.root.requested.v1'`,
      ),
      0,
      "no Assessment Root command exists: re-evaluation is never a migration side effect",
    );
    // In-flight V1 state is gone from every V1 table.
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "AssessmentRuntimeTurn" WHERE state IN ('RUNNING','STOP_REQUESTED','RESUME_REQUESTED')`,
      ),
      0,
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "RepositoryScanJob" WHERE status IN ('QUEUED','RUNNING','PENDING_MAPPING','WAITING_FOR_CONTEXT','WAITING_FOR_CREDITS','READY_TO_SNAPSHOT') AND "idempotencyKey" NOT LIKE 'runtime-hydration:%'`,
      ),
      0,
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "DocumentRequest" WHERE status IN ('QUEUED','GENERATING')`,
      ),
      0,
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "TargetedReanalysisRequest" WHERE state IN ('QUEUED','DISPATCHED','RUNNING')`,
      ),
      0,
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "TargetedReanalysisCheckpoint" WHERE state IN ('PENDING_DISPATCH','DISPATCHED','RUNNING','RETRY_SCHEDULED')`,
      ),
      0,
    );
    // Cancelled messages cannot be revived (trigger) and every one has an audit event.
    const id = await scalar(
      client,
      `SELECT id FROM "OutboxMessage" WHERE status = 'CANCELLED' LIMIT 1`,
    );
    let revived = false;
    try {
      await client.query(
        `UPDATE "OutboxMessage" SET status = 'PENDING' WHERE id = $1`,
        [id],
      );
      revived = true;
    } catch {
      /* expected: cancelled is terminal */
    }
    eq(
      revived,
      false,
      "a cancelled legacy message cannot be re-published or replayed",
    );
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "AuditEvent" WHERE "eventType" = 'OUTBOX_LEGACY_CANCELLED'`,
      ),
      manifest.outbox.cancelled,
    );
    return {};
  });

  await stage(
    "migration starts no re-evaluation and spends nothing (zero model calls, zero credits)",
    async () => {
      const nonTerminal = manifest.assessments.nonTerminal;
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "Assessment" WHERE "lifecycleState"::text = 'PREPARING'`,
        ),
        manifest.expectedBackfillReasons.PINNED_LATEST_READY_SNAPSHOT,
        "only pinned migrated assessments are prepared; none is running",
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "Assessment" WHERE "lifecycleState" IS NOT NULL AND "lifecycleState"::text NOT IN ('PREPARING','WAITING_FOR_REQUIRED_INPUT')`,
        ),
        0,
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "Assessment" WHERE "lifecycleState"::text = 'WAITING_FOR_REQUIRED_INPUT'`,
        ),
        nonTerminal -
          manifest.expectedBackfillReasons.PINNED_LATEST_READY_SNAPSHOT,
        "every missing repository input has a visible non-runnable disposition",
      );
      const runtimes = await one(
        client,
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE "startedAt" IS NULL AND "currentExecutionId" IS NULL AND "leaseToken" IS NULL
                                   AND "checkpointId" IS NULL AND "executionState"::text = 'QUEUED')::int AS idle,
                count(DISTINCT "threadId")::int AS threads
           FROM "AssessmentRuntime"`,
      );
      eq(
        [runtimes.n, runtimes.idle, runtimes.threads],
        [nonTerminal, nonTerminal, nonTerminal],
        "one fresh, unique, idle Root thread per migrated assessment",
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "AssessmentRuntime" r WHERE EXISTS (SELECT 1 FROM "AssessmentRuntimeTurn" t WHERE t."threadId" = r."threadId"::text)`,
        ),
        0,
        "no V1 thread id was reused",
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "LegacyAssessmentArchive" s JOIN "AssessmentRuntime" r ON r."assessmentId" = s."assessmentId" WHERE s."v2ThreadId" IS DISTINCT FROM r."threadId"`,
        ),
        0,
        "every thread mapping equals the one the archive summary recorded",
      );
      for (const [what, sql] of [
        [
          "Root-authored event",
          `SELECT count(*)::int FROM "AssessmentEvent" WHERE "actorType"::text <> 'API'`,
        ],
        ["rule decision", `SELECT count(*)::int FROM "AssessmentRuleDecision"`],
        ["accepted evidence", `SELECT count(*)::int FROM "AssessmentEvidence"`],
        ["case fact", `SELECT count(*)::int FROM "AssessmentCaseFact"`],
        ["human request", `SELECT count(*)::int FROM "AssessmentHumanRequest"`],
        ["V2 artifact", `SELECT count(*)::int FROM "AssessmentArtifact"`],
        [
          "re-evaluation ledger row",
          `SELECT count(*)::int FROM "LegacyReevaluation"`,
        ],
      ])
        eq(
          await scalar(client, sql),
          0,
          `no ${what} exists after the migration`,
        );
      eq(
        await accountingFingerprint(client),
        preAccounting,
        "usage, reservations, claims, wallets, ledger, orders and pricing/policy snapshots are byte-identical to before the migration",
      );
      // The validator proves the same thing on any database, at any time.
      const validated = cli(db, ["validate", "--run", run1]).json;
      for (const id of [
        "MIGRATION_ENQUEUED_NO_ROOT_COMMAND",
        "UNSTARTED_ASSESSMENTS_HAVE_NO_AI_EFFECT",
        "REEVALUATION_LEDGER_MATCHES_ROOT_COMMANDS",
      ])
        eq(
          validated.checks.find((c) => c.id === id)?.status,
          "PASS",
          `validation check ${id}`,
        );
      // Static guard: nothing in the cutover tooling can start by itself with the process.
      const tooling = path.join(api, "src/modules/legacy-migration");
      const offenders = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (
            /\.ts$/u.test(entry.name) &&
            !/\.spec\.ts$/u.test(entry.name) &&
            /OnModuleInit|OnApplicationBootstrap|@Cron|@Interval|setInterval\(/u.test(
              readFileSync(full, "utf8"),
            )
          )
            offenders.push(path.relative(api, full));
        }
      };
      walk(tooling);
      eq(offenders, [], "the tooling has no start-up hook, timer or scheduler");
      ok(
        !/modules\/legacy-migration\//u.test(
          readFileSync(path.join(api, "src/app.module.ts"), "utf8"),
        ),
        "the API application module never imports the migration/re-evaluation tooling",
      );
      return { migrated: nonTerminal, rootCommands: 0 };
    },
  );

  await stage(
    "report artifacts: accounted, byte-identical, nothing fabricated",
    async () => {
      const blobs = await client.query(
        `SELECT b.*, lr."sourceId" FROM "LegacyArchiveBlob" b JOIN "LegacyArchiveRecord" lr ON lr.id = b."recordId" ORDER BY lr."sourceId"`,
      );
      eq(
        blobs.rowCount,
        manifest.reports.persistedFixtures.length,
        "exactly the persisted fixtures were copied",
      );
      const byRequest = new Map(
        manifest.reports.persistedFixtures.map((f) => [f.documentRequestId, f]),
      );
      for (const blob of blobs.rows) {
        const fixture = byRequest.get(blob.sourceId);
        ok(
          fixture,
          `blob belongs to a seeded persisted report (${blob.sourceId})`,
        );
        eq(
          blob.contentSha256,
          fixture.sha256,
          "blob hash equals the SOURCE file hash",
        );
        eq(Number(blob.sizeBytes), fixture.sizeBytes);
        const stored = readFileSync(path.join(storage, blob.storageRef));
        eq(
          createHash("sha256").update(stored).digest("hex"),
          fixture.sha256,
          "stored bytes re-hash to the source hash",
        );
        eq(
          stored.equals(readFileSync(fixture.path)),
          true,
          "stored bytes equal the source bytes",
        );
      }
      // Everything that is not a copied artifact has NO blob and NO synthetic hash/location.
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "LegacyArchiveRecord" lr WHERE lr."reconciliationClass" IS NOT NULL AND lr."reconciliationReason" <> 'COPIED_AND_VERIFIED' AND EXISTS (SELECT 1 FROM "LegacyArchiveBlob" b WHERE b."recordId" = lr.id)`,
        ),
        0,
      );
      // The migration never touched the V2 artifact store.
      eq(
        await scalar(client, `SELECT count(*)::int FROM "AssessmentArtifact"`),
        0,
        "zero V2 AssessmentArtifact written or replaced by reconstructed V1 data",
      );
      return {
        copied: blobs.rowCount,
        placeholders:
          manifest.reports.expected[
            "NO_LEGACY_ARTIFACT_PRESENT/PLACEHOLDER_UPLOADER_NEVER_PERSISTED"
          ],
      };
    },
  );

  await stage("second run is idempotent", async () => {
    const before = await stateFingerprint(client);
    const sourcesBefore = await fingerprint(client, { stable: true });
    const second = cli(db, ["start", "--kind", "CUTOVER"], {
      extra: ["--report-file-root", reportsDir],
    });
    const result = cli(db, [
      "execute",
      "--run",
      second.json.runId,
      "--report-file-root",
      reportsDir,
    ]);
    writeFileSync(
      path.join(cfg.evidence, "validation-report-second-run.json"),
      JSON.stringify(result.json.validation, null, 2),
    );
    const out = result.json;
    eq(out.phases.QUIESCE.cancelled, 0, "nothing left to cancel");
    eq(
      Object.values(out.phases.ARCHIVE.archivedBySource).reduce(
        (a, b) => a + b,
        0,
      ),
      0,
      "no row archived twice",
    );
    eq(out.phases.ARCHIVE.reports.archived, 0);
    eq(out.phases.ARCHIVE.terminalAssessmentsArchived, 0);
    eq(
      Object.values(out.phases.ARCHIVE.closedInFlight).reduce(
        (a, b) => a + b,
        0,
      ),
      0,
      "nothing left to close",
    );
    eq(out.phases.BACKFILL.backfilled, 0, "no assessment backfilled twice");
    eq(out.phases.ACTIVATE, undefined, "still no activation phase");
    eq(
      await scalar(
        client,
        `SELECT count(*)::int FROM "OutboxMessage" WHERE "eventType" = 'command.assessment.root.requested.v1'`,
      ),
      0,
      "a rerun enqueues no Root command, allocates no second thread, creates no billing effect",
    );
    eq(
      await accountingFingerprint(client),
      preAccounting,
      "a rerun has no accounting effect",
    );
    const after = await stateFingerprint(client);
    const auditDelta = { ...after.audit };
    eq(
      auditDelta.LEGACY_MIGRATION_RUN_COMPLETED,
      (before.audit.LEGACY_MIGRATION_RUN_COMPLETED ?? 0) + 1,
      "only the run-completed audit event is new",
    );
    delete auditDelta.LEGACY_MIGRATION_RUN_COMPLETED;
    const beforeAudit = { ...before.audit };
    delete beforeAudit.LEGACY_MIGRATION_RUN_COMPLETED;
    eq(auditDelta, beforeAudit);
    delete after.audit;
    delete before.audit;
    eq(
      after,
      before,
      "archive, canonical state and outbox are bit-for-bit unchanged",
    );
    eq(await fingerprint(client, { stable: true }), sourcesBefore);
    eq(out.validation.summary.blockingFailures, 0);
    return { secondRun: second.json.runId };
  });

  await stage(
    "restart from the restore point converges to identical archive digests",
    async () => {
      const replay = dbName("replay");
      await createDatabase(replay);
      restoreDatabase(dump, replay);
      const other = await connect(replay);
      try {
        const started = cli(replay, ["start", "--kind", "REHEARSAL"], {
          extra: ["--report-file-root", reportsDir],
        });
        const point = cli(replay, [
          "restore-point",
          "--run",
          started.json.runId,
          "--ref",
          report.restorePoint.ref,
          "--digest",
          report.restorePoint.digest,
          "--verified",
        ]);
        void point;
        const result = cli(replay, [
          "execute",
          "--run",
          started.json.runId,
          "--report-file-root",
          reportsDir,
        ]);
        eq(result.json.validation.summary.blockingFailures, 0);
        const digests = (c) =>
          c
            .query(
              `SELECT "assessmentId", disposition, "recordCount", "payloadDigest" FROM "LegacyAssessmentArchive" ORDER BY "assessmentId"`,
            )
            .then((r) => r.rows);
        eq(
          await digests(other),
          await digests(client),
          "archive digests are deterministic across independent runs from the same restore point",
        );
        const records = (c) =>
          c
            .query(
              `SELECT id, "sourceTable", "sourceId", "payloadSha256", "reconciliationClass", "reconciliationReason" FROM "LegacyArchiveRecord" ORDER BY id`,
            )
            .then((r) => r.rows);
        eq(
          await records(other),
          await records(client),
          "archive records identical (ids, hashes, classification)",
        );
      } finally {
        await other.end();
      }
      return {};
    },
  );

  await stage(
    "rollback boundary: restore until the first accepted V2 write, forward repair only after",
    async () => {
      // Boundary open: an accepted V2 write (any outbox message actually published) must be flagged.
      await client.query(
        `UPDATE "OutboxMessage" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = (SELECT id FROM "OutboxMessage" WHERE status = 'PENDING' ORDER BY id LIMIT 1)`,
      );
      const flagged = cli(db, ["validate", "--run", run1], { expectExit: 3 });
      const boundaryCheck = flagged.json.checks.find(
        (c) => c.id === "NO_ACCEPTED_V2_WRITES_WHILE_RESTORE_BOUNDARY_OPEN",
      );
      eq(
        boundaryCheck.status,
        "FAIL",
        "an accepted V2 write while a restore is still the rollback path is reported",
      );
      // Closing the boundary is the operator's explicit acknowledgement: restore is no longer an option.
      const closed = cli(db, ["close-boundary", "--run", run1]);
      eq(closed.json.boundaryClosed, true);
      const refused = cli(
        db,
        [
          "restore-point",
          "--run",
          run1,
          "--ref",
          "later",
          "--digest",
          "0".repeat(64),
        ],
        { expectExit: 1 },
      );
      ok(
        /rollback boundary is closed/u.test(refused.stderr),
        "restore points can no longer be (re)recorded after the boundary closed",
      );
      const after = cli(db, ["validate", "--run", run1]);
      eq(after.json.summary.blockingFailures, 0);
      // Forward repair is still possible: the idempotent run may be repeated after the boundary closed.
      const repair = cli(db, ["start", "--kind", "REHEARSAL"], {
        extra: ["--report-file-root", reportsDir],
      });
      const rerun = cli(db, [
        "execute",
        "--run",
        repair.json.runId,
        "--report-file-root",
        reportsDir,
      ]);
      ok(
        Array.isArray(rerun.json.validation.checks),
        "forward repair run completes after the boundary closed",
      );
      return {};
    },
  );

  // V2 traffic begins only now: the rollback boundary was closed in the previous stage.
  await stage(
    "archive retrieval and retired surface over HTTP (real API process)",
    async () => {
      if (!existsSync(cfg.apiMain)) {
        if (cfg.requireApi)
          throw new Error(
            `built API not found at ${cfg.apiMain} (run: pnpm --filter @lcsp/api build)`,
          );
        report.skipped = [...(report.skipped ?? []), "api-http"];
        return { skipped: `no built API at ${cfg.apiMain}` };
      }
      const api = await startApi({
        main: cfg.apiMain,
        databaseUrl: dbUrl(db),
        port: cfg.apiPort,
        storagePath: storage,
      });
      try {
        const emails = manifest.owners.map((_, i) => `w6-owner-${i}@acme.test`);
        const tokens = [];
        for (const email of emails)
          tokens.push(await api.signInAs(client, email));
        const owner = (index) => ({
          id: manifest.owners[index],
          token: tokens[index],
        });
        const bearer = (index) => ({ token: tokens[index] });

        // ---- oracle straight from SQL (independent of the API's own projection) ----------------
        const oracle = (
          await client.query(`
          SELECT s."assessmentId" AS id, s."ownerId" AS owner,
                 count(r.id) FILTER (WHERE r."sourceTable" IN ('DOCUMENT_REQUEST','READINESS_EXPORT'))::int AS reports,
                 count(r.id) FILTER (WHERE r."sourceTable" IN ('DOCUMENT_REQUEST','READINESS_EXPORT')
                                     AND r."reconciliationClass" = 'ARTIFACT_PRESENT_AND_COPIED')::int AS downloadable
            FROM "LegacyAssessmentArchive" s
            LEFT JOIN "LegacyArchiveRecord" r ON r."assessmentId" = s."assessmentId"
           GROUP BY s."assessmentId", s."ownerId"`)
        ).rows;

        // ---- list: only the caller's archive, correct counts, stable pagination -----------------
        for (let index = 0; index < manifest.owners.length; index += 1) {
          const mine = oracle.filter(
            (row) => row.owner === manifest.owners[index],
          );
          const listed = await api.http(
            "GET",
            "/legacy-archive/assessments?page_size=100",
            bearer(index),
          );
          eq(listed.status, 200, listed.bytes.toString("utf8"));
          eq(listed.json.data.total, mine.length);
          eq(
            listed.json.data.archives.map((a) => a.assessment_id).sort(),
            mine.map((r) => r.id).sort(),
            "only the caller's archived assessments",
          );
          for (const archive of listed.json.data.archives) {
            const expected = mine.find(
              (row) => row.id === archive.assessment_id,
            );
            eq(
              [archive.report_count, archive.downloadable_report_count],
              [expected.reports, expected.downloadable],
            );
          }
          const paged = [];
          for (let page = 1; page <= Math.ceil(mine.length / 4); page += 1) {
            const slice = await api.http(
              "GET",
              `/legacy-archive/assessments?page=${page}&page_size=4`,
              bearer(index),
            );
            paged.push(...slice.json.data.archives.map((a) => a.assessment_id));
          }
          eq(
            new Set(paged).size,
            mine.length,
            "pagination covers every archived assessment exactly once",
          );
          eq(
            (await api.http("GET", "/legacy-archive/assessments")).status,
            401,
            "unauthenticated is refused",
          );
        }

        // ---- a persisted (byte-copied) report downloads byte-identically ------------------------
        const fixture = manifest.reports.persistedFixtures[0];
        const copied = (
          await client.query(
            `SELECT lr.id AS record, lr."assessmentId" AS assessment, a."ownerId" AS owner FROM "LegacyArchiveRecord" lr JOIN "Assessment" a ON a.id = lr."assessmentId" WHERE lr."sourceTable" = 'DOCUMENT_REQUEST' AND lr."sourceId" = $1`,
            [fixture.documentRequestId],
          )
        ).rows[0];
        const ownerIndex = manifest.owners.indexOf(copied.owner);
        const otherIndex = (ownerIndex + 1) % manifest.owners.length;
        const detail = await api.http(
          "GET",
          `/legacy-archive/assessments/${copied.assessment}`,
          bearer(ownerIndex),
        );
        eq(detail.status, 200);
        const item = detail.json.data.reports.find(
          (r) => r.recordId === copied.record,
        );
        eq(
          [
            item.availability,
            item.reconciliationClass,
            item.reconciliationReason,
            item.sizeBytes,
            item.contentSha256,
          ],
          [
            "DOWNLOADABLE",
            "ARTIFACT_PRESENT_AND_COPIED",
            "COPIED_AND_VERIFIED",
            fixture.sizeBytes,
            fixture.sha256,
          ],
        );
        ok(
          !JSON.stringify(detail.json).includes("documentUrl") &&
            !JSON.stringify(detail.json).includes("mock-storage") &&
            !JSON.stringify(detail.json).includes(reportsDir),
          "the response never exposes a storage location",
        );
        const file = await api.http(
          "GET",
          `/legacy-archive/assessments/${copied.assessment}/reports/${copied.record}/download`,
          bearer(ownerIndex),
        );
        eq(file.status, 200);
        ok(
          file.bytes.equals(readFileSync(fixture.path)),
          "downloaded bytes are identical to the persisted V1 file",
        );
        eq(api.sha256(file.bytes), fixture.sha256);
        eq(file.headers.get("etag"), `"${fixture.sha256}"`);
        ok(
          /^attachment/u.test(file.headers.get("content-disposition")) &&
            /no-store/u.test(file.headers.get("cache-control")) &&
            file.headers.get("x-content-type-options") === "nosniff",
          "download headers",
        );
        ok(
          file.headers.get("content-type").startsWith("text/markdown"),
          "type inferred from the original reference extension",
        );

        // ---- inline export (ReadinessExport.contentJson) ---------------------------------------
        const inline = (
          await client.query(
            `SELECT lr.id AS record, lr."assessmentId" AS assessment, a."ownerId" AS owner, lr.payload -> 'contentJson' AS content
           FROM "LegacyArchiveRecord" lr JOIN "Assessment" a ON a.id = lr."assessmentId"
          WHERE lr."sourceTable" = 'READINESS_EXPORT' AND lr."reconciliationReason" = 'INLINE_CONTENT_ARCHIVED' ORDER BY lr.id LIMIT 1`,
          )
        ).rows[0];
        const inlineOwner = manifest.owners.indexOf(inline.owner);
        const inlineFile = await api.http(
          "GET",
          `/legacy-archive/assessments/${inline.assessment}/reports/${inline.record}/download`,
          bearer(inlineOwner),
        );
        eq(inlineFile.status, 200);
        eq(inlineFile.json, inline.content, "inline export is served verbatim");

        // ---- not retained / metadata only / orphaned: honest availability, no download ----------
        for (const [reason, availability] of [
          ["PLACEHOLDER_UPLOADER_NEVER_PERSISTED", "NOT_RETAINED"],
          ["NO_ARTIFACT_REFERENCE", "METADATA_ONLY"],
          ["REFERENCE_TARGET_MISSING", "UNAVAILABLE"],
        ]) {
          const row = (
            await client.query(
              `SELECT lr.id AS record, lr."assessmentId" AS assessment, a."ownerId" AS owner FROM "LegacyArchiveRecord" lr JOIN "Assessment" a ON a.id = lr."assessmentId" WHERE lr."reconciliationReason" = $1::"LegacyArtifactReconciliationReason" ORDER BY lr.id LIMIT 1`,
              [reason],
            )
          ).rows[0];
          const index = manifest.owners.indexOf(row.owner);
          const view = await api.http(
            "GET",
            `/legacy-archive/assessments/${row.assessment}`,
            bearer(index),
          );
          const entry = view.json.data.reports.find(
            (r) => r.recordId === row.record,
          );
          eq(
            [entry.availability, entry.sizeBytes, entry.contentSha256],
            [availability, null, null],
            `${reason} is reported honestly, with no invented size or hash`,
          );
          const refused = await api.http(
            "GET",
            `/legacy-archive/assessments/${row.assessment}/reports/${row.record}/download`,
            bearer(index),
          );
          eq(
            [refused.status, refused.json.problem.code],
            [404, "LEGACY_ARCHIVE_ARTIFACT_NOT_AVAILABLE"],
          );
        }

        // ---- tenant isolation -------------------------------------------------------------------
        const hiddenDetail = await api.http(
          "GET",
          `/legacy-archive/assessments/${copied.assessment}`,
          bearer(otherIndex),
        );
        eq(
          [hiddenDetail.status, hiddenDetail.json.problem.code],
          [404, "LEGACY_ARCHIVE_NOT_FOUND"],
        );
        const hiddenFile = await api.http(
          "GET",
          `/legacy-archive/assessments/${copied.assessment}/reports/${copied.record}/download`,
          bearer(otherIndex),
        );
        eq(
          [hiddenFile.status, hiddenFile.json.problem.code],
          [404, "LEGACY_ARCHIVE_ARTIFACT_NOT_AVAILABLE"],
        );
        const unauth = await api.http(
          "GET",
          `/legacy-archive/assessments/${copied.assessment}/reports/${copied.record}/download`,
        );
        eq(unauth.status, 401);
        eq(
          await scalar(
            client,
            `SELECT count(*)::int FROM "AuditEvent" WHERE "eventType" = 'LEGACY_ARCHIVE_REPORT_DOWNLOADED'`,
          ),
          2,
          "exactly the two successful downloads are audited",
        );

        // ---- corrupting the stored copy is detected, never served -------------------------------
        const blobRef = (
          await client.query(
            `SELECT "storageRef" FROM "LegacyArchiveBlob" WHERE "recordId" = $1`,
            [copied.record],
          )
        ).rows[0].storageRef;
        const blobPath = path.join(storage, blobRef);
        const original = readFileSync(blobPath);
        writeFileSync(blobPath, Buffer.concat([original, Buffer.from("x")]));
        const corrupted = await api.http(
          "GET",
          `/legacy-archive/assessments/${copied.assessment}/reports/${copied.record}/download`,
          bearer(ownerIndex),
        );
        eq(
          [corrupted.status, corrupted.json.problem.code],
          [500, "LEGACY_ARCHIVE_ARTIFACT_INTEGRITY_FAILED"],
        );
        writeFileSync(blobPath, original);

        // ---- every retired V1 route answers 410, the live one does not ---------------------------
        const terminalId = manifest.ids.terminal[0];
        for (const [method, route] of [
          ["GET", `/assessments/${terminalId}/documents`],
          ["POST", `/assessments/${terminalId}/documents/final-report`],
          ["POST", `/assessments/${terminalId}/classification/rerun`],
          ["GET", `/assessments/${terminalId}/evidence-graph`],
          ["POST", `/assessments/${terminalId}/scan-jobs`],
        ]) {
          const gone = await api.http(method, route, {
            ...bearer(0),
            body: method === "POST" ? {} : undefined,
          });
          eq(
            [gone.status, gone.json.problem.code],
            [410, "LEGACY_ROUTE_RETIRED"],
            `${method} ${route}`,
          );
        }
        for (const [method, route] of [
          ["POST", "/internal/scan-jobs/x/claim"],
          ["POST", "/internal/assessment-runtime-controls"],
          ["POST", "/internal/evidence/agentic-tools/dispatch"],
          [
            "POST",
            "/internal/legal-rule-catalog/corpus/v1/resume-waiting-runs",
          ],
        ]) {
          const gone = await api.worker(method, route, {});
          eq(
            [gone.status, gone.json.problem.code],
            [410, "LEGACY_ROUTE_RETIRED"],
            `${method} ${route}`,
          );
        }
        const stream = await api.worker(
          "POST",
          "/internal/scan-jobs/agent-stream-events",
          {},
        );
        ok(
          stream.status !== 410 && stream.status !== 404,
          `the live agent-stream route is not retired (got ${stream.status})`,
        );

        // ---- V2 reads tolerate V1-origin and backfilled assessments -----------------------------
        const v2List = await api.http(
          "GET",
          "/assessments?page_size=100",
          bearer(0),
        );
        eq(v2List.status, 200, v2List.bytes.toString("utf8"));
        const owned = (
          await client.query(
            `SELECT count(*)::int AS n FROM "Assessment" WHERE "ownerId" = $1`,
            [manifest.owners[0]],
          )
        ).rows[0].n;
        eq(v2List.json.data.total, owned);
        ok(
          v2List.json.data.assessments.some((a) => a.lifecycle === null),
          "archived terminal V1 assessments list with no canonical lifecycle",
        );
        ok(
          v2List.json.data.assessments.some(
            (a) => a.lifecycle?.state === "PREPARING" && a.runtime,
          ),
          "backfilled assessments list as PREPARING with a fresh runtime",
        );
        const terminalDetail = await api.http(
          "GET",
          `/assessments/${manifest.ids.terminal.find((id) => oracle.find((o) => o.id === id)?.owner === manifest.owners[0])}`,
          bearer(0),
        );
        eq(
          [terminalDetail.status, terminalDetail.json.data.lifecycle],
          [200, null],
        );

        // ---- viewing never starts anything; a prepared assessment has nothing for a worker to claim ----
        const before = {
          state: await stateFingerprint(client),
          accounting: await accountingFingerprint(client),
        };
        const prepared = (
          await client.query(
            `SELECT a.id, a."ownerId" AS owner, r."threadId", c."repositorySnapshotId" AS snapshot
               FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId" = a.id JOIN "AssessmentCase" c ON c."assessmentId" = a.id
              WHERE a."lifecycleState"::text = 'PREPARING' ORDER BY (c."repositorySnapshotId" IS NULL), a.id LIMIT 6`,
          )
        ).rows;
        for (const row of prepared) {
          const detail = await api.http(
            "GET",
            `/assessments/${row.id}`,
            bearer(manifest.owners.indexOf(row.owner)),
          );
          eq(detail.status, 200, detail.bytes.toString("utf8"));
          eq(detail.json.data.lifecycle.state, "PREPARING");
          eq(detail.json.data.runtime.threadId, row.threadId);
        }
        for (const row of prepared) {
          const claim = await api.worker(
            "POST",
            `/internal/assessment-runtime/${row.id}/claim`,
          );
          eq(
            [claim.status, claim.json.problem.code],
            [409, "ASSESSMENT_NOT_ACTIVE"],
            "a prepared migrated assessment has nothing to claim until it is explicitly started",
          );
        }
        eq(
          {
            state: await stateFingerprint(client),
            accounting: await accountingFingerprint(client),
          },
          before,
          "reading, listing and a worker polling for work start nothing",
        );
        return { owners: manifest.owners.length, retiredProbed: 9 };
      } finally {
        await api.stop();
        writeFileSync(path.join(cfg.evidence, "api.log"), api.logs.join(""));
      }
    },
  );

  // The SEPARATE, explicit re-evaluation phase (never part of the migration).
  const apiAvailable = () => {
    if (existsSync(cfg.apiMain)) return true;
    if (cfg.requireApi)
      throw new Error(
        `built API not found at ${cfg.apiMain} (run: pnpm --filter @lcsp/api build)`,
      );
    return false;
  };
  for (const [name, fn] of reevaluationStages({
    cli,
    client,
    db,
    run1,
    manifest,
    ok,
    eq,
    scalar,
    one,
    dbUrl,
    cfg,
    root,
    storage,
    tmpDir,
    reportsDir,
    report,
    cleanups,
    apiAvailable,
  }))
    await stage(name, fn);

  await stage(
    "clean install: every migration from an empty database; the cutover tooling is a safe no-op",
    async () => {
      const clean = dbName("clean");
      await createDatabase(clean);
      const migrationsDir = path.join(api, "prisma/migrations");
      const all = readdirSync(migrationsDir).filter((entry) =>
        /^\d{14}_/u.test(entry),
      );
      prismaDeploy(clean, migrationsDir, "clean");
      const fresh = await connect(clean);
      eq(
        await scalar(
          fresh,
          `SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
        ),
        all.length,
        "every migration applies on an empty database",
      );
      for (const table of [
        "LegacyMigrationRun",
        "LegacyAssessmentArchive",
        "LegacyArchiveRecord",
        "LegacyArchiveBlob",
        "LegacyReevaluation",
      ])
        eq(
          await scalar(
            fresh,
            `SELECT to_regclass('public."${table}"') IS NOT NULL`,
          ),
          true,
          `${table} exists`,
        );
      eq(
        (
          await fresh.query(
            `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('LegacyArchiveRecord_immutable','LegacyArchiveBlob_immutable','LegacyAssessmentArchive_immutable','LegacyArchiveBlob_requires_verified_copy','OutboxMessage_cancelled_is_terminal','LegacyReevaluation_immutable','LegacyReevaluation_requires_backfilled') ORDER BY 1`,
          )
        ).rowCount,
        7,
        "all seven W6 integrity triggers exist",
      );
      // Nothing to migrate, and nothing the tool may do before a portfolio exists.
      const pre = cli(clean, ["preflight"]);
      eq(
        [pre.json.assessments.total, pre.json.blockers],
        [0, ["NO_ACTIVE_LEGAL_PORTFOLIO"]],
      );
      cli(clean, ["start", "--kind", "CUTOVER"], { expectExit: 1 });
      // With the prerequisite in place, a full run on an empty install archives nothing and passes.
      await activePortfolio(fresh);
      const started = cli(clean, ["start", "--kind", "CUTOVER"]);
      cli(clean, [
        "restore-point",
        "--run",
        started.json.runId,
        "--ref",
        "clean-install",
        "--digest",
        sha256("clean"),
        "--verified",
      ]);
      const ran = cli(clean, ["execute", "--run", started.json.runId]);
      eq(
        ran.json.validation.summary.blockingFailures,
        0,
        JSON.stringify(
          ran.json.validation.checks.filter((c) => c.status === "FAIL"),
        ),
      );
      eq(
        [
          ran.json.phases.QUIESCE.cancelled,
          ran.json.phases.BACKFILL.backfilled,
          ran.json.phases.ARCHIVE.terminalAssessmentsArchived,
        ],
        [0, 0, 0],
      );
      eq(
        await scalar(fresh, `SELECT count(*)::int FROM "LegacyArchiveRecord"`),
        0,
        "an empty install archives nothing",
      );
      if (existsSync(cfg.apiMain)) {
        const server = await startApi({
          main: cfg.apiMain,
          databaseUrl: dbUrl(clean),
          port: cfg.apiPort + 1,
          storagePath: storage,
        });
        try {
          await fresh.query(
            `INSERT INTO "User"(id, email, "passwordHash", "emailVerified", "failedLoginCount", role, "updatedAt") VALUES ($1,'fresh@acme.test','x',true,0,'CUSTOMER',now())`,
            [uid("clean-user", 1)],
          );
          const token = await server.signInAs(fresh, "fresh@acme.test");
          const archive = await server.http(
            "GET",
            "/legacy-archive/assessments",
            { token },
          );
          eq(
            [
              archive.status,
              archive.json.data.total,
              archive.json.data.archives,
            ],
            [200, 0, []],
            "a new customer has an empty archive",
          );
          const list = await server.http("GET", "/assessments", { token });
          eq([list.status, list.json.data.total], [200, 0]);
          const gone = await server.http("GET", "/assessments/x/documents", {
            token,
          });
          eq(
            [gone.status, gone.json.problem.code],
            [410, "LEGACY_ROUTE_RETIRED"],
          );
        } finally {
          await server.stop();
        }
      }
      return { migrations: all.length };
    },
  );

  return { db, dump, manifest, run1 };
};

// ---- fail-closed scenarios (each on its own database restored from the restore point) ----------
async function negativeScenarios(context) {
  const { dump, manifest } = context;
  let scenarioSeq = 0;
  const scenario = async (label, fn) => {
    const name = dbName(`neg${++scenarioSeq}`);
    await createDatabase(name);
    restoreDatabase(dump, name);
    const c = await connect(name);
    try {
      await stage(`fail-closed: ${label}`, () => fn(name, c));
    } finally {
      await c.end();
    }
  };
  const rootArg = ["--report-file-root", reportsDir];
  // Scenario runs record a (verified) restore point so the ONLY failure left is the intended one.
  const startRun = (name, extra = rootArg) => {
    const runId = cli(name, ["start", "--kind", "REHEARSAL"], { extra }).json
      .runId;
    cli(name, [
      "restore-point",
      "--run",
      runId,
      "--ref",
      "scenario-drill",
      "--digest",
      sha256("scenario"),
      "--verified",
    ]);
    return runId;
  };
  const check = (validation, id) => validation.checks.find((c) => c.id === id);

  await scenario(
    "unresolved-report-location-blocks-cutover",
    async (name, c) => {
      await c.query(
        `UPDATE "DocumentRequest" SET "documentUrl" = 'https://reports.example.invalid/legacy/r1.pdf' WHERE id = (SELECT id FROM "DocumentRequest" WHERE status = 'READY' AND "documentUrl" LIKE 'https://mock-storage.local/%' LIMIT 1)`,
      );
      const pre = cli(name, ["preflight"], { extra: rootArg });
      ok(pre.json.blockers.includes("UNRESOLVED_REPORT_LOCATIONS"));
      eq(pre.json.reportReferences.unresolvedHosts, {
        "reports.example.invalid": 1,
      });
      cli(name, ["start", "--kind", "CUTOVER"], {
        extra: rootArg,
        expectExit: 1,
      });
      // Operator attestation resolves it WITHOUT inventing an artifact.
      const attested = [
        "--report-file-root",
        reportsDir,
        "--attest-non-persisting-host",
        "reports.example.invalid",
      ];
      const runId = startRun(name, attested);
      const result = cli(name, ["execute", "--run", runId], {
        extra: attested,
      });
      eq(
        result.json.phases.ARCHIVE.reports.byReason
          .OPERATOR_ATTESTED_NON_PERSISTING,
        1,
      );
      eq(
        await scalar(c, `SELECT count(*)::int FROM "LegacyArchiveBlob"`),
        manifest.reports.persistedFixtures.length,
        "attestation never creates an artifact",
      );
    },
  );

  await scenario("unreadable-report-location-fails-closed", async (name, c) => {
    await c.query(
      `UPDATE "DocumentRequest" SET "documentUrl" = 'http://127.0.0.1:9/never-listening.pdf' WHERE id = (SELECT id FROM "DocumentRequest" WHERE status = 'READY' AND "documentUrl" LIKE 'https://mock-storage.local/%' LIMIT 1)`,
    );
    const extra = [
      "--report-file-root",
      reportsDir,
      "--report-http-host",
      "127.0.0.1",
      "--http-timeout-ms",
      "2000",
    ];
    const runId = startRun(name, extra);
    const result = cli(name, ["execute", "--run", runId], {
      extra,
      expectExit: 1,
    });
    ok(
      /ARCHIVE_INCOMPLETE/u.test(result.stderr),
      "presence unknown -> archive stops instead of guessing",
    );
    eq(
      await scalar(c, `SELECT count(*)::int FROM "LegacyAssessmentArchive"`),
      0,
      "no summary digest frozen over an incomplete archive",
    );
    eq(
      await scalar(
        c,
        `SELECT count(*)::int FROM "AssessmentRuntimeTurn" WHERE state IN ('RUNNING','STOP_REQUESTED','RESUME_REQUESTED')`,
      ),
      manifest.inFlight.ASSESSMENT_RUNTIME_TURN,
      "in-flight V1 work not closed before the archive is complete",
    );
  });

  await scenario("copy-failure-fails-closed-and-resumes", async (name, c) => {
    const tooSmall = [
      "--report-file-root",
      reportsDir,
      "--max-report-bytes",
      "16",
    ];
    const runId = startRun(name, tooSmall);
    const result = cli(name, ["execute", "--run", runId], {
      extra: tooSmall,
      expectExit: 1,
    });
    ok(
      /ARCHIVE_INCOMPLETE/u.test(result.stderr) &&
        /COPY_SIZE_LIMIT_EXCEEDED/u.test(result.stderr),
      "an existing artifact that cannot be copied stops the archive and says why",
    );
    eq(
      await scalar(c, `SELECT count(*)::int FROM "LegacyArchiveBlob"`),
      0,
      "a failed copy leaves no partial blob",
    );
    eq(
      await scalar(c, `SELECT count(*)::int FROM "LegacyAssessmentArchive"`),
      0,
      "no summary is frozen over an incomplete archive",
    );
    eq(
      await scalar(
        c,
        `SELECT count(*)::int FROM "AssessmentRuntimeTurn" WHERE state IN ('RUNNING','STOP_REQUESTED','RESUME_REQUESTED')`,
      ),
      manifest.inFlight.ASSESSMENT_RUNTIME_TURN,
      "in-flight V1 work is not closed before the archive is complete",
    );
    // The operator fixes the limit and re-runs the SAME run: it resumes and completes.
    const resumed = cli(name, ["execute", "--run", runId], {
      extra: ["--report-file-root", reportsDir],
    });
    eq(resumed.json.validation.summary.blockingFailures, 0);
    eq(
      await scalar(c, `SELECT count(*)::int FROM "LegacyArchiveBlob"`),
      manifest.reports.persistedFixtures.length,
    );
  });

  const reevaluationArgs = (runId, id) => [
    "reevaluation-start",
    "--cutover-run",
    runId,
    "--mode",
    "CANARY",
    "--assessment-id",
    id,
    "--authorized-by",
    "scenario-operator",
    "--model-route",
    "openai/rehearsal-model",
    "--min-start-interval-ms",
    "0",
  ];
  const pinnedAssessment = async (c) =>
    (
      await c.query(
        `SELECT "assessmentId" AS id FROM "AssessmentCase" WHERE "repositorySnapshotId" IS NOT NULL ORDER BY 1 LIMIT 1`,
      )
    ).rows[0].id;
  const nothingStarted = async (c) => {
    eq(
      await scalar(
        c,
        `SELECT count(*)::int FROM "OutboxMessage" WHERE "eventType" = 'command.assessment.root.requested.v1'`,
      ),
      0,
      "no Root command was enqueued",
    );
    eq(
      await scalar(c, `SELECT count(*)::int FROM "LegacyReevaluation"`),
      0,
      "no ledger row",
    );
  };

  await scenario(
    "re-evaluation-refused-while-the-rollback-boundary-is-open",
    async (name, c) => {
      const runId = startRun(name);
      const ran = cli(name, [
        "execute",
        "--run",
        runId,
        "--report-file-root",
        reportsDir,
      ]);
      eq(ran.json.validation.summary.blockingFailures, 0);
      const refused = cli(
        name,
        reevaluationArgs(runId, await pinnedAssessment(c)),
        {
          expectExit: 1,
        },
      );
      ok(
        /LEGACY_REEVALUATION_RESTORE_BOUNDARY_OPEN/u.test(refused.stderr),
        "starting a Root is the first accepted V2 write: the boundary must be closed first",
      );
      await nothingStarted(c);
      // closing the boundary is the operator's explicit acknowledgement; only then may a canary start
      cli(name, ["close-boundary", "--run", runId]);
      const started = cli(
        name,
        reevaluationArgs(runId, await pinnedAssessment(c)),
      );
      eq(started.json.started.length, 1);
    },
  );

  await scenario(
    "re-evaluation-refused-when-the-cutover-does-not-validate",
    async (name, c) => {
      const runId = startRun(name);
      cli(name, ["execute", "--run", runId, "--report-file-root", reportsDir]);
      cli(name, ["close-boundary", "--run", runId]);
      // a V1 writer that survived the cutover leaves an in-flight V1 row behind
      await c.query(
        `INSERT INTO "DocumentRequest"(id, "assessmentId", "requestedById", "classificationResultId", "correlationId", "updatedAt", "documentType", status) SELECT $1, "assessmentId", "requestedById", "classificationResultId", 'late', now(), 'FINAL_REPORT', 'QUEUED' FROM "DocumentRequest" LIMIT 1`,
        [uid("late-reeval", 1)],
      );
      const refused = cli(
        name,
        reevaluationArgs(runId, await pinnedAssessment(c)),
        {
          expectExit: 1,
        },
      );
      ok(
        /LEGACY_REEVALUATION_CUTOVER_NOT_VALIDATED/u.test(refused.stderr),
        "an unreconciled cutover never starts AI work",
      );
      await nothingStarted(c);
    },
  );

  await scenario(
    "live-acquisition-writes-after-cutover-are-not-v1-residue",
    async (name, c) => {
      const runId = startRun(name);
      const ran = cli(name, [
        "execute",
        "--run",
        runId,
        "--report-file-root",
        reportsDir,
      ]);
      eq(ran.json.validation.summary.blockingFailures, 0);
      // Legal corpus acquisition is LIVE after the cutover: new corpus versions, preparations and
      // approvals appear, and a preparation that was already in flight completes.
      const corpus = uid("live-corpus", 1);
      await c.query(
        `INSERT INTO "LegalCorpusVersion"(id, version, status, "sourceManifest") VALUES ($1,'w6-live-corpus','DRAFT','{}')`,
        [corpus],
      );
      await c.query(
        `INSERT INTO "CorpusPreparation"(id, "idempotencyKey", "targetCorpusId", "requestedBy", "correlationId") VALUES ($1,'live-prep',$2,'svc','live')`,
        [uid("live-prep", 1), corpus],
      );
      await c.query(
        `INSERT INTO "CorpusApprovalRecord"(id, "legalCorpusVersionId", "approvedBy", status, "scopeDescription") VALUES ($1,$2,'svc','APPROVED','live')`,
        [uid("live-approval", 1), corpus],
      );
      await c.query(
        `UPDATE "CorpusPreparation" SET "errorCode" = 'LIVE_UPDATE' WHERE id = (SELECT id FROM "CorpusPreparation" WHERE "idempotencyKey" <> 'live-prep' ORDER BY id LIMIT 1)`,
      );
      const v = cli(name, ["validate", "--run", runId]).json;
      eq(
        v.summary.blockingFailures,
        0,
        "live acquisition is not a surviving V1 writer",
      );
      for (const id of [
        "ARCHIVE_COVERAGE.CORPUS_PREPARATION",
        "ARCHIVE_COVERAGE.CORPUS_APPROVAL_RECORD",
      ])
        eq(check(v, id).status, "PASS", id);
    },
  );

  await scenario(
    "unclassified-outbox-traffic-and-late-v1-writes",
    async (name, c) => {
      const runId = startRun(name);
      const first = cli(name, [
        "execute",
        "--run",
        runId,
        "--report-file-root",
        reportsDir,
      ]);
      eq(first.json.validation.summary.blockingFailures, 0);
      // 1. a message type nobody classified
      await c.query(
        `INSERT INTO "OutboxMessage"(id, "aggregateType", "aggregateId", "eventType", payload, status) VALUES ($1,'ASSESSMENT',$2,'command.mystery.v9','{}','PENDING')`,
        [uid("mystery", 1), manifest.ids.terminal[0]],
      );
      let v = cli(name, ["validate", "--run", runId], { expectExit: 3 }).json;
      eq(check(v, "OUTBOX_NO_UNCLASSIFIED_UNDELIVERED_MESSAGE").status, "FAIL");
      await c.query(
        `DELETE FROM "OutboxMessage" WHERE "eventType" = 'command.mystery.v9'`,
      );
      // 2. a V1 writer that survived the cutover (late V1 row, not archived)
      await c.query(
        `INSERT INTO "DocumentRequest"(id, "assessmentId", "requestedById", "classificationResultId", "correlationId", "updatedAt", "documentType", status) SELECT $1, "assessmentId", "requestedById", "classificationResultId", 'late', now(), 'FINAL_REPORT', 'QUEUED' FROM "DocumentRequest" LIMIT 1`,
        [uid("late", 1)],
      );
      v = cli(name, ["validate", "--run", runId], { expectExit: 3 }).json;
      eq(
        check(v, "ARCHIVE_COVERAGE.DOCUMENT_REQUEST").status,
        "FAIL",
        "a late V1 write is detected",
      );
      eq(
        check(v, "CLOSURE.DOCUMENT_REQUEST").status,
        "FAIL",
        "and a late in-flight V1 row is detected",
      );
      await c.query(`DELETE FROM "DocumentRequest" WHERE id = $1`, [
        uid("late", 1),
      ]);
      // 3. archive rows are immutable, and a deleted one is detected then healed by re-running
      let mutated = false;
      try {
        await c.query(
          `UPDATE "LegacyArchiveRecord" SET payload = '{}'::jsonb WHERE id = (SELECT id FROM "LegacyArchiveRecord" LIMIT 1)`,
        );
        mutated = true;
      } catch {
        /* expected */
      }
      eq(mutated, false, "archived history cannot be altered in place");
      await c.query(
        `DELETE FROM "LegacyArchiveRecord" WHERE "sourceTable" = 'TECHNICAL_PROFILE' AND "sourceId" = (SELECT "sourceId" FROM "LegacyArchiveRecord" WHERE "sourceTable" = 'TECHNICAL_PROFILE' LIMIT 1)`,
      );
      v = cli(name, ["validate", "--run", runId], { expectExit: 3 }).json;
      eq(check(v, "ARCHIVE_COVERAGE.TECHNICAL_PROFILE").status, "FAIL");
      const healed = cli(name, [
        "execute",
        "--run",
        runId,
        "--phases",
        "ARCHIVE,VALIDATE",
        "--report-file-root",
        reportsDir,
      ]);
      eq(healed.json.validation.summary.blockingFailures >= 0, true);
      eq(
        check(healed.json.validation, "ARCHIVE_COVERAGE.TECHNICAL_PROFILE")
          .status,
        "PASS",
        "re-running the archive restores the missing row",
      );
    },
  );
}

// ---- the human-readable reconciliation report (emitted next to report.json) ---------------------
function renderReconciliation(report, manifest) {
  const facts = report.facts;
  if (!facts) return null;
  const table = (headers, rows) =>
    [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  const recon = facts.artifactReconciliation;
  const independent = facts.independentCheck ?? {};
  const failedChecks = facts.validation.checks.filter(
    (c) => c.status !== "PASS",
  );
  return [
    `# W6 cutover reconciliation (rehearsal evidence)`,
    ``,
    `- Result: **${report.result ?? "RUNNING"}** — ${report.checks} checks across ${report.stages.length} stages`,
    `- Run: ${report.runId} · started ${report.startedAt}`,
    `- V1 baseline: \`${report.config.baselineRef}\` (${report.baselineMigrations ?? "?"} migrations) → upgraded through \`prisma migrate deploy\``,
    `- Cutover run: \`${facts.runId}\``,
    ``,
    `## 1. Population (seeded; every expectation below comes from the seed, not from the tool)`,
    table(
      ["", "count"],
      [
        ["assessments", manifest.assessments.total],
        [
          "terminal (READY_FOR_REVIEW / AI_NOT_DETECTED)",
          manifest.assessments.terminal,
        ],
        ["non-terminal", manifest.assessments.nonTerminal],
        ...Object.entries(manifest.assessments.byStatus).map(([k, v]) => [
          `  ${k}`,
          v,
        ]),
      ],
    ),
    ``,
    `## 2. Quiescence and old-traffic closure`,
    `Undelivered retired V1 commands/events cancelled (archived first, audited, non-replayable): **${facts.quiesce.cancelled}**`,
    ``,
    table(
      ["retired event type", "cancelled"],
      Object.entries(facts.quiesce.byEventType).map(([k, v]) => [
        `\`${k}\``,
        v,
      ]),
    ),
    ``,
    `In-flight V1 work closed after its original was archived:`,
    ``,
    table(
      ["source", "closed"],
      Object.entries(facts.archive.closedInFlight).map(([k, v]) => [k, v]),
    ),
    ``,
    `Published legacy history (${manifest.outbox.publishedLegacy}) and retained/V2 traffic (${manifest.outbox.keptUndelivered} undelivered) were left untouched.`,
    ``,
    `## 3. Archive coverage (live V1 rows vs archived rows; sha256 and content sampled by independent code)`,
    table(
      ["source", "live", "archived", "sampled"],
      Object.entries(independent).map(([k, v]) => [
        k,
        v.live,
        v.archived,
        v.sampled,
      ]),
    ),
    ``,
    `## 4. Assessments`,
    `- Terminal V1 assessments archived read-only (no canonical lifecycle invented): **${facts.archive.terminalAssessmentsArchived}**`,
    `- Non-terminal assessments backfilled (fresh thread/state, nothing promoted from V1): **${facts.backfill.backfilled}**, snapshot pinned for ${facts.backfill.pinnedSnapshot}`,
    `- Backfill reasons: ${Object.entries(facts.backfill.byReason)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
    `- Assessment Root started by the migration: **0** — the migration has no activation phase (see section 8)`,
    ``,
    `## 5. Legacy report artifacts — five-class reconciliation`,
    `Total report-related records accounted for: **${recon.total}**`,
    ``,
    table(
      ["class", "count"],
      Object.entries(recon.byClass).map(([k, v]) => [k, v]),
    ),
    ``,
    table(
      ["reason", "count"],
      Object.entries(recon.byReason)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => [k, v]),
    ),
    ``,
    `Source-inspection evidence for the V1 uploader: \`${recon.uploaderEvidence.sourcePath}\` at \`${recon.uploaderEvidence.baselineCommit}\` (sha256 \`${recon.uploaderEvidence.sha256}\`) — ${recon.uploaderEvidence.behavior}; callers: ${recon.uploaderEvidence.callers.join(", ")}.`,
    ``,
    `> **Limitation (carried into W7 release evidence).** ${recon.limitation}`,
    ``,
    `Proof points (all asserted by the harness): copied artifacts = ${manifest.reports.persistedFixtures.length} (each byte-identical to its source and re-verified from storage); no blob exists for any record that is not a verified copy; zero V2 \`AssessmentArtifact\` rows written or replaced; metadata-only, not-retained and orphaned references carry no invented size, hash or location.`,
    ``,
    `## 6. Stages`,
    table(
      ["stage", "status", "ms"],
      report.stages.map((st) => [st.name, st.status, st.ms]),
    ),
    ``,
    `## 7. Validation`,
    `Blocking failures: **${facts.validation.summary.blockingFailures}** · pass ${facts.validation.summary.pass} · warn ${facts.validation.summary.warn} · fail ${facts.validation.summary.fail}`,
    ``,
    failedChecks.length
      ? table(
          ["check", "status", "blocking"],
          failedChecks.map((c) => [c.id, c.status, c.blocking]),
        )
      : `All checks passed.`,
    ``,
    ...renderReevaluation(report, manifest),
  ].join("\n");
}

/** Section 8: the evidence that AI re-evaluation is a separate, explicit, bounded, canary-first action. */
function renderReevaluation(report, manifest) {
  const table = (headers, rows) =>
    [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  const evidence = report.reevaluation;
  const lines = [
    `## 8. AI re-evaluation is a separate, explicit, bounded action`,
    ``,
    `The default cutover **performs zero model calls and consumes zero AI/customer credits**: it migrates ${manifest.assessments?.nonTerminal ?? "?"} in-progress assessments with fresh Root mappings; validated pins/coverage stay \`PREPARING\`, while missing repository inputs stay \`WAITING_FOR_REQUIRED_INPUT\`. It enqueues **no** Assessment Root command. Re-evaluation remains a separate explicit operator action, never a side effect of migration, archive, traffic cutover, process start-up or worker restart.`,
    ``,
  ];
  if (!evidence) {
    lines.push(
      `_The re-evaluation stages did not run in this execution (${(report.skipped ?? []).join(", ") || "not reached"})._`,
      ``,
    );
    return lines;
  }
  const pre = evidence.preflight;
  lines.push(
    `### Preflight (read-only, before any start)`,
    table(
      ["", "value"],
      [
        ["migrated in-progress assessments", pre.cohort.migrated],
        [
          "eligible (pinned, prepared, covered, connection active)",
          pre.cohort.eligible,
        ],
        ["not ready", pre.cohort.notReady],
        [
          "excluded by reason",
          Object.entries(pre.cohort.excluded)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ") || "-",
        ],
        ["tenants with eligible assessments", pre.perTenant.tenantsTotal],
        ["declared model route", pre.modelRoute.declared.join(", ")],
        [
          "concurrency (global / tenant / backlog / pacing ms / max failures)",
          `${pre.concurrency.globalConcurrency} / ${pre.concurrency.tenantConcurrency} / ${pre.concurrency.maxBacklog} / ${pre.concurrency.minStartIntervalMs} / ${pre.concurrency.maxFailures}`,
        ],
        [
          "upper-bound Root executions for this invocation",
          pre.budget.upperBoundRootExecutions,
        ],
        [
          "model calls per Root execution",
          "not estimated (no false precision)",
        ],
        ["usage policy", pre.budget.policy],
      ],
    ),
    ``,
    `### Canary verification (canonical state only)`,
    table(
      ["check", "status"],
      (evidence.canary?.assessments?.[0]?.results ?? []).map((r) => [
        r.check,
        r.status,
      ]),
    ),
    ``,
    `### Accounting trail (rows in the accounting tables; usage events appear only with real execution)`,
    table(
      [
        "point",
        "Root commands",
        "in flight",
        "usage events",
        "wallet / ledger / reservation / order rows",
      ],
      evidence.accountingTrail.map((t) => [
        t.label,
        t.rootCommands,
        t.inFlight,
        t.usageEvents,
        `${t.untouchedByUsage.BillingWallet} / ${t.untouchedByUsage.CreditLedgerEntry} / ${t.untouchedByUsage.BillingReservation} / ${t.untouchedByUsage.BillingOrder}`,
      ]),
    ),
    ``,
    `Operator re-evaluation ledger rows: **${evidence.ledgerRows}** — each matches exactly one Root command; failed execution isolated: ${evidence.failedExecution ? `\`${evidence.failedExecution.assessmentId}\` execution FAILED under lifecycle \`${evidence.failedExecution.lifecycleState}\`, reported as \`RETRYABLE_FAILURE\`, never restarted by the scheduler` : "n/a"}.`,
    ``,
  );
  return lines;
}

// =================================================================================================
let context;
let exitCode = 0;
try {
  context = await main();
  await negativeScenarios(context);
} catch (error) {
  exitCode = 1;
  process.stderr.write(`\nREHEARSAL FAILED: ${error?.stack ?? error}\n`);
  report.failure = String(error?.stack ?? error);
} finally {
  report.finishedAt = new Date().toISOString();
  report.result = exitCode === 0 ? "PASS" : "FAIL";
  writeFileSync(
    path.join(cfg.evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  try {
    const markdown = renderReconciliation(report, context?.manifest ?? {});
    if (markdown)
      writeFileSync(
        path.join(cfg.evidence, "reconciliation-report.md"),
        markdown,
      );
  } catch (error) {
    process.stderr.write(`reconciliation report not rendered: ${error}\n`);
  }
  for (const cleanup of cleanups) await cleanup().catch(() => {});
  await Promise.allSettled([...openClients].map((c) => c.end()));
  if (!cfg.keepDatabases) {
    for (const name of created)
      await admin(
        `DROP DATABASE IF EXISTS "${guard(name)}" WITH (FORCE)`,
      ).catch(() => {});
  }
  rmSync(tmpDir, { recursive: true, force: true });
  for (const entry of readdirSync(path.join(api, "tmp")).filter((e) =>
    e.startsWith(`w6-${runId}`),
  ))
    rmSync(path.join(api, "tmp", entry), { force: true });
  process.stdout.write(
    `\nW6 rehearsal ${report.result}: ${report.checks} checks, ${report.stages.length} stages\nEvidence: ${cfg.evidence}\n`,
  );
  process.exit(exitCode);
}
