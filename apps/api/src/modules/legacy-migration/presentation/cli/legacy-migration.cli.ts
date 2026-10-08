import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  LEGACY_MIGRATION_PHASES,
  LEGACY_MIGRATION_RUN_KINDS,
  LEGACY_REEVALUATION_CANARY_CHECKS,
  LEGACY_REEVALUATION_DEFAULTS,
  LEGACY_REEVALUATION_MODES,
  LEGACY_REEVALUATION_STOP_REASONS,
  type LegacyMigrationPhase,
  type LegacyMigrationRunKind,
  type LegacyReevaluationCanaryCheck,
  type LegacyReevaluationMode,
} from "@lcsp/contracts/legacy-migration";
import { ConsoleLogger, type LogLevel } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { NestFactory } from "@nestjs/core";

import { DEFAULT_LEGACY_REPORT_MAX_BYTES } from "../../infrastructure/storage/legacy-report-source.reader.js";
import {
  CloseLegacyRestoreBoundaryCommand,
  RecordLegacyRestorePointCommand,
} from "../../application/commands/record-legacy-restore-point/record-legacy-restore-point.command.js";
import { DEFAULT_PHASES } from "../../application/legacy-migration.types.js";
import type { ReevaluationLimits } from "../../application/legacy-reevaluation.types.js";
import { ValidateLegacyMigrationQuery } from "../../application/queries/validate-legacy-migration/validate-legacy-migration.query.js";
import { LegacyMigrationRunner } from "../../application/services/legacy-migration-runner.service.js";
import { LegacyReevaluationService } from "../../application/services/legacy-reevaluation.service.js";
import { LegacyMigrationCliModule } from "./legacy-migration-cli.module.js";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_BLOCKING_FAILURES = 3;
const EXIT_REEVALUATION_FAILED = 4;

const USAGE = `legacy-migration <command> --confirm-database <name> [options]

Commands
  preflight                       read-only readiness report (classifies report references)
  start --kind REHEARSAL|CUTOVER  open a run (CUTOVER refuses while preflight has blockers)
  restore-point --run ID --ref REF --digest SHA256 [--verified]
  execute --run ID [--phases QUIESCE,ARCHIVE,BACKFILL,VALIDATE]   (starts NO re-evaluation, spends NO AI budget)
  validate --run ID               read-only reconciliation report
  close-boundary --run ID         first accepted V2 write: forward repair only from here

Re-evaluation (SEPARATE from migration; spends AI budget; run only with explicit authorization)
  reevaluation-preflight  --cutover-run ID [--model-route P/M]... [--max-total N] [limits]
  reevaluation-start      --cutover-run ID --mode CANARY --assessment-id ID... --authorized-by WHO
                          --model-route P/M... [limits]
  reevaluation-start      --cutover-run ID --mode BATCH --max-total N --confirm-bulk --authorized-by WHO
                          --model-route P/M... [--attest-unobservable CHECK]... [limits]
  reevaluation-status     [--assessment-id ID]...
  reevaluation-verify-canary [--attest-unobservable CHECK]...
  limits: --global-concurrency N --tenant-concurrency N --max-backlog N
          --min-start-interval-ms N --max-failures N

Options
  --report-file-root DIR          (repeatable) where file: report references may be read
  --report-http-host HOST         (repeatable) host whose http(s): report references may be fetched
  --attest-non-persisting-host H  (repeatable) operator attests this host never retained bytes
  --fs-artifact-dir DIR           (repeatable) inventory cache/bundle export files with hashes
  --batch-size N  --sample-size N  --max-report-bytes N  --http-timeout-ms N
  --out FILE                      also write the JSON result to FILE

Exit codes: 0 ok · 1 error or refusal · 2 usage · 3 blocking validation failure / canary not verified
            4 a re-evaluation start failed (or its failure budget halted the pass)

DATABASE_URL must be exported explicitly; this tool never reads .env files.`;

class UsageError extends Error {}

/** stdout carries the JSON result only; every Nest log line goes to stderr. */
class StderrLogger extends ConsoleLogger {
  protected override printMessages(
    messages: unknown[],
    context = "",
    logLevel: LogLevel = "log",
  ): void {
    super.printMessages(messages, context, logLevel, "stderr");
  }
}

function confirmedDatabase(confirmed: string | undefined): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new UsageError("DATABASE_URL must be exported explicitly");
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//u, ""));
  if (confirmed !== name)
    throw new UsageError(
      `--confirm-database must equal the target database name ("${name}")`,
    );
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  flag: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new UsageError(`${flag} must be a positive integer`);
  return parsed;
}

/** A migration run is a rehearsal or the cutover; a REEVALUATION run is created only by `reevaluation-start`. */
function nonNegativeInteger(
  value: string | undefined,
  fallback: number,
  flag: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new UsageError(`${flag} must be a non-negative integer`);
  return parsed;
}

function reevaluationMode(value: string | undefined): LegacyReevaluationMode {
  const mode = Object.values(LEGACY_REEVALUATION_MODES).find(
    (candidate) => candidate === value,
  );
  if (!mode) throw new UsageError("--mode must be CANARY or BATCH");
  return mode;
}

function attestedChecks(
  values: string[] | undefined,
): LegacyReevaluationCanaryCheck[] {
  return (values ?? []).map((raw) => {
    const check = Object.values(LEGACY_REEVALUATION_CANARY_CHECKS).find(
      (candidate) => candidate === raw,
    );
    if (!check) throw new UsageError(`unknown canary check "${raw}"`);
    return check;
  });
}

/** Conservative by default: two Root runs at once, one per tenant, a short queue, paced starts. */
function reevaluationLimits(values: {
  "global-concurrency"?: string;
  "tenant-concurrency"?: string;
  "max-backlog"?: string;
  "min-start-interval-ms"?: string;
  "max-failures"?: string;
}): ReevaluationLimits {
  const D = LEGACY_REEVALUATION_DEFAULTS;
  return {
    globalConcurrency: positiveInteger(
      values["global-concurrency"],
      D.GLOBAL_CONCURRENCY,
      "--global-concurrency",
    ),
    tenantConcurrency: positiveInteger(
      values["tenant-concurrency"],
      D.TENANT_CONCURRENCY,
      "--tenant-concurrency",
    ),
    maxBacklog: positiveInteger(
      values["max-backlog"],
      D.MAX_BACKLOG,
      "--max-backlog",
    ),
    minStartIntervalMs: nonNegativeInteger(
      values["min-start-interval-ms"],
      D.MIN_START_INTERVAL_MS,
      "--min-start-interval-ms",
    ),
    maxFailures: positiveInteger(
      values["max-failures"],
      D.MAX_FAILURES,
      "--max-failures",
    ),
  };
}

function runKind(value: string | undefined): LegacyMigrationRunKind {
  const kind = [
    LEGACY_MIGRATION_RUN_KINDS.REHEARSAL,
    LEGACY_MIGRATION_RUN_KINDS.CUTOVER,
  ].find((candidate) => candidate === value);
  if (!kind) throw new UsageError("--kind must be REHEARSAL or CUTOVER");
  return kind;
}

function phases(value: string | undefined): LegacyMigrationPhase[] {
  if (value === undefined) return [...DEFAULT_PHASES];
  const allowed: readonly string[] = Object.values(
    LEGACY_MIGRATION_PHASES,
  ).filter((phase) => phase !== LEGACY_MIGRATION_PHASES.PREFLIGHT);
  return value.split(",").map((raw) => {
    const phase = Object.values(LEGACY_MIGRATION_PHASES).find(
      (candidate) => candidate === raw.trim(),
    );
    if (!phase || !allowed.includes(phase))
      throw new UsageError(`unknown phase "${raw}"`);
    return phase;
  });
}

const json = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    2,
  );

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return command ? EXIT_OK : EXIT_USAGE;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      "confirm-database": { type: "string" },
      kind: { type: "string" },
      run: { type: "string" },
      ref: { type: "string" },
      digest: { type: "string" },
      verified: { type: "boolean", default: false },
      phases: { type: "string" },
      "report-file-root": { type: "string", multiple: true },
      "report-http-host": { type: "string", multiple: true },
      "attest-non-persisting-host": { type: "string", multiple: true },
      "fs-artifact-dir": { type: "string", multiple: true },
      "batch-size": { type: "string" },
      "sample-size": { type: "string" },
      "max-report-bytes": { type: "string" },
      "http-timeout-ms": { type: "string" },
      "cutover-run": { type: "string" },
      mode: { type: "string" },
      "assessment-id": { type: "string", multiple: true },
      "max-total": { type: "string" },
      "global-concurrency": { type: "string" },
      "tenant-concurrency": { type: "string" },
      "max-backlog": { type: "string" },
      "min-start-interval-ms": { type: "string" },
      "max-failures": { type: "string" },
      "model-route": { type: "string", multiple: true },
      "authorized-by": { type: "string" },
      "confirm-bulk": { type: "boolean", default: false },
      "attest-unobservable": { type: "string", multiple: true },
      out: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  confirmedDatabase(values["confirm-database"]);
  const requireRun = (): string => {
    if (!values.run) throw new UsageError("--run is required");
    return values.run;
  };
  const requireCutoverRun = (): string => {
    if (!values["cutover-run"])
      throw new UsageError("--cutover-run is required");
    return values["cutover-run"];
  };

  const report = {
    fileRoots: values["report-file-root"] ?? [],
    httpHosts: values["report-http-host"] ?? [],
    attestedNonPersistingHosts: values["attest-non-persisting-host"] ?? [],
    maxBytes: positiveInteger(
      values["max-report-bytes"],
      DEFAULT_LEGACY_REPORT_MAX_BYTES,
      "--max-report-bytes",
    ),
    httpTimeoutMs: positiveInteger(
      values["http-timeout-ms"],
      15_000,
      "--http-timeout-ms",
    ),
  };

  const app = await NestFactory.createApplicationContext(
    LegacyMigrationCliModule,
    {
      logger: new StderrLogger("legacy-migration", {
        logLevels: ["error", "warn"],
      }),
    },
  );
  try {
    const runner = app.get(LegacyMigrationRunner);
    const reevaluation = app.get(LegacyReevaluationService);
    const commands = app.get(CommandBus);
    const queries = app.get(QueryBus);
    let result: unknown;
    let exit = EXIT_OK;

    switch (command) {
      case "preflight":
        result = await runner.preflight(report);
        break;
      case "start":
        result = await runner.start(runKind(values.kind), report);
        break;
      case "restore-point": {
        if (
          !values.ref ||
          !values.digest ||
          !/^[0-9a-f]{64}$/u.test(values.digest)
        )
          throw new UsageError("--ref and a 64-hex --digest are required");
        result = await commands.execute(
          new RecordLegacyRestorePointCommand(
            requireRun(),
            values.ref,
            values.digest,
            values.verified,
          ),
        );
        break;
      }
      case "execute": {
        const outcome = await runner.execute({
          runId: requireRun(),
          phases: phases(values.phases),
          report,
          filesystemArtifactDirs: values["fs-artifact-dir"] ?? [],
          backfillBatchSize: positiveInteger(
            values["batch-size"],
            100,
            "--batch-size",
          ),
          sampleSize: positiveInteger(
            values["sample-size"],
            25,
            "--sample-size",
          ),
          correlationId: LegacyMigrationRunner.newCorrelationId(),
        });
        if ((outcome.validation?.summary.blockingFailures ?? 0) > 0)
          exit = EXIT_BLOCKING_FAILURES;
        result = outcome;
        break;
      }
      case "validate": {
        const report = await queries.execute(
          new ValidateLegacyMigrationQuery(
            requireRun(),
            positiveInteger(values["sample-size"], 25, "--sample-size"),
          ),
        );
        if (report.summary.blockingFailures > 0) exit = EXIT_BLOCKING_FAILURES;
        result = report;
        break;
      }
      case "close-boundary":
        result = await commands.execute(
          new CloseLegacyRestoreBoundaryCommand(requireRun()),
        );
        break;
      case "reevaluation-preflight":
        result = await reevaluation.preflight({
          cutoverRunId: requireCutoverRun(),
          limits: reevaluationLimits(values),
          maxTotal: values["max-total"]
            ? positiveInteger(values["max-total"], 1, "--max-total")
            : null,
          modelRoutes: values["model-route"] ?? [],
          attestedChecks: attestedChecks(values["attest-unobservable"]),
          sampleSize: positiveInteger(
            values["sample-size"],
            10,
            "--sample-size",
          ),
        });
        break;
      case "reevaluation-start": {
        const started = await reevaluation.start({
          cutoverRunId: requireCutoverRun(),
          mode: reevaluationMode(values.mode),
          assessmentIds: values["assessment-id"] ?? [],
          maxTotal: positiveInteger(values["max-total"], 1, "--max-total"),
          limits: reevaluationLimits(values),
          modelRoutes: values["model-route"] ?? [],
          authorizedBy: values["authorized-by"] ?? "",
          confirmBulk: values["confirm-bulk"],
          attestedChecks: attestedChecks(values["attest-unobservable"]),
          sampleSize: positiveInteger(
            values["sample-size"],
            10,
            "--sample-size",
          ),
        });
        // 4 = at least one start failed (the pass was isolated, but an operator must look).
        if (
          started.failed.length > 0 ||
          started.stopReason ===
            LEGACY_REEVALUATION_STOP_REASONS.FAILURE_BUDGET_EXCEEDED
        )
          exit = EXIT_REEVALUATION_FAILED;
        result = started;
        break;
      }
      case "reevaluation-status":
        result = await reevaluation.status(values["assessment-id"]);
        break;
      case "reevaluation-verify-canary": {
        const verification = await reevaluation.verifyCanary(
          attestedChecks(values["attest-unobservable"]),
        );
        if (!verification.verified) exit = EXIT_BLOCKING_FAILURES;
        result = verification;
        break;
      }
      default:
        throw new UsageError(`unknown command "${command}"`);
    }

    const text = json(result);
    if (values.out) writeFileSync(values.out, `${text}\n`, { mode: 0o600 });
    process.stdout.write(`${text}\n`);
    return exit;
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`error: ${error.message}\n\n${USAGE}\n`);
      process.exit(EXIT_USAGE);
    }
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(EXIT_FAILURE);
  },
);
