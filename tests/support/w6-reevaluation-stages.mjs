// Rehearsal stages for the SEPARATE, explicit re-evaluation phase (W6 cutover safety correction).
//
// The migration prepares V2 state and stops. These stages prove, on the same disposable, migrated,
// production-shaped database and with the REAL built API, CLI and Assessment Root graph (only the
// model is scripted: no provider is ever called):
//   * preflight is read-only; every refusal changes nothing;
//   * booting / restarting the API starts nothing;
//   * a canary start enqueues exactly one Root command and spends nothing; it is idempotent, and a
//     duplicate cutover command is a no-op;
//   * usage is attributed only to the assessment that really executed, once per invocation;
//   * bulk is refused until a canary is verified from canonical state; then it is bounded by a
//     global cap, a per-tenant cap and queue back-pressure, exactly, even with concurrent operators;
//   * a failed start or a failed execution is isolated to its assessment.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { runPython } from "./legal-portfolio-stack.mjs";
import { WORKER_KEY, startApi } from "./w6-api.mjs";
import {
  ACCOUNTING_TABLES_NEVER_MOVED_BY_USAGE,
  accountingFingerprint,
  fingerprint,
  stateFingerprint,
} from "./w6-fingerprint.mjs";

const ROOT_COMMAND = "command.assessment.root.requested.v1";
const ROUTE = "openai/rehearsal-model";
const OPERATOR = "w6-rehearsal-operator";
const IN_FLIGHT = `'ACTIVE','FINALIZING'`;

export function reevaluationStages(ctx) {
  const { cli, client, db, run1, manifest, ok, eq, scalar, one, dbUrl, cfg } =
    ctx;
  const S = { evidence: {} }; // shared across the sequential stages
  const rows = async (sql, params = []) =>
    (await client.query(sql, params)).rows;
  const noWait = ["--min-start-interval-ms", "0"];
  const rx = (sub, argv = [], options = {}) =>
    cli(db, [`reevaluation-${sub}`, ...argv], options);
  const start = (mode, argv = [], options = {}) =>
    rx(
      "start",
      [
        "--cutover-run",
        run1,
        "--mode",
        mode,
        "--authorized-by",
        OPERATOR,
        "--model-route",
        ROUTE,
        ...noWait,
        ...argv,
      ],
      options,
    );
  const batch = (argv, options = {}) =>
    start("BATCH", ["--confirm-bulk", ...argv], options);

  const snapshot = async () => ({
    state: await stateFingerprint(client),
    accounting: await accountingFingerprint(client),
    v1: await fingerprint(client, { stable: true }),
  });
  /** `LEGACY_MIGRATION_RUN_COMPLETED` legitimately grows with every tool run. */
  const withoutRunAudit = (snap) => {
    const copy = structuredClone(snap);
    delete copy.state.audit.LEGACY_MIGRATION_RUN_COMPLETED;
    return copy;
  };
  const rootCommands = (where = "") =>
    scalar(
      client,
      `SELECT count(*)::int FROM "OutboxMessage" WHERE "eventType" = '${ROOT_COMMAND}' ${where}`,
    );
  const lifecycle = async (id) =>
    scalar(
      client,
      `SELECT "lifecycleState"::text FROM "Assessment" WHERE id = $1`,
      [id],
    );
  const inFlightByOwner = async () =>
    Object.fromEntries(
      (
        await rows(
          `SELECT a."ownerId" AS owner, count(*)::int AS n FROM "Assessment" a
             JOIN "AssessmentRuntime" r ON r."assessmentId" = a.id
            WHERE a."lifecycleState"::text IN (${IN_FLIGHT}) AND r."executionState"::text <> 'FAILED' GROUP BY 1`,
        )
      ).map((row) => [row.owner, row.n]),
    );
  /** Independent oracle: unstarted, pinned, prepared assessments in the same fair order. */
  const eligibleRows = () =>
    rows(`
      SELECT s."assessmentId" AS id, s."ownerId" AS owner
        FROM "LegacyAssessmentArchive" s
        JOIN "Assessment" a ON a.id = s."assessmentId"
        JOIN "AssessmentCase" c ON c."assessmentId" = a.id
       WHERE s.disposition = 'BACKFILLED_NON_TERMINAL' AND a."lifecycleState"::text = 'PREPARING'
         AND c."repositorySnapshotId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "LegacyReevaluation" l WHERE l."assessmentId" = a.id)
       ORDER BY row_number() OVER (PARTITION BY s."ownerId" ORDER BY s."archivedAt", s."assessmentId"),
                s."ownerId", s."archivedAt", s."assessmentId"`);
  const refuse = (label, argv, code) => {
    const refused = rx("start", argv, { expectExit: 1 });
    ok(
      refused.stderr.includes(code),
      `${label}: expected ${code}, got ${refused.stderr.slice(0, 400)}`,
    );
    return refused;
  };
  const accountingTrail = [];
  const trail = async (label) =>
    accountingTrail.push({
      label,
      usageEvents: await scalar(
        client,
        `SELECT count(*)::int FROM "LlmUsageEvent"`,
      ),
      rootCommands: await rootCommands(),
      inFlight: Object.values(await inFlightByOwner()).reduce(
        (a, b) => a + b,
        0,
      ),
      untouchedByUsage: Object.fromEntries(
        Object.entries(await accountingFingerprint(client))
          .filter(([table]) =>
            ACCOUNTING_TABLES_NEVER_MOVED_BY_USAGE.includes(table),
          )
          .map(([table, value]) => [table, value.n]),
      ),
    });

  /** Two operators at once (async spawn): the cap must hold across processes. */
  const cliAsync = (argv) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cfg.cli, ...argv, "--confirm-database", db],
        {
          cwd: path.join(ctx.root, "apps/api"),
          env: {
            ...process.env,
            DATABASE_URL: dbUrl(db),
            LCSP_ARTIFACT_STORAGE_PATH: ctx.storage,
          },
        },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("error", reject);
      child.on("close", (exit) => {
        try {
          resolve({ exit, json: JSON.parse(out), stderr: err });
        } catch {
          resolve({ exit, json: null, stderr: err });
        }
      });
    });

  const stages = [];
  const add = (name, fn) => stages.push([name, fn]);

  // -----------------------------------------------------------------------------------------------
  add(
    "re-evaluation 1/7: preflight is read-only; every refusal changes nothing",
    async () => {
      const eligible = await eligibleRows();
      eq(
        eligible.length,
        manifest.expectedBackfillReasons.PINNED_LATEST_READY_SNAPSHOT,
        "the oracle sees exactly the pinned, prepared assessments",
      );
      const perOwner = {};
      for (const row of eligible)
        perOwner[row.owner] = (perOwner[row.owner] ?? 0) + 1;
      ok(
        Object.keys(perOwner).length >= 3 &&
          Object.values(perOwner).every((n) => n >= 2),
        `need 3 tenants with >= 2 eligible assessments each, got ${JSON.stringify(perOwner)}`,
      );
      S.eligible = eligible;
      S.perOwner = perOwner;
      S.a1 = eligible[0].id;
      S.a1Owner = eligible[0].owner;
      const nonTerminal = manifest.assessments.nonTerminal;
      const unpinned = nonTerminal - eligible.length;
      const before = await snapshot();

      const pre = rx("preflight", [
        "--cutover-run",
        run1,
        "--model-route",
        ROUTE,
        "--max-total",
        "5",
      ]).json;
      S.evidence.preflight = pre;
      eq(pre.blockers, []);
      eq(pre.gates, {
        cutoverValidated: true,
        blockingFailures: 0,
        failingChecks: [],
        restoreBoundaryClosed: true,
        modelRouteDeclared: true,
      });
      eq(
        pre.cohort,
        {
          migrated: nonTerminal,
          byState: {
            READY_NOT_STARTED: eligible.length,
            WAITING: unpinned,
          },
          eligible: eligible.length,
          notReady: unpinned,
          excluded: {
            NOT_PREPARING: unpinned,
          },
          alreadyScheduledOrFinished: 0,
          startedByOperator: 0,
          startedOtherwise: 0,
        },
        "eligible vs excluded-by-reason matches the independent oracle",
      );
      eq(pre.perTenant.tenantsTotal, Object.keys(perOwner).length);
      eq(
        Object.fromEntries(
          pre.perTenant.top.map((t) => [t.ownerId, t.eligible]),
        ),
        perOwner,
        "eligible assessments per tenant",
      );
      eq(pre.concurrency, {
        globalConcurrency: 2,
        tenantConcurrency: 1,
        maxBacklog: 2,
        minStartIntervalMs: 5000,
        maxFailures: 3,
        maxTotal: 5,
      });
      eq(pre.currentLoad, { inFlight: 0, queued: 0 });
      eq(pre.modelRoute.declared, [ROUTE]);
      eq(pre.budget.upperBoundRootExecutions, 5);
      eq(pre.budget.modelInvocationsPerRoot, null);
      eq(pre.budget.walletConsultedByExecution, false);
      ok(
        /telemetry/iu.test(pre.budget.policy),
        "usage policy is reported as telemetry only",
      );
      eq(pre.canary, {
        canaryAssessments: 0,
        verified: false,
        attestedChecks: [],
      });
      eq(
        rx("preflight", ["--cutover-run", run1]).json.blockers,
        ["MODEL_ROUTE_NOT_DECLARED"],
        "an undeclared model route blocks the start",
      );
      eq(await snapshot(), before, "preflight is strictly read-only");

      // ---- every refusal, and nothing moved -----------------------------------------------------
      const target = ["--cutover-run", run1, "--model-route", ROUTE, ...noWait];
      refuse(
        "no authorization",
        [...target, "--mode", "CANARY", "--assessment-id", S.a1],
        "LEGACY_REEVALUATION_NOT_AUTHORIZED",
      );
      refuse(
        "no model route declared",
        [
          "--cutover-run",
          run1,
          "--mode",
          "CANARY",
          "--assessment-id",
          S.a1,
          "--authorized-by",
          OPERATOR,
          ...noWait,
        ],
        "LEGACY_REEVALUATION_MODEL_ROUTE_REQUIRED",
      );
      const authorized = [...target, "--authorized-by", OPERATOR];
      refuse(
        "a canary names its assessments explicitly",
        [...authorized, "--mode", "CANARY"],
        "LEGACY_REEVALUATION_SELECTION_INVALID",
      );
      const tooMany = eligible
        .slice(0, 6)
        .flatMap((r) => ["--assessment-id", r.id]);
      refuse(
        "a canary is a handful, never a fraction of the population",
        [...authorized, "--mode", "CANARY", ...tooMany],
        "LEGACY_REEVALUATION_SELECTION_INVALID",
      );
      const notMigrated = refuse(
        "a V1 terminal assessment is not a migrated in-progress one",
        [
          ...authorized,
          "--mode",
          "CANARY",
          "--assessment-id",
          manifest.ids.terminal[0],
        ],
        "LEGACY_REEVALUATION_SELECTION_INVALID",
      );
      ok(notMigrated.stderr.includes("NOT_MIGRATED"));
      const unready = refuse(
        "an assessment without a usable pinned snapshot",
        [
          ...authorized,
          "--mode",
          "CANARY",
          "--assessment-id",
          manifest.ids.withoutUsableSnapshot[0],
        ],
        "LEGACY_REEVALUATION_SELECTION_INVALID",
      );
      ok(unready.stderr.includes("NOT_PREPARING"));
      refuse(
        "a batch spends on many customers: it must be confirmed",
        [...authorized, "--mode", "BATCH", "--max-total", "3"],
        "LEGACY_REEVALUATION_BULK_NOT_CONFIRMED",
      );
      refuse(
        "a batch selects by eligibility, not by id",
        [
          ...authorized,
          "--mode",
          "BATCH",
          "--confirm-bulk",
          "--max-total",
          "3",
          "--assessment-id",
          S.a1,
        ],
        "LEGACY_REEVALUATION_SELECTION_INVALID",
      );
      refuse(
        "bulk before any canary",
        [
          ...authorized,
          "--mode",
          "BATCH",
          "--confirm-bulk",
          "--max-total",
          "3",
        ],
        "LEGACY_REEVALUATION_CANARY_REQUIRED",
      );
      eq(
        await snapshot(),
        before,
        "no refusal wrote, enqueued or spent anything",
      );
      eq(await rootCommands(), 0);
      eq(
        await scalar(client, `SELECT count(*)::int FROM "LegacyReevaluation"`),
        0,
      );
      S.baseline = before;
      await trail("after migration, preflight and refusals");
      return { eligible: eligible.length, unpinned, refusals: 11 };
    },
  );

  // -----------------------------------------------------------------------------------------------
  add(
    "re-evaluation 2/7: booting and restarting the API starts nothing",
    async () => {
      if (!ctx.apiAvailable()) {
        skipped(ctx, "re-evaluation-api");
        return { skipped: "no built API" };
      }
      const idle = await snapshot();
      for (const round of [1, 2]) {
        const api = await startApi({
          main: cfg.apiMain,
          databaseUrl: dbUrl(db),
          port: cfg.apiPort + 10 + round,
          storagePath: ctx.storage,
        });
        try {
          await sleep(3000); // every API timer and the outbox poller get a chance to run
          eq(
            await snapshot(),
            idle,
            `API boot #${round}: no lifecycle change, no Root command, no usage, no accounting effect`,
          );
        } finally {
          await api.stop();
        }
      }
      eq(await rootCommands(), 0);
      return { boots: 2 };
    },
  );

  // -----------------------------------------------------------------------------------------------
  add(
    "re-evaluation 3/7: a canary starts exactly one Root; rerun and duplicate cutover are no-ops",
    async () => {
      const { a1 } = S;
      const canary = start("CANARY", ["--assessment-id", a1]).json;
      S.canaryRun = canary.runId;
      eq(canary.started, [a1]);
      eq([canary.failed, canary.deferred, canary.notReady], [[], [], []]);
      eq(canary.stopReason, "MAX_TOTAL_REACHED");
      const command = await one(
        client,
        `SELECT id, status::text AS status, "aggregateId", payload FROM "OutboxMessage" WHERE "eventType" = $1`,
        [ROOT_COMMAND],
      );
      eq(
        [command.status, command.aggregateId, command.payload.assessmentId],
        ["PENDING", a1, a1],
      );
      eq(command.payload.idempotencyKey, `${a1}:${ROOT_COMMAND}:start`);
      eq(
        command.payload.correlationId,
        `legacy-reevaluation-${canary.runId}`,
        "the command's origin is provable from its payload",
      );
      const ledger = await one(
        client,
        `SELECT "assessmentId", "ownerId", mode::text AS mode, "startedBy", "rootCommandId", "runId" FROM "LegacyReevaluation"`,
      );
      eq(ledger, {
        assessmentId: a1,
        ownerId: S.a1Owner,
        mode: "CANARY",
        startedBy: OPERATOR,
        rootCommandId: command.id,
        runId: canary.runId,
      });
      eq(
        await scalar(
          client,
          `SELECT kind::text FROM "LegacyMigrationRun" WHERE id = $1`,
          [canary.runId],
        ),
        "REEVALUATION",
      );
      eq(await lifecycle(a1), "ACTIVE");
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "Assessment" WHERE "lifecycleState"::text = 'PREPARING'`,
        ),
        manifest.expectedBackfillReasons.PINNED_LATEST_READY_SNAPSHOT - 1,
        "every other pinned assessment is still only prepared; missing inputs remain waiting",
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "AuditEvent" WHERE "eventType" = 'LEGACY_REEVALUATION_STARTED'`,
        ),
        1,
      );
      eq(
        await accountingFingerprint(client),
        S.baseline.accounting,
        "a start only enqueues: no usage, reservation, wallet or ledger effect before an execution",
      );
      const status = rx("status", ["--assessment-id", a1]).json;
      eq(status.byState.STARTED_QUEUED, 1);
      eq(status.assessments, [
        {
          assessmentId: a1,
          state: "STARTED_QUEUED",
          lifecycleState: "ACTIVE",
          startedVia: "OPERATOR_REEVALUATION",
        },
      ]);
      eq(status.load, { inFlight: 1, queued: 1 });

      // ---- bulk is refused while the canary is unfinished ---------------------------------------
      const pending = rx("verify-canary", [], { expectExit: 3 }).json;
      eq(pending.verified, false);
      const byCheck = Object.fromEntries(
        pending.assessments[0].results.map((r) => [r.check, r.status]),
      );
      eq(byCheck.THREAD_UNIQUE, "PASS");
      eq(byCheck.NO_V1_AUTHORITY, "PASS");
      for (const check of [
        "EVENTS_RECORDED",
        "MODEL_USAGE_RECORDED",
        "ACCOUNTING_CONSISTENT",
        "DECISIONS_RECORDED",
        "ARTIFACT_FLOW",
      ])
        eq(byCheck[check], "PENDING", `${check} waits for the real execution`);
      eq(byCheck.CHECKPOINT_RECORDED, "UNOBSERVABLE");
      refuse(
        "bulk while the canary has not run",
        [
          "--cutover-run",
          run1,
          "--mode",
          "BATCH",
          "--confirm-bulk",
          "--max-total",
          "3",
          "--authorized-by",
          OPERATOR,
          "--model-route",
          ROUTE,
          ...noWait,
        ],
        "LEGACY_REEVALUATION_CANARY_REQUIRED",
      );

      // ---- idempotency: the same command again, and a duplicate cutover command ------------------
      const afterStart = await snapshot();
      const again = start("CANARY", ["--assessment-id", a1]).json;
      eq([again.started, again.alreadyStarted], [[], [a1]]);
      eq(
        await snapshot(),
        afterStart,
        "rerun: no second thread, command, event, artifact or accounting effect",
      );
      eq(await rootCommands(), 1);

      const duplicate = cli(db, ["start", "--kind", "CUTOVER"], {
        extra: ["--report-file-root", ctx.reportsDir],
      });
      const rerun = cli(db, [
        "execute",
        "--run",
        duplicate.json.runId,
        "--report-file-root",
        ctx.reportsDir,
      ]);
      eq(rerun.json.validation.summary.blockingFailures, 0);
      eq(
        withoutRunAudit(await snapshot()),
        withoutRunAudit(afterStart),
        "a duplicate cutover command changes nothing and starts nothing",
      );
      eq(await rootCommands(), 1);
      await trail("after the canary start (nothing executed yet)");
      return { canaryRun: canary.runId };
    },
  );

  // -----------------------------------------------------------------------------------------------
  add(
    "re-evaluation 4/7: the REAL Root executes the canary; usage lands only on it; verification passes",
    async () => {
      if (!ctx.apiAvailable()) {
        skipped(ctx, "re-evaluation-execution");
        return { skipped: "no built API" };
      }
      const { a1 } = S;
      S.api = await startApi({
        main: cfg.apiMain,
        databaseUrl: dbUrl(db),
        port: cfg.apiPort + 20,
        storagePath: ctx.storage,
      });
      ctx.cleanups.push(() => S.api.stop());
      const { api } = S;
      const thread = await scalar(
        client,
        `SELECT "threadId"::text FROM "AssessmentRuntime" WHERE "assessmentId" = $1`,
        [a1],
      );
      const repoDir = path.join(ctx.tmpDir, "w6-canary-repo");
      mkdirSync(path.join(repoDir, "src"), { recursive: true });
      writeFileSync(
        path.join(repoDir, "src/retention.py"),
        "# w6 rehearsal repository\nclass Notices:\n    keep_days = 30\n",
      );
      const checkpointUrl = `postgresql://postgres:postgres@127.0.0.1:${cfg.port}/${db}`;
      const root = await runPython(
        path.join(ctx.root, "deepagents/tests/vertical/w6_scripted_root.py"),
        [api.base, WORKER_KEY, a1, repoDir, checkpointUrl],
      );
      writeFileSync(
        path.join(cfg.evidence, "canary-root-run.json"),
        JSON.stringify(root, null, 2),
      );
      eq(
        root.result.state,
        "SUCCEEDED",
        JSON.stringify({ result: root.result, trace: root.trace }).slice(
          0,
          2500,
        ),
      );
      eq(root.remainingSteps, 0);
      eq(root.result.threadId, thread, "the Root ran on the fresh V2 thread");
      eq(
        [
          root.captured.context.facts.length,
          root.captured.context.evidence.length,
        ],
        [0, 0],
        "the Root started from nothing: no V1 fact or evidence was promoted",
      );
      const rules = await rows(
        `SELECT "engineeringRuleId" AS id, "resolutionState"::text AS state FROM "AssessmentDecisionCoverage" WHERE "assessmentId" = $1 ORDER BY 1`,
        [a1],
      );
      eq(rules.length, 3);
      ok(
        rules.every((r) => r.state === "RESOLVED"),
        "every pinned rule was decided by the Root",
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "AssessmentRuleDecision" WHERE "assessmentId" = $1 AND state::text = 'ACCEPTED'`,
          [a1],
        ),
        3,
      );
      eq(
        await scalar(
          client,
          `SELECT count(DISTINCT "threadId")::int FROM "AssessmentEvent" WHERE "assessmentId" = $1`,
          [a1],
        ),
        1,
        "all events are on one thread",
      );
      eq(
        (await scalar(
          client,
          `SELECT count(*)::int FROM public.checkpoints WHERE thread_id = $1`,
          [thread],
        )) > 0,
        true,
        "the real LangGraph Postgres checkpointer persisted this thread",
      );

      // ---- usage: telemetry only, idempotent per invocation, attributed to the executed assessment -
      const occurredAt = new Date().toISOString();
      const usageBody = (invocationId, extra = {}) => ({
        assessmentId: a1,
        runId: "w6-rehearsal-run",
        invocationId,
        agentRole: "ASSESSMENT_ROOT",
        provider: "openai",
        model: "rehearsal-model",
        inputTokens: "1200",
        outputTokens: "300",
        totalTokens: "1500",
        occurredAt,
        ...extra,
      });
      const usage = (invocationId, extra) =>
        api.worker(
          "POST",
          "/internal/billing/usage",
          usageBody(invocationId, extra),
        );
      const accountingBefore = await accountingFingerprint(client);
      // A worker retry resends the identical report: it is accepted and recorded once.
      for (const invocation of ["inv-1", "inv-2", "inv-1"]) {
        const posted = await usage(invocation);
        ok(
          [200, 201].includes(posted.status),
          `usage ${invocation}: ${posted.status} ${posted.bytes.toString("utf8").slice(0, 300)}`,
        );
      }
      // Re-using an invocation id for DIFFERENT content is a conflict, never a second charge.
      const conflicting = await usage("inv-1", { totalTokens: "9999" });
      eq(
        [conflicting.status, conflicting.json.problem.code],
        [409, "BILLING_IDEMPOTENCY_CONFLICT"],
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "LlmUsageEvent" WHERE "assessmentId" = $1`,
          [a1],
        ),
        2,
        "a retried invocation is recorded once",
      );
      eq(
        await scalar(client, `SELECT count(*)::int FROM "LlmUsageEvent"`),
        accountingBefore.LlmUsageEvent.n + 2,
        "no other assessment received any usage",
      );
      const after = await accountingFingerprint(client);
      for (const table of ACCOUNTING_TABLES_NEVER_MOVED_BY_USAGE)
        eq(
          after[table],
          S.baseline.accounting[table],
          `${table} did not move: usage is telemetry and never debits credits`,
        );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "LlmUsageEvent" WHERE "assessmentId" = $1 AND ("reservationId" IS NOT NULL OR coalesce("chargedCredits", 0) <> 0)`,
          [a1],
        ),
        0,
      );

      // ---- finalization + immutable report through the real endpoints ---------------------------
      const lease = async () => {
        const claimed = await api.worker(
          "POST",
          `/internal/assessment-runtime/${a1}/claim`,
        );
        eq(claimed.status, 200, claimed.bytes.toString("utf8"));
        return { "x-assessment-lease": claimed.json.data.leaseToken };
      };
      const finalizer = await lease();
      const finalization = await api.worker(
        "POST",
        `/internal/assessment-runtime/${a1}/finalization`,
        {},
        finalizer,
      );
      eq(finalization.status, 200, finalization.bytes.toString("utf8"));
      eq(finalization.json.data.blockers, []);
      const report = await api.worker(
        "POST",
        `/internal/assessment-runtime/${a1}/final-report`,
        {
          kind: "FINAL_REPORT",
          summary: "The assessment findings are complete.",
          findings: rules.map((r) => ({
            engineeringRuleId: r.id,
            summary: "The finding follows the accepted rule decision.",
            recommendations: [],
          })),
        },
        finalizer,
      );
      eq(report.status, 200, report.bytes.toString("utf8"));
      eq(report.json.data.lifecycleState, "COMPLETE");
      eq(await lifecycle(a1), "COMPLETE");
      eq(
        await scalar(client, `SELECT count(*)::int FROM "AssessmentArtifact"`),
        1,
        "exactly one V2 artifact exists: the canary's own report",
      );

      // ---- the canary is verified from canonical state -------------------------------------------
      const verified = rx("verify-canary").json;
      S.evidence.canary = verified;
      eq(verified.verified, true, JSON.stringify(verified.assessments));
      eq(
        verified.assessments[0].results.map((r) => [r.check, r.status]),
        [
          "THREAD_UNIQUE",
          "CHECKPOINT_RECORDED",
          "EVENTS_RECORDED",
          "MODEL_USAGE_RECORDED",
          "ACCOUNTING_CONSISTENT",
          "DECISIONS_RECORDED",
          "ARTIFACT_FLOW",
          "NO_V1_AUTHORITY",
        ].map((check) => [check, "PASS"]),
      );
      await trail(
        "after the canary executed (2 usage events, attributed to it alone)",
      );
      return { threadId: thread, usageEvents: 2 };
    },
  );

  // -----------------------------------------------------------------------------------------------
  add(
    "re-evaluation 5/7: the bounded batch (global cap, per-tenant cap, back-pressure, concurrent operators)",
    async () => {
      if (!S.api) return { skipped: "no built API" };
      // 1. conservative defaults: two at once, one per tenant
      const first = batch(["--max-total", "5"]).json;
      S.evidence.firstBatch = first;
      eq(
        first.started.length,
        2,
        "the global cap, not --max-total, bounds the batch",
      );
      eq(first.stopReason, "GLOBAL_CAP_REACHED");
      const owners = await rows(
        `SELECT "ownerId" AS owner FROM "LegacyReevaluation" WHERE mode::text = 'BATCH'`,
      );
      eq(new Set(owners.map((o) => o.owner)).size, 2, "one per tenant");
      eq(first.load, { inFlight: 2, queued: 2 });
      eq(await rootCommands(), 3, "the canary's command plus exactly two");
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "LegacyReevaluation" WHERE mode::text = 'BATCH'`,
        ),
        2,
      );

      // 2. the same command again: the cap is canonical state, so nothing more starts
      const sealed = await snapshot();
      const rerun = batch(["--max-total", "5"]).json;
      eq(rerun.started, []);
      eq(rerun.stopReason, "GLOBAL_CAP_REACHED");
      eq(
        await snapshot(),
        sealed,
        "a rerun starts nothing and changes nothing",
      );

      // 3. queue back-pressure: started-but-unclaimed Root runs stop further starts
      const backpressure = batch([
        "--max-total",
        "5",
        "--global-concurrency",
        "10",
        "--max-backlog",
        "2",
      ]).json;
      eq(backpressure.started, []);
      eq(backpressure.stopReason, "BACKPRESSURE");

      // 4. per-tenant cap: only tenants with nothing in flight may start one
      const busy = await inFlightByOwner();
      const remaining = await eligibleRows();
      const freeOwners = new Set(
        remaining.filter((r) => !busy[r.owner]).map((r) => r.owner),
      );
      ok(freeOwners.size >= 1, "a tenant with nothing in flight remains");
      const perTenant = batch([
        "--max-total",
        "50",
        "--global-concurrency",
        "10",
        "--max-backlog",
        "10",
        "--tenant-concurrency",
        "1",
      ]).json;
      eq(
        perTenant.started.length,
        freeOwners.size,
        "one start per free tenant",
      );
      eq(perTenant.stopReason, "TENANT_CAP_REACHED");
      ok(
        perTenant.deferred.every((d) => d.reason === "TENANT_CAP_REACHED"),
        "only the tenant cap deferred anything",
      );
      const afterTenant = await inFlightByOwner();
      ok(
        Object.values(afterTenant).every((n) => n <= 1),
        `no tenant exceeds its cap: ${JSON.stringify(afterTenant)}`,
      );

      // 5. two operators at once: the cap is exact across processes (advisory lock + canonical load)
      const loadNow = Object.values(await inFlightByOwner()).reduce(
        (a, b) => a + b,
        0,
      );
      const racers = await Promise.all(
        [1, 2].map(() =>
          cliAsync([
            "reevaluation-start",
            "--cutover-run",
            run1,
            "--mode",
            "BATCH",
            "--confirm-bulk",
            "--authorized-by",
            OPERATOR,
            "--model-route",
            ROUTE,
            ...noWait,
            "--max-total",
            "10",
            "--global-concurrency",
            String(loadNow + 2),
            "--max-backlog",
            "50",
            "--tenant-concurrency",
            "50",
          ]),
        ),
      );
      ok(
        racers.every((r) => r.exit === 0 && r.json),
        racers.map((r) => r.stderr).join("\n"),
      );
      eq(
        racers.reduce((sum, r) => sum + r.json.started.length, 0),
        2,
        "two concurrent operators together started exactly the 2 free slots",
      );
      eq(
        Object.values(await inFlightByOwner()).reduce((a, b) => a + b, 0),
        loadNow + 2,
        "the global cap was never exceeded",
      );
      eq(
        await rootCommands(),
        await scalar(client, `SELECT count(*)::int FROM "LegacyReevaluation"`),
        "exactly one Root command per ledger row",
      );
      await trail(
        "after the bounded batches (starts only; no execution, no new usage)",
      );
      eq(
        (await accountingFingerprint(client)).LlmUsageEvent.n,
        S.baseline.accounting.LlmUsageEvent.n + 2,
        "starting assessments moved no usage: only the executed canary has any",
      );
      return {
        firstBatch: first.started.length,
        perTenantBatch: perTenant.started.length,
      };
    },
  );

  // -----------------------------------------------------------------------------------------------
  add(
    "re-evaluation 6/7: failures are isolated (failed start, failure budget, failed execution)",
    async () => {
      if (!S.api) return { skipped: "no built API" };
      const [bad] = await eligibleRows();
      ok(bad, "an unstarted eligible assessment remains");
      const startedBefore = await scalar(
        client,
        `SELECT count(*)::int FROM "LegacyReevaluation"`,
      );
      await client.query(`
        CREATE OR REPLACE FUNCTION w6_fail_start() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = '${bad.id}' AND NEW."lifecycleState"::text = 'ACTIVE' THEN
            RAISE EXCEPTION 'w6 injected start failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER w6_fail_start BEFORE UPDATE ON "Assessment" FOR EACH ROW EXECUTE FUNCTION w6_fail_start();`);
      try {
        const open = [
          "--global-concurrency",
          "50",
          "--max-backlog",
          "50",
          "--tenant-concurrency",
          "50",
        ];
        // one failing assessment must not roll back, block or stop the others
        const isolated = batch(
          ["--max-total", "3", "--max-failures", "3", ...open],
          {
            expectExit: 4, // a failed start is never silent, yet the pass is isolated and completes
          },
        ).json;
        eq(isolated.failed.length, 1);
        eq(isolated.failed[0].assessmentId, bad.id);
        eq(
          isolated.started.length,
          3,
          "the other assessments were started regardless",
        );
        eq(isolated.stopReason, "MAX_TOTAL_REACHED");
        eq(
          await lifecycle(bad.id),
          "PREPARING",
          "the failed start rolled back by itself",
        );
        eq(
          await scalar(
            client,
            `SELECT count(*)::int FROM "LegacyReevaluation" WHERE "assessmentId" = $1`,
            [bad.id],
          ),
          0,
        );
        eq(await rootCommands('AND "aggregateId" = \'' + bad.id + "'"), 0);
        eq(
          await scalar(
            client,
            `SELECT count(*)::int FROM "AuditEvent" WHERE "eventType" = 'LEGACY_REEVALUATION_START_FAILED' AND "resourceId" = $1`,
            [bad.id],
          ),
          1,
          "the failure is recorded against that assessment",
        );
        eq(
          await scalar(
            client,
            `SELECT count(*)::int FROM "LegacyReevaluation"`,
          ),
          startedBefore + 3,
        );

        // a failure budget stops the pass: no mass retries, a distinct exit code
        const rerunsBefore = await rootCommands();
        const halted = batch(
          ["--max-total", "10", "--max-failures", "1", ...open],
          {
            expectExit: 4,
          },
        ).json;
        eq(halted.stopReason, "FAILURE_BUDGET_EXCEEDED");
        eq(
          halted.started,
          [],
          "the budget halted the pass before anything else started",
        );
        eq(await rootCommands(), rerunsBefore);
        eq(
          await scalar(
            client,
            `SELECT status::text FROM "LegacyMigrationRun" WHERE id = $1`,
            [halted.runId],
          ),
          "FAILED",
        );
      } finally {
        await client.query(
          `DROP TRIGGER IF EXISTS w6_fail_start ON "Assessment"; DROP FUNCTION IF EXISTS w6_fail_start();`,
        );
      }

      // a failed EXECUTION is the Root's own business: it is not retried, resurrected or propagated
      const loadBeforeFailure = rx("status").json.load.inFlight;
      const victim = await one(
        client,
        `SELECT l."assessmentId" AS id FROM "LegacyReevaluation" l JOIN "Assessment" a ON a.id = l."assessmentId"
          WHERE a."lifecycleState"::text = 'ACTIVE' AND l.mode::text = 'BATCH' ORDER BY l."assessmentId" LIMIT 1`,
      );
      const claim = await S.api.worker(
        "POST",
        `/internal/assessment-runtime/${victim.id}/claim`,
      );
      eq(claim.status, 200, claim.bytes.toString("utf8"));
      const failure = await S.api.worker(
        "POST",
        `/internal/assessment-runtime/${victim.id}/finish`,
        { state: "FAILED" },
        { "x-assessment-lease": claim.json.data.leaseToken },
      );
      eq(failure.status, 200, failure.bytes.toString("utf8"));
      const failedState = await lifecycle(victim.id);
      S.evidence.failedExecution = {
        assessmentId: victim.id,
        lifecycleState: failedState,
      };
      eq(
        rx("status").json.load.inFlight,
        loadBeforeFailure - 1,
        "a terminal FAILED execution releases its capacity slot without changing lifecycle",
      );
      const commandsBefore = await rootCommands();
      const next = batch([
        "--max-total",
        "2",
        "--global-concurrency",
        String(loadBeforeFailure),
        "--max-backlog",
        "50",
        "--tenant-concurrency",
        "50",
      ]).json;
      eq(next.started.length, 1, "the freed slot admits one later assessment");
      eq(
        next.stopReason,
        "GLOBAL_CAP_REACHED",
        "the existing global cap still holds",
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "LegacyReevaluation" WHERE "assessmentId" = $1`,
          [victim.id],
        ),
        1,
        "the failed assessment was not started a second time",
      );
      eq(
        await rootCommands(`AND "aggregateId" = '${victim.id}'`),
        1,
        "and has no second Root command",
      );
      eq(
        await lifecycle(victim.id),
        failedState,
        "its failure state is untouched",
      );
      ok(
        !next.started.includes(victim.id),
        "no retry storm: the failed one is not part of the next pass",
      );
      eq(
        await rootCommands(),
        commandsBefore + next.started.length,
        "only genuinely new starts enqueued anything",
      );
      const status = rx("status", ["--assessment-id", victim.id]).json;
      eq(status.assessments[0].lifecycleState, failedState);
      eq(
        status.assessments[0].state,
        "RETRYABLE_FAILURE",
        "a failed execution is surfaced as retryable, and nothing retries it",
      );
      return { failedExecution: S.evidence.failedExecution };
    },
  );

  // -----------------------------------------------------------------------------------------------
  add(
    "re-evaluation 7/7: final reconciliation (V1 untouched, ledger = commands, accounting moved only by real usage)",
    async () => {
      const ledgerRows = await scalar(
        client,
        `SELECT count(*)::int FROM "LegacyReevaluation"`,
      );
      eq(
        await rootCommands(),
        ledgerRows,
        "one Root command per operator start, no other",
      );
      // V2 executions are recorded in the table V1 also used; a RUNNING V2 turn is not V1 authority.
      ok(
        (await scalar(
          client,
          `SELECT count(*)::int FROM "AssessmentRuntimeTurn" WHERE boundary = 'ASSESSMENT_ROOT' AND state::text = 'RUNNING'`,
        )) >= 1,
        "a live V2 Root turn exists while the cutover is re-validated",
      );
      eq(
        await scalar(
          client,
          `SELECT count(*)::int FROM "OutboxMessage" WHERE "eventType" = '${ROOT_COMMAND}' AND payload ->> 'correlationId' LIKE 'legacy-migration-%'`,
        ),
        0,
        "the migration itself never enqueued one",
      );
      eq(
        await fingerprint(client, { stable: true }),
        S.baseline.v1,
        "no V1 table changed: V1 authority was not resurrected",
      );
      const validation = cli(db, ["validate", "--run", run1]).json;
      eq(validation.summary.blockingFailures, 0);
      for (const id of [
        "MIGRATION_ENQUEUED_NO_ROOT_COMMAND",
        "UNSTARTED_ASSESSMENTS_HAVE_NO_AI_EFFECT",
        "REEVALUATION_LEDGER_MATCHES_ROOT_COMMANDS",
      ])
        eq(
          validation.checks.find((c) => c.id === id)?.status,
          "PASS",
          `${id} holds after re-evaluation`,
        );
      const final = await accountingFingerprint(client);
      for (const table of ACCOUNTING_TABLES_NEVER_MOVED_BY_USAGE)
        eq(final[table], S.baseline.accounting[table], `${table} never moved`);
      eq(
        final.LlmUsageEvent.n - S.baseline.accounting.LlmUsageEvent.n,
        2,
        "the only accounting effect is the executed canary's two usage events",
      );

      // ---- ledger guards at the database ---------------------------------------------------------
      const reject = async (label, sql, params, pattern) => {
        let error = null;
        try {
          await client.query(sql, params);
        } catch (caught) {
          error = caught;
        }
        ok(
          error && pattern.test(String(error.message)),
          `${label}: ${error?.message}`,
        );
      };
      await reject(
        "an archived terminal assessment cannot enter the ledger",
        `INSERT INTO "LegacyReevaluation"("assessmentId","ownerId","runId",mode,"startedBy","rootCommandId") SELECT s."assessmentId", s."ownerId", (SELECT id FROM "LegacyMigrationRun" LIMIT 1), 'CANARY', 'x', 'y' FROM "LegacyAssessmentArchive" s WHERE s.disposition = 'ARCHIVED_TERMINAL' LIMIT 1`,
        [],
        /not backfilled/u,
      );
      await reject(
        "the ledger is append-only",
        `UPDATE "LegacyReevaluation" SET "startedBy" = 'tampered'`,
        [],
        /immutable|read-only|cannot be/iu,
      );
      if (S.api) await S.api.stop();
      writeFileSync(
        path.join(cfg.evidence, "reevaluation-evidence.json"),
        JSON.stringify({ ...S.evidence, accountingTrail, ledgerRows }, null, 2),
      );
      ctx.report.reevaluation = {
        preflight: S.evidence.preflight,
        canary: S.evidence.canary,
        firstBatch: S.evidence.firstBatch,
        failedExecution: S.evidence.failedExecution,
        accountingTrail,
        ledgerRows,
      };
      return { ledgerRows, accountingTrail: accountingTrail.length };
    },
  );

  return stages;
}

function skipped(ctx, label) {
  ctx.report.skipped = [...(ctx.report.skipped ?? []), label];
}
