import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/test.yml", "utf8");

const requiredReleaseGateCommands = [
  "pnpm run typecheck",
  "pnpm run check:imports",
  "pnpm run check:contracts",
  "pnpm --filter @lcsp/web lint",
  "pnpm --filter @lcsp/web build",
  "pnpm run test:web",
] as const;

test("LCSP-278 release gate keeps static, web, and frozen spec CI coverage", () => {
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s+\["\*\*"\]/);
  assert.match(workflow, /push:\s*\n\s+branches:\s+\[develop\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release_gate:\s*\$\{\{\s*steps\.filter\.outputs\.release_gate\s*\}\}/);
  assert.match(workflow, /release-gate-static:/);
  assert.match(workflow, /web-production-build:/);
  assert.match(workflow, /frozen\/interview-agent-frozen\/\*\*/);

  for (const command of requiredReleaseGateCommands) {
    assert.match(workflow, new RegExp(`run:\\s*${escapeRegExp(command)}`));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
