// Runs only fixture Python and SQLite recovery; never starts an API or a provider.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { root, runPython } from "./support/compliance-rule-set-stack.mjs";

test("bounded worker timeout recovers committed usage through the terminal-report CLI", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lcsp-usage-timeout-"));
  const usageFile = path.join(dir, "usage.json");
  const fixture = path.join(dir, "fixture.py");
  writeFileSync(fixture, `
import sys, time
from types import SimpleNamespace
from vertical.live_preparation import LiveUsage
state = LiveUsage("timeout-fixture", sys.argv[1])
model = SimpleNamespace(provider="apx", protocol="anthropic", model_name="timeout-model")
for role in ["rule-set-preparation", "legal-semantic-auditor"]:
    state.record(SimpleNamespace(usage_metadata={"input_tokens": 9, "output_tokens": 4}), model, role, agent_role=role)
time.sleep(60)
`);
  await assert.rejects(runPython(fixture, [usageFile], {
    timeoutMs: 8000,
    env: { PYTHONPATH: [path.join(root, "deepagents"), path.join(root, "deepagents/tests")].join(":") },
  }), /signal=SIGKILL budgetMs=8000/);
  const cli = path.join(root, "deepagents/tests/vertical/live_preparation.py");
  const recovered = await runPython(cli, ["--recover-usage", usageFile, "timeout-fixture"]);
  assert.equal(recovered.modelCalls, 2);
  assert.equal(recovered.inputTokens, 18);
  assert.equal(recovered.outputTokens, 8);
  assert.deepEqual(JSON.parse(readFileSync(usageFile, "utf8")), recovered);
  const repeated = await runPython(cli, ["--recover-usage", usageFile, "timeout-fixture"]);
  assert.deepEqual(repeated.invocations, recovered.invocations);
  assert.equal(repeated.modelCalls, 2);
});
