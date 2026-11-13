import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "@jest/globals";

/**
 * Preparation is platform-owned; the shared Agent Stream boundary may resolve a preparation run
 * identity for durable activity, but assessment lifecycle paths cannot start or read its domain data.
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
  files.map((file) => relative(SRC, file).split(sep).join("/")).sort();
const withMatch = (files: string[], pattern: RegExp) =>
  relativePaths(
    files.filter((file) => pattern.test(readFileSync(file, "utf8"))),
  );

const PREPARATION_LIFECYCLE =
  /StartRuleSetPreparation|RetryRuleSetPreparation|PrepareCurrentRuleSet|ClaimRuleSetPreparation|ruleSetPreparationIdempotencyKey|LegalSourceSnapshotLoader|ComplianceRuleSetActivation/u;

describe("Rule Set Preparation ownership", () => {
  it("is never started, retried or read by assessment paths except the shared stream boundary", () => {
    const assessmentPaths = [
      join(SRC, "modules", "assessment"),
      join(SRC, "platform", "runtime-events"),
    ].flatMap(sourceFiles);
    expect(assessmentPaths.length).toBeGreaterThan(20);
    const streamBoundary = assessmentPaths.filter((path) =>
      path.endsWith("publish-agent-stream-event.handler.ts"),
    );
    expect(streamBoundary).toHaveLength(1);
    const lifecyclePaths = assessmentPaths.filter(
      (path) => !streamBoundary.includes(path),
    );
    expect(withMatch(lifecyclePaths, PREPARATION_LIFECYCLE)).toEqual([]);
    expect(withMatch(streamBoundary, PREPARATION_LIFECYCLE)).toEqual([]);
    expect(
      withMatch(assessmentPaths, /compliance-rule-set\/application\/commands/u),
    ).toEqual([]);
  });

  it("is started only by activation, current-source Admin preparation and canonical retry", () => {
    const all = sourceFiles(SRC);
    expect(withMatch(all, /new StartRuleSetPreparationCommand\(/u)).toEqual([
      "modules/compliance-rule-set/application/commands/prepare-current-rule-set/prepare-current-rule-set.handler.ts",
      "modules/compliance-rule-set/application/commands/retry-rule-set-preparation/retry-rule-set-preparation.handler.ts",
      "modules/compliance-rule-set/infrastructure/messaging/legal-source-activated.consumer.ts",
    ]);
  });

  it("is never invoked directly by the Legal Source lifecycle, only through its outbox event", () => {
    const catalog = sourceFiles(join(SRC, "modules", "legal-source"));
    const ownedCleanupPath =
      "modules/legal-source/application/services/legal-source-deletion.service.ts";
    expect(
      withMatch(catalog, /compliance-rule-set|RuleSetPreparation/u),
    ).toEqual([ownedCleanupPath]);
    expect(
      withMatch(
        catalog,
        /StartRuleSetPreparationCommand|RetryRuleSetPreparationCommand|StartRuleSetPreparationHandler|RetryRuleSetPreparationHandler/u,
      ),
    ).toEqual([]);
    const cleanup = readFileSync(
      join(
        SRC,
        "modules",
        "legal-source",
        "application",
        "services",
        "legal-source-deletion.service.ts",
      ),
      "utf8",
    );
    expect(cleanup).toMatch(/ruleSetPreparationRun\.deleteMany/u);
    expect(cleanup).not.toMatch(
      /ruleSetPreparationRun\.(?:create|update|upsert)|new StartRuleSetPreparationCommand/u,
    );
    const activation = readFileSync(
      join(
        SRC,
        "modules",
        "legal-source",
        "application",
        "services",
        "legal-source.service.ts",
      ),
      "utf8",
    );
    expect(activation).toMatch(
      /LEGAL_SOURCE_EVENT_TYPES\.legalSourceVersionActivated/u,
    );
    expect(activation).toMatch(/outboxRepository\.enqueue/u);
  });

  it("keeps HTTP transport free of low-level preparation orchestration", () => {
    const controllers = sourceFiles(
      join(SRC, "modules", "compliance-rule-set", "presentation"),
    );
    expect(withMatch(controllers, /StartRuleSetPreparationCommand/u)).toEqual(
      [],
    );
    const routes = JSON.parse(
      readFileSync(join(SRC, "app.routes.allowlist.json"), "utf8"),
    ) as string[] | { routes?: string[] };
    const list = Array.isArray(routes) ? routes : (routes.routes ?? []);
    expect(
      list.filter((route) =>
        /compliance-rule-set.*\/preparations$/u.test(route),
      ),
    ).toEqual([]);
    expect(list).toContain("POST /admin/compliance-rule-sets/prepare");
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
