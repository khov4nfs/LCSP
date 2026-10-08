import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@jest/globals";
import { LEGACY_MIGRATION_PHASES } from "@lcsp/contracts/legacy-migration";

import { DEFAULT_PHASES } from "./application/legacy-migration.types.js";

/**
 * Safety invariant of the W6 cutover: migrating, archiving, switching traffic, booting the API or
 * restarting a worker must never start AI re-evaluation. Re-evaluation exists only as an explicit
 * operator command (`reevaluation-start`), and only `LegacyReevaluationService` may start a Root.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = path.resolve(moduleDir, "../..");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")
      ? [full]
      : [];
  });
const read = (file: string): string => readFileSync(file, "utf8");
const relative = (file: string): string => path.relative(moduleDir, file);

describe("default cutover starts no AI re-evaluation", () => {
  it("has no activation or re-evaluation phase", () => {
    expect(Object.values(LEGACY_MIGRATION_PHASES)).toEqual([
      "PREFLIGHT",
      "QUIESCE",
      "ARCHIVE",
      "BACKFILL",
      "VALIDATE",
    ]);
    expect([...DEFAULT_PHASES]).toEqual([
      "QUIESCE",
      "ARCHIVE",
      "BACKFILL",
      "VALIDATE",
    ]);
  });

  it("only the explicit re-evaluation service can move an assessment to ACTIVE or enqueue a Root", () => {
    const starters = sources(moduleDir)
      .filter((file) =>
        /prepareInTx|ROOT_REQUESTED|\.enqueue\(/u.test(read(file)),
      )
      .map(relative);
    expect(starters.sort()).toEqual(
      [
        "application/services/legacy-reevaluation.service.ts",
        "infrastructure/persistence/legacy-reevaluation.repository.ts",
        "infrastructure/persistence/legacy-validation.repository.ts",
      ].sort(),
    );
    // The validation repository only COUNTS Root commands; it must not call anything that starts one.
    expect(
      read(
        path.join(
          moduleDir,
          "infrastructure/persistence/legacy-validation.repository.ts",
        ),
      ),
    ).not.toMatch(/prepareInTx|\.enqueue\(/u);
    expect(
      read(
        path.join(
          moduleDir,
          "infrastructure/persistence/legacy-reevaluation.repository.ts",
        ),
      ),
    ).not.toMatch(/prepareInTx|\.enqueue\(/u);
  });

  it("the migration runner and phase handlers never reference the re-evaluation service", () => {
    for (const file of sources(path.join(moduleDir, "application/commands")))
      expect(read(file)).not.toMatch(/Reevaluation|prepareInTx/u);
    expect(
      read(
        path.join(
          moduleDir,
          "application/services/legacy-migration-runner.service.ts",
        ),
      ),
    ).not.toMatch(/Reevaluation|prepareInTx/u);
  });
});

describe("process start-up and worker restart cannot start it either", () => {
  it("the tooling has no start-up hook, timer or scheduler", () => {
    const offenders = sources(moduleDir)
      .filter((file) =>
        /OnModuleInit|OnApplicationBootstrap|@Cron|@Interval|setInterval\(/u.test(
          read(file),
        ),
      )
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("the API application module never imports the migration/re-evaluation tooling", () => {
    expect(read(path.join(apiSrc, "app.module.ts"))).not.toMatch(
      /modules\/legacy-migration\//u,
    );
  });

  it("no API provider other than the customer flow and runtime control enqueues a Root command", () => {
    const rootStarters = sources(apiSrc)
      .filter(
        (file) =>
          /ASSESSMENT_ROOT_COMMAND_TYPES\.ROOT_REQUESTED/u.test(read(file)) &&
          !file.includes("/legacy-migration/"),
      )
      .map((file) => path.relative(apiSrc, file))
      .sort();
    expect(rootStarters).toEqual(
      [
        // customer completes repository setup (PREPARING -> ACTIVE)
        "modules/assessment/application/services/assessment-runtime-preparation.service.ts",
        // customer answers a human request (WAITING -> ACTIVE)
        "modules/assessment/application/commands/answer-human-request/answer-human-request.handler.ts",
        // customer / admin runtime control (resume)
        "platform/runtime-events/assessment-runtime-control.service.ts",
      ].sort(),
    );
  });
});
