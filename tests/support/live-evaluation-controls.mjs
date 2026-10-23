// Runtime supervision only: neither this helper nor a budget file authorizes provider usage.
import assert from "node:assert/strict";
import { CLAIM_PREPARATION_PHASES as P } from "@lcsp/contracts/compliance-rule-set";
import { readFileSync, statfsSync } from "node:fs";
import { execFileSync } from "node:child_process";
export function verifyFrozenCandidate(root, candidateSha) {
  assert.match(candidateSha ?? "", /^[a-f0-9]{40}$/, "Exact frozen candidate must be supplied");
  const git = args => execFileSync("git", args, {cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const publicationSha = git(["rev-parse","HEAD"]);
  git(["merge-base","--is-ancestor",candidateSha,publicationSha]);
  // Evidence publication may advance HEAD; every tracked non-report byte must stay frozen.
  git(["diff","--exit-code",candidateSha,"--",".",":(exclude)reports"]);
  return {candidateSha,publicationSha};
}
export const LIVE_STAGE_LIMITS_MS = {
  PROVISION: 120000, MATERIALIZE: 120000, DISCOVERY_AUDIT: 2400000,
  INVENTORY_FREEZE: 180000, AUTHOR_VALIDATE: 720000, PERSIST_ACTIVATE: 180000, INDEPENDENT_VERIFY: 300000,
};
export function verifyLiveEvaluationAuthorization(approval, budget, context) {
  assert.equal(approval.candidateSha, context.candidateSha);
  assert.equal(approval.runId, context.runId);
  assert.equal(budget.run_id, context.runId);
  assert.equal(budget.candidate_sha, context.candidateSha);
  assert.equal(approval.paidInferenceApproved, true);
  assert.ok(typeof approval.approvalReference === "string" && approval.approvalReference.length > 0);
  const unrestricted = approval.mode === "UNRESTRICTED";
  if (unrestricted) {
    assert.equal(budget.schema_version, 4);
    assert.equal(budget.mode, "UNRESTRICTED");
    assert.equal(budget.paid_inference_approved, true);
    assert.equal(budget.approval_reference, approval.approvalReference);
    for (const field of ["maximum_calls", "maximum_input_tokens", "maximum_output_tokens", "maximum_charge_nano_usd", "expires_at"])
      assert.ok(budget[field] == null, "Unrestricted authorization cannot contain aggregate ceilings");
    for (const field of ["maximum_calls", "maximum_input_tokens", "maximum_output_tokens", "maximum_charge_nano_usd", "evaluationCount", "workerTimeoutMs", "overallTimeoutMs"])
      assert.ok(approval[field] == null, "Unrestricted approval cannot contain acceptance ceilings");
  } else {
    assert.ok(approval.mode === undefined || approval.mode === "BOUNDED", "Unknown evaluation authorization mode");
    assert.equal(approval.evaluationCount, 1);
    assert.ok([2, 3].includes(budget.schema_version));
    for (const field of ["maximum_calls", "maximum_input_tokens", "maximum_output_tokens"])
      assert.ok(Number.isSafeInteger(approval[field]) && approval[field] > 0 && budget[field] <= approval[field], "Budget exceeds approved limits");
    if (approval.maximum_charge_nano_usd !== undefined) {
      assert.equal(budget.schema_version, 2, "An actual financial cap requires strict verified charging enforcement");
      assert.ok(budget.maximum_charge_nano_usd <= approval.maximum_charge_nano_usd);
    }
    for (const field of ["workerTimeoutMs", "providerTimeoutSeconds", "overallTimeoutMs"])
      assert.ok(Number.isSafeInteger(approval[field]) && context[field] <= approval[field], "Deadline exceeds approved limits");
  }
  return { unrestricted };
}

/** @param {{overallMs?:number, stageLimits?:Record<string,number>, now?:()=>number, unrestricted?:boolean}} [options] */
export function createLiveEvaluationControls({ overallMs = 4200000, stageLimits = LIVE_STAGE_LIMITS_MS, now = Date.now, unrestricted = false } = {}) {
  if (!unrestricted) assert.ok(Number.isSafeInteger(overallMs) && overallMs > 0,"Invalid overall deadline");
  const controller = new AbortController(), elapsed = new Map();
  let stage, entered, timer;
  const abort = reason => controller.abort(new Error(reason));
  const overall = unrestricted ? undefined : setTimeout(() => abort("GLOBAL_DEADLINE"), overallMs);
  const enter = next => {
    controller.signal.throwIfAborted();
    if (stage === next) return;
    assert.ok(stageLimits[next] > 0, "Unknown bounded evaluation stage");
    if (unrestricted) { stage = next; return; }
    if (stage) elapsed.set(stage, (elapsed.get(stage) ?? 0) + now() - entered);
    stage = next; entered = now(); clearTimeout(timer);
    const remaining = stageLimits[next] - (elapsed.get(next) ?? 0);
    if (remaining <= 0) abort(`STAGE_DEADLINE:${next}`);
    else timer = setTimeout(() => abort(`STAGE_DEADLINE:${next}`), remaining);
  };
  const phase = value => {
    if (!Object.values(P).includes(value)) return abort("UNKNOWN_WORKFLOW_PHASE");
    enter(value === P.CLAIM_DISCOVERY ? "DISCOVERY_AUDIT" :
      [P.CLAIM_INVENTORY_VALIDATION, P.CLAIM_INVENTORY_READY].includes(value) ? "INVENTORY_FREEZE" :
      value === P.COMPLETION ? "PERSIST_ACTIVATE" : "AUTHOR_VALIDATE");
  };
  return { signal: controller.signal, enter, phase, abort,
    checkDisk(root, minimumBytes = 4 * 1024 ** 3) {
      const fs = statfsSync(root); if (fs.bavail * fs.bsize < minimumBytes) abort("DISK_HEADROOM");
      controller.signal.throwIfAborted();
    },
    close() { clearTimeout(timer); clearTimeout(overall); },
  };
}

export function verifyLiveResourceAdmission(root) {
  const relative = readFileSync("/proc/self/cgroup","utf8").trim().split("::")[1];
  const group = `/sys/fs/cgroup${relative}`;
  const memoryMax = Number(readFileSync(`${group}/memory.max`,"utf8").trim());
  const [quota,period] = readFileSync(`${group}/cpu.max`,"utf8").trim().split(/\s+/).map(Number);
  assert.ok(Number.isFinite(memoryMax) && memoryMax <= 3*1024**3,"Live process tree requires a <=3 GiB cgroup");
  assert.ok(Number.isFinite(quota) && quota/period <= 2,"Live process tree requires a <=200% CPU cgroup");
  const available = Number(readFileSync("/proc/meminfo","utf8").match(/^MemAvailable:\s+(\d+)/m)?.[1])*1024;
  assert.ok(available >= 3*1024**3 + 256*1024**2 + 1024**3,"Insufficient memory headroom");
  const fs=statfsSync(root),freeDisk=fs.bavail*fs.bsize;
  assert.ok(freeDisk >= 8*1024**3,"Insufficient evaluation disk headroom");
  return {memoryMaxBytes:memoryMax,cpuCores:quota/period,availableMemoryBytes:available,freeDiskBytes:freeDisk};
}
