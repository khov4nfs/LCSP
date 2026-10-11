import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "@jest/globals";

/**
 * Architecture proof: Rule Set Preparation is platform-owned. A validated Legal Source Version
 * activation starts it (through the durable event, the consumer and the CommandBus); an assessment
 * only ever pins an existing ACTIVE rule set and never builds, retries or waits on a preparation.
 */
const SRC = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/u.test(entry.name) && !/\.spec\.ts$/u.test(entry.name)
      ? [path]
      : [];
  });
}

const relativePaths = (files: string[]) =>
  files.map((file) => relative(SRC, file)).sort();
const withMatch = (files: string[], pattern: RegExp) =>
  relativePaths(files.filter((file) => pattern.test(readFileSync(file, "utf8"))));

const START_API =
  /StartRuleSetPreparation|RetryRuleSetPreparation|ruleSetPreparationRun|RuleSetPreparationRun|ruleSetPreparationIdempotencyKey|RULE_SET_PREPARATION_/u;

describe("Rule Set Preparation ownership", () => {
  it("is never started, retried or read by any assessment production path", () => {
    const assessmentPaths = [
      join(SRC, "modules", "assessment"),
      join(SRC, "platform", "runtime-events"),
    ].flatMap(sourceFiles);
    expect(assessmentPaths.length).toBeGreaterThan(20);
    expect(withMatch(assessmentPaths, START_API)).toEqual([]);
    expect(
      withMatch(assessmentPaths, /compliance-rule-set\/application\/commands/u),
    ).toEqual([]);
  });

  it("is started only by the Legal Source activation consumer and the explicit operator retry", () => {
    const all = sourceFiles(SRC);
    expect(withMatch(all, /new StartRuleSetPreparationCommand\(/u)).toEqual([
      "modules/compliance-rule-set/application/commands/retry-rule-set-preparation/retry-rule-set-preparation.handler.ts",
      "modules/compliance-rule-set/infrastructure/messaging/legal-source-activated.consumer.ts",
    ]);
  });

  it("is never invoked directly by the Legal Source lifecycle, only through its outbox event", () => {
    const catalog = sourceFiles(join(SRC, "modules", "legal-rule-catalog"));
    expect(withMatch(catalog, /compliance-rule-set|RuleSetPreparation/u)).toEqual(
      [],
    );
  });

  it("exposes no HTTP route that starts a preparation", () => {
    const controllers = sourceFiles(
      join(SRC, "modules", "compliance-rule-set", "presentation"),
    );
    expect(withMatch(controllers, /StartRuleSetPreparationCommand/u)).toEqual([]);
    const routes = JSON.parse(
      readFileSync(join(SRC, "app.routes.allowlist.json"), "utf8"),
    ) as string[] | { routes?: string[] };
    const list = Array.isArray(routes) ? routes : (routes.routes ?? []);
    expect(
      list.filter((route) => /compliance-rule-set.*\/preparations$/u.test(route)),
    ).toEqual([]);
  });

  it("keeps the consumer free of persistence", () => {
    const consumer = readFileSync(
      join(
        SRC,
        "modules/compliance-rule-set/infrastructure/messaging/legal-source-activated.consumer.ts",
      ),
      "utf8",
    );
    expect(consumer).not.toMatch(/PrismaService|prisma\./u);
  });
});
