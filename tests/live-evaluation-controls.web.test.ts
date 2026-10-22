import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createLiveEvaluationControls } from "./support/live-evaluation-controls.mjs";
import { runPython } from "./support/compliance-rule-set-stack.mjs";

test("global and cumulative stage deadlines abort without stage-reset bypass", async () => {
  const controls = createLiveEvaluationControls({
    overallMs: 1000,
    stageLimits: { A: 30, B: 100 },
    now: Date.now,
  });
  controls.enter("A");
  await new Promise((r) => setTimeout(r, 20));
  controls.enter("B");
  controls.enter("A");
  await new Promise((r) =>
    controls.signal.addEventListener("abort", r, { once: true }),
  );
  assert.match(String(controls.signal.reason), /STAGE_DEADLINE:A/);
  controls.close();
  const global = createLiveEvaluationControls({ overallMs: 20 });
  await new Promise((r) =>
    global.signal.addEventListener("abort", r, { once: true }),
  );
  assert.match(String(global.signal.reason), /GLOBAL_DEADLINE/);
  global.close();
});
test("supervised worker kills its owned process group before recovery", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lcsp360-deadline-"));
  const script = path.join(dir, "tree.py"),
    receipt = path.join(dir, "pids.json");
  writeFileSync(
    script,
    `import json,os,subprocess,sys,time
p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
open(sys.argv[1],'w').write(json.dumps({'parent':os.getpid(),'child':p.pid}))
time.sleep(60)
`,
  );
  await assert.rejects(
    runPython(script, [receipt], {
      timeoutMs: 500,
      ownedProcessGroup: true,
      executable: "python3",
    }),
    /Worker deadline/,
  );
  const ids = JSON.parse(readFileSync(receipt, "utf8"));
  for (const id of Object.values(ids) as number[]) {
    let state = "gone";
    try {
      state = readFileSync(`/proc/${id}/stat`, "utf8").split(" ")[2]!;
    } catch {}
    assert.ok(
      state === "gone" || state === "Z",
      `owned process ${id} still running`,
    );
  }
});

test("live entrypoint rejects missing frozen authorization context before database or provider work", () => {
  const env = { ...process.env };
  delete env.LCSP_LIVE_CANDIDATE_SHA;
  const result = spawnSync(
    process.execPath,
    ["tests/compliance-rule-set-live-eval.mjs"],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env,
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Exact frozen candidate must be supplied/);
});
