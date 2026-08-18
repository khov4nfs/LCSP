import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workerRoot = path.join(repoRoot, "lcsp-python-workers");
const workerPython = path.join(workerRoot, ".venv", "bin", "python");
const rootEnv = loadDotEnv(path.join(repoRoot, ".env"));
const defaultWorkerRuntimeVersion =
  process.env.WORKER_RUNTIME_VERSION ??
  rootEnv.WORKER_RUNTIME_VERSION ??
  "2026.08.13";
const defaultWorkerRuntimeBuildRef =
  process.env.WORKER_RUNTIME_BUILD_REF ??
  rootEnv.WORKER_RUNTIME_BUILD_REF ??
  detectGitBuildRef();
const defaultOrchestrationDebug =
  process.env.ORCHESTRATION_DEBUG ?? rootEnv.ORCHESTRATION_DEBUG ?? "false";

const targets = {
  proxy: {
    cwd: repoRoot,
    cmd: "bash",
    args: ["./fogewise-dev-launchers/fedora/fogewise-dev-fedora.sh"],
    env: { FOGEWISE_SUBDOMAIN: "lcsp" },
    description: "Start Fogewise Fedora local proxy (hosts override + Caddy)",
  },
  proxy_reset: {
    cwd: repoRoot,
    cmd: "bash",
    args: ["./fogewise-dev-launchers/fedora/fogewise-local-reset-fedora.sh"],
    description:
      "Reset Fogewise Fedora local proxy (remove hosts override + stop Caddy)",
    oneshot: true,
  },
  infra: {
    cwd: repoRoot,
    cmd: "bash",
    args: ["./fogewise-dev-launchers/fedora/fogewise-local-infra-fedora.sh"],
    description: "Start local RabbitMQ + Redis for Fedora",
    oneshot: true,
  },
  infra_reset: {
    cwd: repoRoot,
    cmd: "bash",
    args: ["./fogewise-dev-launchers/fedora/fogewise-local-infra-reset-fedora.sh"],
    description: "Reset local RabbitMQ + Redis for Fedora",
    oneshot: true,
  },
  api: {
    cwd: repoRoot,
    cmd: "pnpm",
    args: ["--dir", "apps/api", "start:dev"],
    env: rootEnv,
    description: "Start NestJS API in watch mode",
  },
  web: {
    cwd: repoRoot,
    cmd: "pnpm",
    args: ["--dir", "apps/web", "dev"],
    env: {
      ...rootEnv,
      PORT: rootEnv.NEXT_PORT ?? "3000",
    },
    description: "Start Next.js web app in dev mode",
  },
  scanner: workerTarget(
    "lcsp_workers.scanner.scan_consumer:ScanConsumer",
    "Start scanner worker",
    18081,
  ),
  engineering_assessment: workerTarget(
    "lcsp_workers.investigation.engineering_assessment_consumer:EngineeringAssessmentConsumer",
    "Start direct EngineeringRule assessment worker",
    18082,
  ),
  gap_analysis: workerTarget(
    "lcsp_workers.reporting.gap_analysis_consumer:GapAnalysisConsumer",
    "Start gap analysis worker",
    18088,
  ),
  legal_corpus_recovery: workerTarget(
    "lcsp_workers.legal.legal_corpus_recovery_consumer:LegalCorpusRecoveryConsumer",
    "Start legal corpus recovery worker",
    18089,
  ),
  targeted_reanalysis: workerTarget(
    "lcsp_workers.scanner.targeted_reanalysis_consumer:TargetedReanalysisConsumer",
    "Start targeted reanalysis worker",
    18090,
  ),
  final_report: workerTarget(
    "lcsp_workers.reporting.final_report_consumer:FinalReportConsumer",
    "Start final report worker",
    18091,
  ),
};

const groups = {
  fogewise: ["proxy", "infra"],
  fogewise_reset: ["proxy_reset", "infra_reset"],
  dev: [
    "api",
    "web",
    "scanner",
    "engineering_assessment",
    "gap_analysis",
    "legal_corpus_recovery",
    "targeted_reanalysis",
    "final_report",
  ],
};

const selection = process.argv[2] ?? "help";
await main();

async function main() {
  if (selection === "help" || selection === "--help" || selection === "-h") {
    printHelp();
    process.exit(0);
  }

  if (selection === "list") {
    printList();
    process.exit(0);
  }

  if (selection === "dev_stop") {
    stopDevProcesses();
    process.exit(0);
  }

  if (selection in groups) {
    await runGroup(selection);
    return;
  }

  if (selection in targets) {
    runTarget(selection);
    return;
  }

  console.error(`[run] Unknown target: ${selection}`);
  printHelp();
  process.exit(1);
}

function workerTarget(target, description, healthPort) {
  return {
    cwd: workerRoot,
    cmd: workerPython,
    args: ["-m", "lcsp_workers.runtime", target],
    env: {
      ...rootEnv,
      PYTHONPATH: "src",
      HEALTH_PORT: String(healthPort),
      WORKER_RUNTIME_VERSION: defaultWorkerRuntimeVersion,
      WORKER_RUNTIME_BUILD_REF: defaultWorkerRuntimeBuildRef,
      ORCHESTRATION_DEBUG: defaultOrchestrationDebug,
    },
    description,
    healthPort,
  };
}

function detectGitBuildRef() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const value = result.status === 0 ? result.stdout?.trim() : "";
  return value ? `git:${value}` : "local";
}

function stopDevProcesses() {
  const patterns = [
    "lcsp_workers.runtime",
    "pnpm --dir apps/api start:dev",
    "nest start --watch",
    "pnpm --dir apps/web dev",
    "next dev",
  ];
  const protectedPids = new Set([
    process.pid,
    process.ppid,
    ...listParentPids(process.pid),
  ]);
  const killed = [];

  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const pattern of patterns) {
      for (const pid of findMatchingPids(pattern, protectedPids)) {
        try {
          process.kill(pid, signal);
          killed.push({ pid, signal, pattern });
        } catch {}
      }
    }
    if (signal === "SIGTERM") sleepMs(750);
  }

  if (killed.length === 0) {
    console.log("[run] No matching local LCSP dev processes were running.");
    return;
  }

  console.log("[run] Stopped local LCSP dev processes:");
  for (const entry of killed) {
    console.log(
      `  - pid=${entry.pid} signal=${entry.signal} pattern=${entry.pattern}`,
    );
  }
}

function findMatchingPids(pattern, protectedPids) {
  const result = spawnSync(
    "bash",
    ["-lc", `ps -eo pid=,args= | grep -F ${shellQuote(pattern)} | grep -v grep`],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];

  const pids = [];
  for (const line of result.stdout.split("\n")) {
    const pid = Number.parseInt(line.trim().split(/\s+/, 1)[0], 10);
    if (Number.isInteger(pid) && pid > 0 && !protectedPids.has(pid)) {
      pids.push(pid);
    }
  }
  return [...new Set(pids)];
}

function listParentPids(startPid) {
  const result = [];
  let currentPid = startPid;
  for (;;) {
    const parentPid = readParentPid(currentPid);
    if (!parentPid || result.includes(parentPid)) break;
    result.push(parentPid);
    currentPid = parentPid;
  }
  return result;
}

function readParentPid(pid) {
  const result = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const value = Number.parseInt(result.stdout.trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function sleepMs(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function logWorkerRuntimeBanner(name, target) {
  if (target.cmd !== workerPython) return;
  console.log(
    `[run] Worker runtime -> name=${name} health_port=${target.env?.HEALTH_PORT ?? "unknown"} version=${target.env?.WORKER_RUNTIME_VERSION ?? defaultWorkerRuntimeVersion} build_ref=${target.env?.WORKER_RUNTIME_BUILD_REF ?? defaultWorkerRuntimeBuildRef}`,
  );
}

function runTarget(name) {
  const target = targets[name];
  assertWorkerPython(target);
  logWorkerRuntimeBanner(name, target);
  console.log(`[run] Starting ${name}: ${target.description}`);
  const child = spawnTarget(target);

  if (target.oneshot) {
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
    return;
  }

  forwardSignals([child]);
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

async function runGroup(name) {
  const members = groups[name];
  const children = [];
  const longRunningMembers = [];

  for (const member of members) {
    const target = targets[member];
    assertWorkerPython(target);
    if (target.oneshot) {
      console.log(`[run] Running ${member}: ${target.description}`);
      const status = spawnSyncCompatible(target);
      if (status !== 0) process.exit(status);
    } else {
      longRunningMembers.push(member);
    }
  }

  assertPortsAvailable(longRunningMembers);

  if (members.includes("infra") && hasWorkerMember(longRunningMembers)) {
    console.log("[run] Waiting for local RabbitMQ and Redis to accept connections...");
    await waitForPort("127.0.0.1", 5672, "RabbitMQ");
    await waitForPort("127.0.0.1", 6379, "Redis");
  }

  for (const member of longRunningMembers) {
    const target = targets[member];
    logWorkerRuntimeBanner(member, target);
    console.log(`[run] Starting ${member}: ${target.description}`);
    children.push(spawnTarget(target));
  }

  forwardSignals(children);
  let exiting = false;
  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (exiting) return;
      exiting = true;
      if ((code ?? 0) !== 0) {
        console.error(
          `[run] A process exited with code ${code}. Stopping remaining processes.`,
        );
      }
      shutdown(children);
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
  }
}

function assertWorkerPython(target) {
  if (target.cmd === workerPython && !existsSync(workerPython)) {
    console.error(
      `[run] Missing worker virtualenv python at ${workerPython}. Create/sync lcsp-python-workers/.venv first.`,
    );
    process.exit(1);
  }
}

function spawnTarget(target) {
  return spawn(target.cmd, target.args, {
    cwd: target.cwd,
    env: { ...process.env, ...target.env },
    stdio: "inherit",
  });
}

function assertPortsAvailable(members) {
  const conflicts = [];
  for (const member of members) {
    const target = targets[member];
    if (!target?.healthPort) continue;
    const owner = describeListeningPort(target.healthPort);
    if (owner) conflicts.push({ member, port: target.healthPort, owner });
  }
  if (conflicts.length === 0) return;

  console.error("[run] Cannot start dev group because required ports are already in use:");
  for (const conflict of conflicts) {
    console.error(
      `  - target=${conflict.member} health_port=${conflict.port} owner=${conflict.owner}`,
    );
  }
  console.error("[run] Run `pnpm dev:stop`, then re-run `pnpm dev`.");
  process.exit(1);
}

function describeListeningPort(port) {
  const result = spawnSync("bash", ["-lc", `ss -ltnp | grep ':${port}\\b'`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean) ?? null;
}

function spawnSyncCompatible(target) {
  const result = spawnSync(target.cmd, target.args, {
    cwd: target.cwd,
    env: { ...process.env, ...target.env },
    stdio: "inherit",
  });
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return result.status ?? 0;
}

function shutdown(children) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

function hasWorkerMember(members) {
  return members.some((member) => targets[member]?.cmd === workerPython);
}

function waitForPort(host, port, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const retryOrFail = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            `${label} did not become ready on ${host}:${port} within ${timeoutMs}ms`,
          ),
        );
        return;
      }
      setTimeout(tryConnect, 500);
    };

    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(1_000);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("timeout", () => {
        socket.destroy();
        retryOrFail();
      });
      socket.once("error", () => {
        socket.destroy();
        retryOrFail();
      });
      socket.connect(port, host);
    };

    tryConnect();
  });
}

function forwardSignals(children) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(children));
  }
}

function printList() {
  console.log("Groups:");
  for (const [name, members] of Object.entries(groups)) {
    console.log(`- ${name}: ${members.join(", ")}`);
  }
}

function printHelp() {
  console.log(`Usage:\n\n  node scripts/run.mjs <target>\n\nTargets:\n  fogewise\n  fogewise_reset\n  dev_stop\n  dev\n\nExamples:\n  pnpm run dev:fogewise\n  pnpm run dev:fogewise:reset\n  pnpm run dev:stop\n  pnpm run dev\n`);
}
