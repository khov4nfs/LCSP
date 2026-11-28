import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/test.yml", "utf8").replace(
  /\r\n/g,
  "\n",
);

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

const releaseImageInputs = [
  "deepagents-langgraph/Dockerfile*",
  "tests/release-images.py",
  "tests/test_release_docker_context.py",
  "deepagents/tests/integration/test_codebase_memory_runtime_e2e.py",
  "deepagents/tests/integration/test_docker_sandbox_e2e.py",
  "deepagents/tests/integration/test_local_agent_runtime_e2e.py",
  "deepagents/tests/integration/test_production_agent_server_image_e2e.py",
  "deepagents/tests/integration/test_repository_scanner_docker_e2e.py",
  "deepagents/tests/test_repository_workspace_archives.py",
  "deepagents/tests/test_snapshot_service_client.py",
  "deepagents/tools/common/capabilities/platform/docker_sandbox.py",
  "deepagents/tools/common/capabilities/platform/repository_sandbox.py",
  "deepagents/tools/common/capabilities/platform/repository_workspace.py",
  "deepagents/tools/common/capabilities/platform/repository_snapshot_client.py",
  "deepagents/tools/common/capabilities/agent_runtime/agent_server_client.py",
  "deepagents/tools/common/capabilities/agent_runtime/local_server.py",
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

test("Docker E2E watches release-image suites and archive runtime contracts", () => {
  // The candidate runner executes these five integration modules against four images;
  // their direct inputs must schedule Docker verification on PRs that change them.
  const dockerFilter = workflow.match(
    /^            docker:\n([\s\S]*?)(?=^            windows:)/m,
  )?.[1];
  assert.ok(dockerFilter, "Docker path filter must remain present");

  for (const path of releaseImageInputs) {
    assert.match(
      dockerFilter,
      new RegExp(`^\\s+- '${escapeRegExp(path)}'\\s*$`, "m"),
      `${path} must trigger Docker candidate verification`,
    );
  }
  assert.doesNotMatch(dockerFilter, /'deepagents\/\*\*'/);
  assert.doesNotMatch(dockerFilter, /'\.github\/workflows\/test\.yml'/);
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
