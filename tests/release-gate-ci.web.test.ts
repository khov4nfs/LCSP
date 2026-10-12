import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/test.yml", "utf8");

const requiredReleaseGateCommands = [
  "pnpm run typecheck",
  "pnpm run check:imports",
  "pnpm run check:contracts",
  "pnpm run check:legal-v1-retired",
  "pnpm --filter @lcsp/web lint",
  "pnpm --filter @lcsp/web build",
  "pnpm run test:web",
] as const;

const requiredReleaseGateJobs = [
  "changes",
  "release-gate-static",
  "web-production-build",
  "api-unit",
  "api-e2e",
  "web",
  "python",
  "docker-sandbox-e2e",
  "assessment-domain-vertical",
  "admin-playwright-e2e",
] as const;

test("release gate keeps static and canonical Web CI coverage", () => {
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s+\["\*\*"\]/);
  assert.match(workflow, /push:\s*\n\s+branches:\s+\[main, develop\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /release_gate:\s*\$\{\{\s*steps\.filter\.outputs\.release_gate\s*\}\}/,
  );
  assert.match(workflow, /release-gate-static:/);
  assert.match(workflow, /web-production-build:/);
  assert.doesNotMatch(workflow, /frozen\/interview-agent-frozen/);

  for (const command of requiredReleaseGateCommands) {
    assert.match(workflow, new RegExp(`run:\\s*${escapeRegExp(command)}`));
  }
});

test("V2 release gate requires every applicable canonical suite", () => {
  assertCanonicalReleaseGate(workflow);
});

test("V2 release gate refuses missing required suites or conditional aggregate execution", () => {
  for (const job of requiredReleaseGateJobs) {
    const removed = workflow.replace(
      new RegExp(`^      - ${escapeRegExp(job)}\\n`, "m"),
      "",
    );
    assert.notEqual(removed, workflow);
    assert.throws(() => assertCanonicalReleaseGate(removed));
  }
  const conditional = workflow.replace(
    /^    if: always\(\)$/m,
    "    if: success()",
  );
  assert.notEqual(conditional, workflow);
  assert.throws(() => assertCanonicalReleaseGate(conditional));
});

function assertCanonicalReleaseGate(source: string): void {
  const aggregate = source.split("\n  v2-release-gate:\n")[1];
  assert.ok(aggregate, "V2 aggregate release gate must exist");
  assert.match(aggregate, /^    if: always\(\)$/m);
  const needs = aggregate.match(
    /^    needs:\n((?:      - [a-z][a-z0-9-]*\n)+)/m,
  )?.[1];
  assert.ok(needs, "V2 aggregate must declare required suites");
  for (const job of requiredReleaseGateJobs) {
    assert.match(needs, new RegExp(`^      - ${escapeRegExp(job)}$`, "m"));
  }
  assert.match(aggregate, /assert not failed/);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
