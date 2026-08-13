import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workerRoot = path.join(repoRoot, "lcsp-python-workers");
const workerPython = path.join(workerRoot, ".venv", "bin", "python");

const targets = {
  proxy: {
    cwd: repoRoot,
    cmd: "bash",
    args: ["./fogewise-dev-launchers/fedora/fogewise-dev-fedora.sh"],
    env: {
      FOGEWISE_SUBDOMAIN: "lcsp",
    },
    description: "Start Fogewise Fedora local proxy (hosts override + Caddy)",
  },
  proxy_reset: {
    cwd: repoRoot,
    cmd: "bash",
    args: ["./fogewise-dev-launchers/fedora/fogewise-local-reset-fedora.sh"],
    description: "Reset Fogewise Fedora local proxy (remove hosts override + stop Caddy)",
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
    description: "Start NestJS API in watch mode",
  },
  web: {
    cwd: repoRoot,
    cmd: "pnpm",
    args: ["--dir", "apps/web", "dev"],
    description: "Start Next.js web app in dev mode",
  },
  scanner: workerTarget(
    "lcsp_workers.scanner.scan_consumer:ScanConsumer",
    "Start scanner worker",
    18081,
  ),
  technical_profile: workerTarget(
    "lcsp_workers.intelligence.technical_profile_consumer:TechnicalProfileConsumer",
    "Start technical profile worker",
    18082,
  ),
  ai_usage_flow: workerTarget(
    "lcsp_workers.intelligence.ai_usage_flow_consumer:AIUsageFlowConsumer",
    "Start AI usage flow worker",
    18083,
  ),
  conflict_detection: workerTarget(
    "lcsp_workers.intelligence.conflict_detection_consumer:ConflictDetectionConsumer",
    "Start conflict detection worker",
    18084,
  ),
  verified_profile: workerTarget(
    "lcsp_workers.intelligence.verified_profile_consumer:VerifiedProfileConsumer",
    "Start verified profile worker",
    18085,
  ),
  legal_retrieval: workerTarget(
    "lcsp_workers.legal.legal_retrieval_consumer:LegalRetrievalConsumer",
    "Start legal retrieval worker",
    18086,
  ),
  classification: workerTarget(
    "lcsp_workers.classification.classification_consumer:ClassificationConsumer",
    "Start classification worker",
    18087,
  ),
  gap_analysis: workerTarget(
    "lcsp_workers.reporting.gap_analysis_consumer:GapAnalysisConsumer",
    "Start gap analysis worker",
    18088,
  ),
};

const groups = {
  min: ["infra", "api", "web", "scanner", "technical_profile", "ai_usage_flow"],
  local: [
    "proxy",
    "infra",
    "api",
    "web",
    "scanner",
    "technical_profile",
    "ai_usage_flow",
  ],
  local_full: [
    "proxy",
    "infra",
    "api",
    "web",
    "scanner",
    "technical_profile",
    "ai_usage_flow",
    "conflict_detection",
    "verified_profile",
    "legal_retrieval",
    "classification",
    "gap_analysis",
  ],
  all: [
    "proxy",
    "infra",
    "api",
    "web",
    "scanner",
    "technical_profile",
    "ai_usage_flow",
    "conflict_detection",
    "verified_profile",
    "legal_retrieval",
    "classification",
    "gap_analysis",
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

  if (selection === "stop") {
    runStop();
    process.exit(0);
  }

  if (selection === "all") {
    console.warn("[run] 'all' is kept as a legacy alias. Prefer 'local_full' / 'pnpm run dev:local:full'.");
  }

  if (selection in groups) {
    await runGroup(selection);
  } else if (selection in targets) {
    runTarget(selection);
  } else {
    console.error(`[run] Unknown target: ${selection}`);
    printHelp();
    process.exit(1);
  }
}

function workerTarget(target, description, healthPort) {
  return {
    cwd: workerRoot,
    cmd: workerPython,
    args: ["-m", "lcsp_workers.runtime", target],
    env: {
      PYTHONPATH: "src",
      HEALTH_PORT: String(healthPort),
    },
    description,
  };
}

function runTarget(name) {
  const target = targets[name];
  if (!target) {
    throw new Error(`Unknown target: ${name}`);
  }

  if (target.cmd === workerPython && !existsSync(workerPython)) {
    console.error(
      `[run] Missing worker virtualenv python at ${workerPython}. Create/sync lcsp-python-workers/.venv first.`,
    );
    process.exit(1);
  }

  console.log(`[run] Starting ${name}: ${target.description}`);
  const child = spawn(target.cmd, target.args, {
    cwd: target.cwd,
    env: { ...process.env, ...target.env },
    stdio: "inherit",
  });

  if (target.oneshot) {
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    });
    return;
  }

  forwardSignals([child]);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function runGroup(name) {
  const members = groups[name];
  const children = [];
  const longRunningMembers = [];

  for (const member of members) {
    const target = targets[member];
    if (target.cmd === workerPython && !existsSync(workerPython)) {
      console.error(
        `[run] Missing worker virtualenv python at ${workerPython}. Create/sync lcsp-python-workers/.venv first.`,
      );
      shutdown(children);
      process.exit(1);
    }

    if (target.oneshot) {
      console.log(`[run] Running ${member}: ${target.description}`);
      const status = spawnSyncCompatible(target);
      if (status !== 0) {
        process.exit(status);
      }
      continue;
    }

    longRunningMembers.push(member);
  }

  if (members.includes("infra") && hasWorkerMember(longRunningMembers)) {
    console.log("[run] Waiting for local RabbitMQ and Redis to accept connections...");
    await waitForPort("127.0.0.1", 5672, "RabbitMQ");
    await waitForPort("127.0.0.1", 6379, "Redis");
  }

  for (const member of longRunningMembers) {
    const target = targets[member];
    console.log(`[run] Starting ${member}: ${target.description}`);
    const child = spawn(target.cmd, target.args, {
      cwd: target.cwd,
      env: { ...process.env, ...target.env },
      stdio: "inherit",
    });
    children.push(child);
  }

  forwardSignals(children);

  let exiting = false;
  for (const child of children) {
    child.on("exit", (code, signal) => {
      if (exiting) return;
      exiting = true;
      if (signal) {
        shutdown(children);
        process.kill(process.pid, signal);
        return;
      }
      if ((code ?? 0) !== 0) {
        console.error(`[run] A process exited with code ${code}. Stopping remaining processes.`);
      }
      shutdown(children);
      process.exit(code ?? 0);
    });
  }
}

function runStop() {
  const stopTargets = ["proxy_reset", "infra_reset"];
  for (const name of stopTargets) {
    const target = targets[name];
    console.log(`[run] Running ${name}: ${target.description}`);
    const child = spawnSyncCompatible(target);
    if (child !== 0) {
      process.exit(child);
    }
  }
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
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

function hasWorkerMember(members) {
  return members.some((member) => targets[member]?.cmd === workerPython);
}

function waitForPort(host, port, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
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

    const retryOrFail = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`${label} did not become ready on ${host}:${port} within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tryConnect, 500);
    };

    tryConnect();
  });
}

function forwardSignals(children) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      shutdown(children);
    });
  }
}

function printList() {
  console.log("Targets:");
  for (const [name, target] of Object.entries(targets)) {
    console.log(`- ${name}: ${target.description}`);
  }
  console.log("\nGroups:");
  for (const [name, members] of Object.entries(groups)) {
    if (name === "all") {
      console.log(`- ${name}: legacy alias of local_full (${members.join(", ")})`);
      continue;
    }
    console.log(`- ${name}: ${members.join(", ")}`);
  }
}

function printHelp() {
  console.log(`Usage:

  node scripts/run.mjs <target>

Targets:
  list
  proxy
  proxy_reset
  infra
  infra_reset
  stop
  api
  web
  scanner
  technical_profile
  ai_usage_flow
  conflict_detection
  verified_profile
  legal_retrieval
  classification
  gap_analysis
  min
  local
  local_full
  all (legacy alias of local_full)

Examples:
  node scripts/run.mjs proxy
  node scripts/run.mjs proxy_reset
  node scripts/run.mjs infra
  node scripts/run.mjs infra_reset
  node scripts/run.mjs stop
  node scripts/run.mjs api
  node scripts/run.mjs scanner
  node scripts/run.mjs min
  node scripts/run.mjs local
  node scripts/run.mjs local_full
  node scripts/run.mjs all  # legacy alias
`);
}
