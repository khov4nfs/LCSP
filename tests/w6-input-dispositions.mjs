#!/usr/bin/env node
// Focused forward repair of a preserved DISPOSABLE W6 copy. No migrations, model calls or full rehearsal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  accountingFingerprint,
  fingerprint,
  stateFingerprint,
} from "./support/w6-fingerprint.mjs";
import { startApi } from "./support/w6-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receipt = path.resolve(
  process.argv[2] ?? "reports/w6-rehearsal/20261008075952_82952",
);
const original = JSON.parse(
  readFileSync(path.join(receipt, "report.json"), "utf8"),
);
const db = `lcsp_w6_reh_main_${original.runId}`;
assert.match(db, /^lcsp_w6_reh_main_[0-9]+_[0-9]+$/u);
assert.equal(original.result, "PASS");
const port = original.config.port;
assert.equal(port, 55461, "only the W6 disposable local target is permitted");
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/${db}`;
process.env.LCSP_ARTIFACT_STORAGE_PATH = path.join(receipt, "storage");
const out = path.join(
  root,
  "reports/w6-input-dispositions",
  `${new Date().toISOString().replaceAll(/[-:.TZ]/gu, "")}_${process.pid}`,
);
mkdirSync(out, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receiptHash = sha(readFileSync(path.join(receipt, "report.json")));
const req = createRequire(path.join(root, "apps/api/package.json"));
const { Client } = req("pg");
await import(pathToFileURL(req.resolve("reflect-metadata")).href);
const { NestFactory } = req("@nestjs/core");
const { QueryBus } = req("@nestjs/cqrs");
const built = (name) =>
  import(pathToFileURL(path.join(root, "apps/api/tmp/w6-cli/src", name)).href);
const { LegacyMigrationCliModule } = await built(
  "modules/legacy-migration/presentation/cli/legacy-migration-cli.module.js",
);
const { PrismaService } = await built(
  "infrastructure/prisma/prisma.service.js",
);
const { LegacyMigrationRunner } = await built(
  "modules/legacy-migration/application/services/legacy-migration-runner.service.js",
);
const { LegacyValidationRepository } = await built(
  "modules/legacy-migration/infrastructure/persistence/legacy-validation.repository.js",
);
const { LegacyArchiveRepository } = await built(
  "modules/legacy-migration/infrastructure/persistence/legacy-archive.repository.js",
);
const { SQL_ARCHIVE_SOURCES } = await built(
  "modules/legacy-migration/infrastructure/persistence/legacy-archive-registry.js",
);
const { BackfillLegacyAssessmentsHandler } = await built(
  "modules/legacy-migration/application/commands/backfill-legacy-assessments/backfill-legacy-assessments.handler.js",
);
const { BackfillLegacyAssessmentsCommand } = await built(
  "modules/legacy-migration/application/commands/backfill-legacy-assessments/backfill-legacy-assessments.command.js",
);
const { LegacyReevaluationRepository } = await built(
  "modules/legacy-migration/infrastructure/persistence/legacy-reevaluation.repository.js",
);
const { LegacyReevaluationService } = await built(
  "modules/legacy-migration/application/services/legacy-reevaluation.service.js",
);
const { ValidateLegacyMigrationQuery } = await built(
  "modules/legacy-migration/application/queries/validate-legacy-migration/validate-legacy-migration.query.js",
);
const { AssessmentLifecycleCoordinator } = await built(
  "modules/assessment/application/services/assessment-lifecycle-coordinator.service.js",
);
const { LEGACY_MIGRATION_ACTOR } = await built(
  "modules/legacy-migration/application/services/legacy-audit.js",
);
const { planLegacyBackfill } = await built(
  "modules/legacy-migration/domain/legacy-backfill-plan.js",
);
const { exclusionsOf } = await built(
  "modules/legacy-migration/domain/legacy-reevaluation.js",
);
const {
  ASSESSMENT_LIFECYCLE_STATES: L,
  AGENTIC_RUNTIME_TRANSITION_GUARDS: G,
  BLOCKER_REASONS,
} = await import(pathToFileURL(req.resolve("@lcsp/contracts/assessment")).href);
const {
  LEGACY_MIGRATION_RUN_KINDS: K,
  LEGACY_MIGRATION_PHASES: P,
  LEGACY_REEVALUATION_MODES: M,
  LEGACY_REEVALUATION_DEFAULTS: D,
  LEGACY_MIGRATION_ERROR_CODES: E,
} = await import(
  pathToFileURL(req.resolve("@lcsp/contracts/legacy-migration")).href
);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const app = await NestFactory.createApplicationContext(
  LegacyMigrationCliModule,
  { logger: false },
);
const prisma = app.get(PrismaService);
const validation = app.get(LegacyValidationRepository);
const runner = app.get(LegacyMigrationRunner);
const reeval = app.get(LegacyReevaluationService);
const cohortRepo = app.get(LegacyReevaluationRepository);
const coordinator = app.get(AssessmentLifecycleCoordinator);
const report = {
  originalReceipt: path.relative(root, receipt),
  originalChecks: original.checks,
  originalStages: original.stages.length,
  checks: [],
  cases: [],
};
const check = (label, actual, expected) => {
  assert.deepEqual(actual, expected, label);
  report.checks.push(label);
};
const rows = async (sql, params = []) => (await client.query(sql, params)).rows;
const inputs = () =>
  rows(`
 SELECT a.id, a."ownerId", a."lifecycleState"::text AS lifecycle, a."lifecycleRevision", r."threadId",
        c."repositorySnapshotId", c."legalPortfolioVersionId", c."caseRevision"
   FROM "LegacyAssessmentArchive" s JOIN "Assessment" a ON a.id=s."assessmentId"
   JOIN "AssessmentRuntime" r ON r."assessmentId"=a.id JOIN "AssessmentCase" c ON c."assessmentId"=a.id
  WHERE s.disposition='BACKFILLED_NON_TERMINAL' ORDER BY a.id`);
const snapshotSource = async () =>
  (
    await rows(
      `SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),' ')) AS h, count(*)::int AS n FROM "RepositorySnapshot" t`,
    )
  )[0];
const domainRows = async () => {
  const counts = {};
  for (const table of [
    "AssessmentCase",
    "AssessmentEvidence",
    "AssessmentCaseFact",
    "AssessmentRuleDecision",
    "AssessmentDecisionCoverage",
    "AssessmentRuntime",
    "LegacyArchiveRecord",
    "LegacyArchiveBlob",
    "LegacyAssessmentArchive",
    "AssessmentArtifact",
  ])
    counts[table] = (
      await rows(`SELECT count(*)::int AS n FROM "${table}"`)
    )[0].n;
  return counts;
};
let api;
try {
  const before = await inputs();
  const targets = before.filter((row) => row.repositorySnapshotId === null);
  const alreadyDisposed = targets.every(
    (row) => row.lifecycle === L.WAITING_FOR_REQUIRED_INPUT,
  );
  check("all 30 migrated non-terminals are present", before.length, 30);
  check("all 13 unpinned cases are individually inspected", targets.length, 13);
  const beforeSource = await snapshotSource();
  const beforeV1 = await fingerprint(client, { stable: true });
  const beforeAccounting = await accountingFingerprint(client);
  const beforeDomain = await domainRows();
  for (const row of targets) {
    const snapshots = await validation.snapshotsForBackfill(
      prisma,
      row.id,
      row.ownerId,
    );
    const plan = planLegacyBackfill(snapshots);
    check(
      `no verified recoverable snapshot for ${row.id}`,
      plan.pinSnapshotId,
      null,
    );
    report.cases.push({
      assessmentId: row.id,
      ownerId: row.ownerId,
      threadId: row.threadId,
      reason: plan.reason,
      examinedSnapshotIds: snapshots.map((s) => s.id),
      disposition: L.WAITING_FOR_REQUIRED_INPUT,
    });
  }
  const pinned = before.find((row) => row.repositorySnapshotId !== null);
  const owned = await validation.snapshotsForBackfill(
    prisma,
    pinned.id,
    pinned.ownerId,
  );
  assert.ok(
    planLegacyBackfill(owned).pinSnapshotId,
    "existing valid ownership/commit/identity provenance selects a real snapshot",
  );
  const otherOwner = before.find(
    (row) => row.ownerId !== pinned.ownerId,
  ).ownerId;
  check(
    "a different customer cannot supply this assessment's snapshot provenance",
    await validation.snapshotsForBackfill(prisma, pinned.id, otherOwner),
    [],
  );

  const policy = {
    fileRoots: [path.join(receipt, "legacy-report-fixtures")],
    httpHosts: [],
    attestedNonPersistingHosts: ["mock-storage.local"],
    maxBytes: 10485760,
    httpTimeoutMs: 1000,
  };
  const { runId } = await runner.start(K.CUTOVER, policy);
  report.runId = runId;
  const beforeFacts = await validation.backfilledFacts();
  check(
    "the original unpinned PREPARING records fail reconciliation",
    beforeFacts.unexplained_unpinned,
    alreadyDisposed ? 0 : 13,
  );
  const repaired = await runner.execute({
    runId,
    phases: [P.BACKFILL, P.VALIDATE],
    report: policy,
    filesystemArtifactDirs: [],
    backfillBatchSize: 25,
    sampleSize: 3,
    correlationId: runner.constructor.newCorrelationId(),
  });
  report.validation = repaired.validation;
  report.backfill = repaired.phases.BACKFILL;
  check(
    "only the 13 existing cases are dispositioned",
    repaired.phases.BACKFILL.reconciled,
    alreadyDisposed ? 0 : 13,
  );
  check(
    "no new case backfill or recovered pin was manufactured",
    [
      repaired.phases.BACKFILL.backfilled,
      repaired.phases.BACKFILL.pinnedSnapshot,
    ],
    [0, 0],
  );
  check(
    "existing reconciliation passes after the dispositions",
    repaired.validation.summary.blockingFailures,
    0,
  );
  const after = await inputs();
  check(
    "all case identities and Root threads are unchanged",
    after.map((r) => [
      r.id,
      r.threadId,
      r.legalPortfolioVersionId,
      r.caseRevision,
    ]),
    before.map((r) => [
      r.id,
      r.threadId,
      r.legalPortfolioVersionId,
      r.caseRevision,
    ]),
  );
  for (const row of report.cases)
    check(
      `waiting disposition ${row.assessmentId}`,
      after.find((r) => r.id === row.assessmentId).lifecycle,
      L.WAITING_FOR_REQUIRED_INPUT,
    );
  check(
    "no repository snapshot was fabricated or altered",
    await snapshotSource(),
    beforeSource,
  );
  check(
    "no case/evidence/coverage/decision/thread/archive/artifact was duplicated or promoted",
    await domainRows(),
    beforeDomain,
  );
  check(
    "V1 source content is unchanged",
    await fingerprint(client, { stable: true }),
    beforeV1,
  );
  check(
    "all authoritative accounting is unchanged",
    await accountingFingerprint(client),
    beforeAccounting,
  );

  const settled = await stateFingerprint(client);
  const rerun = await runner.execute({
    runId,
    phases: [P.BACKFILL, P.VALIDATE],
    report: policy,
    filesystemArtifactDirs: [],
    backfillBatchSize: 25,
    sampleSize: 3,
    correlationId: runner.constructor.newCorrelationId(),
  });
  check(
    "rerun produces no backfill, repair or pin",
    [
      rerun.phases.BACKFILL.backfilled,
      rerun.phases.BACKFILL.reconciled,
      rerun.phases.BACKFILL.pinnedSnapshot,
    ],
    [0, 0, 0],
  );
  const rerunState = await stateFingerprint(client);
  delete settled.audit.LEGACY_MIGRATION_RUN_COMPLETED;
  delete rerunState.audit.LEGACY_MIGRATION_RUN_COMPLETED;
  check(
    "rerun has no duplicate domain/event/outbox/archive effect",
    rerunState,
    settled,
  );
  const members = await cohortRepo.cohort();
  check(
    "no unpinned case is eligible for re-evaluation",
    members.filter(
      (m) =>
        targets.some((t) => t.id === m.assessmentId) &&
        exclusionsOf(m).length === 0,
    ),
    [],
  );
  const options = {
    cutoverRunId: runId,
    maxTotal: 1,
    limits: {
      globalConcurrency: D.GLOBAL_CONCURRENCY,
      tenantConcurrency: D.TENANT_CONCURRENCY,
      maxBacklog: D.MAX_BACKLOG,
      minStartIntervalMs: 0,
      maxFailures: D.MAX_FAILURES,
    },
    modelRoutes: ["openai/rehearsal-model"],
    sampleSize: 3,
    attestedChecks: [],
  };
  const preflight = await reeval.preflight(options);
  check(
    "waiting cases are counted as not ready, not started by another actor",
    [preflight.cohort.notReady, preflight.cohort.startedOtherwise],
    [13, 0],
  );
  for (const row of targets)
    await assert.rejects(
      reeval.start({
        ...options,
        mode: M.CANARY,
        assessmentIds: [row.id],
        authorizedBy: "w6-focused-repair",
        confirmBulk: false,
      }),
      (error) => error.code === E.REEVALUATION_SELECTION_INVALID,
    );
  report.checks.push(
    "all 13 explicit Root starts are refused before enqueue or billing",
  );

  process.env.LCSP_SNAPSHOT_ARCHIVE_CACHE_DIR = path.join(
    out,
    "snapshot-cache",
  );
  api = await startApi({
    main: path.join(root, "apps/api/tmp/w6-api/src/main.js"),
    databaseUrl: process.env.DATABASE_URL,
    port: 3488,
    storagePath: path.join(receipt, "storage"),
  });
  for (const row of targets) {
    const refused = await api.worker(
      "POST",
      `/internal/assessment-runtime/${row.id}/claim`,
    );
    check(`Root cannot claim ${row.id}`, refused.status, 409);
  }
  check(
    "refused starts and claims have no accounting effect",
    await accountingFingerprint(client),
    beforeAccounting,
  );

  const blockedTarget = report.cases.find(
    (row) => row.examinedSnapshotIds.length > 0,
  );
  const rollback = new Error("rollback-focused-blocker-test");
  for (const reason of [
    BLOCKER_REASONS.REPOSITORY_SNAPSHOT_UNAVAILABLE,
    BLOCKER_REASONS.LEGAL_PORTFOLIO_UNAVAILABLE,
  ]) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.assessment.findUniqueOrThrow({
          where: { id: blockedTarget.assessmentId },
        });
        await coordinator.transitionVerifiedInTx(
          {
            assessmentId: current.id,
            expectedRevision: current.lifecycleRevision,
            toState: L.BLOCKED,
            actorId: LEGACY_MIGRATION_ACTOR.id,
            correlationId: "w6-focused-blocker-fixture",
            blocker: {
              reason,
              reference:
                reason === BLOCKER_REASONS.REPOSITORY_SNAPSHOT_UNAVAILABLE
                  ? {
                      repositorySnapshotId:
                        blockedTarget.examinedSnapshotIds[0],
                    }
                  : { legalPortfolioVersionId: pinned.legalPortfolioVersionId },
            },
          },
          tx,
          [G.DEPENDENCY_PERMANENTLY_UNOBTAINABLE],
          LEGACY_MIGRATION_ACTOR,
        );
        const facts = await new LegacyValidationRepository(
          tx,
        ).backfilledFacts();
        check(
          `BLOCKED repository disposition requires exact reason ${reason}`,
          facts.unexplained_unpinned,
          reason === BLOCKER_REASONS.REPOSITORY_SNAPSHOT_UNAVAILABLE ? 0 : 1,
        );
        const [member] = await cohortRepo.cohort([current.id], tx);
        assert.ok(exclusionsOf(member).length > 0);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  check(
    "synthetic blocker checks rolled back; actual 13 remain waiting",
    (await inputs())
      .filter((r) => r.repositorySnapshotId === null)
      .map((r) => r.lifecycle),
    Array(13).fill(L.WAITING_FOR_REQUIRED_INPUT),
  );
  // Exercise initial backfill on the untouched restore drill, then roll the focused transaction back.
  const mainUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = mainUrl.replace(
    `_main_${original.runId}`,
    `_drill_${original.runId}`,
  );
  const drill = new PrismaService();
  process.env.DATABASE_URL = mainUrl;
  await drill.$connect();
  try {
    const baselineCounts = [
      await drill.assessmentRuntime.count(),
      await drill.assessmentCase.count(),
      await drill.legacyArchiveRecord.count(),
    ];
    try {
      await drill.$transaction(async (tx) => {
        const target = await tx.assessment.findUniqueOrThrow({
          where: { id: targets[0].id },
        });
        check(
          "fresh fixture comes from pre-cutover V1 state",
          target.lifecycleState,
          null,
        );
        const archive = new LegacyArchiveRepository(tx);
        const testRun = await archive.createRun({
          kind: K.REHEARSAL,
          toolVersion: "w6-focused-disposition",
          parameters: { rollbackOnly: true },
        });
        assert.match(target.id, /^[a-f0-9-]{36}$/u);
        const rule = SQL_ARCHIVE_SOURCES.find((r) => r.source === "ASSESSMENT");
        await archive.archiveSqlSource(tx, testRun, {
          ...rule,
          where: `(${rule.where}) AND t.id = '${target.id}'`,
        });
        const handler = app.get(BackfillLegacyAssessmentsHandler);
        const result = await handler.backfillOne(
          tx,
          new BackfillLegacyAssessmentsCommand(testRun, 1, "w6-fresh-rollback"),
          target.id,
          target.ownerId,
        );
        check(
          "initial backfill creates one waiting case",
          result.kind,
          "BACKFILLED",
        );
        const state = await tx.assessment.findUniqueOrThrow({
          where: { id: target.id },
        });
        const runtime = await tx.assessmentRuntime.findUniqueOrThrow({
          where: { assessmentId: target.id },
        });
        check(
          "initial missing input maps to WAITING_FOR_REQUIRED_INPUT",
          state.lifecycleState,
          L.WAITING_FOR_REQUIRED_INPUT,
        );
        check(
          "initial backfill has one case and one fresh Root mapping",
          [
            await tx.assessmentCase.count({
              where: { assessmentId: target.id },
            }),
            await tx.assessmentRuntime.count({
              where: { assessmentId: target.id },
            }),
          ],
          [1, 1],
        );
        check(
          "initial backfill invents no pin or coverage",
          [
            (
              await tx.assessmentCase.findUniqueOrThrow({
                where: { assessmentId: target.id },
              })
            ).repositorySnapshotId,
            await tx.assessmentDecisionCoverage.count({
              where: { assessmentId: target.id },
            }),
          ],
          [null, 0],
        );
        check(
          "initial Root mapping has no started execution or V1 thread reuse",
          [
            runtime.startedAt,
            await tx.assessmentRuntimeTurn.count({
              where: { threadId: runtime.threadId },
            }),
          ],
          [null, 0],
        );
        check(
          "initial waiting backfill rerun is a no-op",
          (
            await handler.backfillOne(
              tx,
              new BackfillLegacyAssessmentsCommand(
                testRun,
                1,
                "w6-fresh-rollback",
              ),
              target.id,
              target.ownerId,
            )
          ).kind,
          "SKIPPED",
        );
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    check(
      "restore drill remains untouched after the focused transaction",
      [
        await drill.assessmentRuntime.count(),
        await drill.assessmentCase.count(),
        await drill.legacyArchiveRecord.count(),
      ],
      baselineCounts,
    );
  } finally {
    await drill.$disconnect();
  }
  const finalValidation = await app
    .get(QueryBus)
    .execute(new ValidateLegacyMigrationQuery(runId, 5));
  check(
    "zero unexplained unpinned-ready records",
    finalValidation.checks.find(
      (c) => c.id === "BACKFILL_REPOSITORY_INPUT_DISPOSITIONS",
    ).status,
    "PASS",
  );
  check(
    "zero unpinned Root execution",
    finalValidation.checks.find((c) => c.id === "BACKFILL_UNPINNED_EXECUTION")
      .observed,
    0,
  );
  check(
    "final reconciliation has zero blocking failures",
    finalValidation.summary.blockingFailures,
    0,
  );
  check(
    "original 462-check/32-stage receipt is byte-identical",
    sha(readFileSync(path.join(receipt, "report.json"))),
    receiptHash,
  );
  report.counts = finalValidation.checks.find(
    (c) => c.id === "BACKFILL_REPOSITORY_INPUT_DISPOSITIONS",
  ).observed;
  report.runId = runId;
  report.result = "PASS";
  report.validation = finalValidation;
} catch (error) {
  report.result = "FAIL";
  report.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  if (api) await api.stop();
  await app.close();
  await client.end();
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    path.join(out, "reconciliation-report.md"),
    `# W6 focused repository-input reconciliation\n\nResult: ${report.result}; ${report.checks.length} focused checks.\n\nOriginal receipt: ${report.originalChecks} checks / ${report.originalStages} stages PASS, retained at ${report.originalReceipt}.\n\n${JSON.stringify(report.counts ?? {})}\n\n| Assessment | Source reason | Disposition | Preserved V2 thread |\n| --- | --- | --- | --- |\n${report.cases.map((r) => `| ${r.assessmentId} | ${r.reason} | ${r.disposition} | ${r.threadId} |`).join("\n")}\n\nRecovered pins: 0. Permanent loss was not established; actual BLOCKED dispositions: 0. No repository snapshots, evidence or coverage were fabricated.\n`,
  );
  console.log(
    `W6 focused input dispositions ${report.result}: ${report.checks.length} checks\nEvidence: ${out}`,
  );
  if (report.failure) console.error(report.failure);
}
