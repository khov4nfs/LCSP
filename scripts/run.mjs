import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workerRoot = path.join(repoRoot, "deepagents");
const isWindows = process.platform === "win32";
const workerPython =
  process.platform === "win32"
    ? path.join(workerRoot, ".venv", "Scripts", "python.exe")
    : path.join(workerRoot, ".venv", "bin", "python");
const openWikiRuntimeScript = path.join(
  repoRoot,
  "scripts",
  "openwiki_runtime.py",
);
const rootEnv = loadDotEnv(path.join(repoRoot, ".env"));
const defaultOrchestrationDebug =
  process.env.ORCHESTRATION_DEBUG ?? rootEnv.ORCHESTRATION_DEBUG ?? "false";
const defaultPhoenixTracing =
  process.env.PHOENIX_TRACING ?? rootEnv.PHOENIX_TRACING ?? "true";
const defaultPhoenixCollectorEndpoint =
  process.env.PHOENIX_COLLECTOR_ENDPOINT ?? "http://localhost:6006/v1/traces";
const defaultPhoenixProject =
  process.env.PHOENIX_PROJECT ??
  rootEnv.PHOENIX_PROJECT ??
  "deepagents";
const defaultDockerWorkerImage =
  process.env.LCSP_WORKER_DOCKER_IMAGE ??
  rootEnv.LCSP_WORKER_DOCKER_IMAGE ??
  "deepagents:scanner-tools";
const defaultOpenWikiRuntimeCommand =
  process.env.OPENWIKI_RUNTIME_COMMAND ??
  rootEnv.OPENWIKI_RUNTIME_COMMAND ??
  `${shellQuote(workerPython)} ${shellQuote(openWikiRuntimeScript)}`;
const defaultOpenWikiRuntimeTimeoutSeconds =
  process.env.OPENWIKI_RUNTIME_TIMEOUT_SECONDS ??
  rootEnv.OPENWIKI_RUNTIME_TIMEOUT_SECONDS ??
  "180";
const managedAgentPythonPath = ".";
const dockerManagedAgentPythonPath = "/app/deepagents";

const targets = {
  proxy: {
    cwd: repoRoot,
    cmd: isWindows ? "powershell.exe" : "bash",
    args: isWindows
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "fogewise-dev-launchers/windows/fogewise-dev-windows.ps1",
        ]
      : ["./fogewise-dev-launchers/fedora/fogewise-dev-fedora.sh"],
    env: { FOGEWISE_SUBDOMAIN: "lcsp" },
    description: "Start Fogewise Fedora local proxy (hosts override + Caddy)",
  },
  proxy_reset: {
    cwd: repoRoot,
    cmd: isWindows ? "powershell.exe" : "bash",
    args: isWindows
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "fogewise-dev-launchers/windows/fogewise-local-reset-windows.ps1",
        ]
      : ["./fogewise-dev-launchers/fedora/fogewise-local-reset-fedora.sh"],
    description:
      "Reset Fogewise Fedora local proxy (remove hosts override + stop Caddy)",
    oneshot: true,
  },
  infra: {
    cwd: repoRoot,
    cmd: isWindows ? "powershell.exe" : "bash",
    args: isWindows
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "fogewise-dev-launchers/windows/fogewise-local-infra-windows.ps1",
        ]
      : ["./fogewise-dev-launchers/fedora/fogewise-local-infra-fedora.sh"],
    description: "Start local PostgreSQL + RabbitMQ + Redis",
    oneshot: true,
  },
  infra_reset: {
    cwd: repoRoot,
    cmd: isWindows ? "powershell.exe" : "bash",
    args: isWindows
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "fogewise-dev-launchers/windows/fogewise-local-infra-reset-windows.ps1",
        ]
      : [
          "./fogewise-dev-launchers/fedora/fogewise-local-infra-reset-fedora.sh",
        ],
    description: "Reset local PostgreSQL + RabbitMQ + Redis",
    oneshot: true,
  },
  api: {
    cwd: repoRoot,
    cmd: "pnpm",
    args: ["--dir", "apps/api", "start:dev"],
    env: rootEnv,
    description: "Start NestJS API in watch mode",
  },
  api_docker_workers: {
    cwd: repoRoot,
    cmd: "pnpm",
    args: ["--dir", "apps/api", "start:dev"],
    env: rootEnv,
    description: "Start NestJS API in watch mode for Docker-hosted agent tools",
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
  phoenix: {
    cwd: repoRoot,
    cmd: "uvx",
    args: ["arize-phoenix", "serve", "--port", "6006"],
    env: rootEnv,
    description: "Start Arize Phoenix trace UI",
    healthPort: 6006,
  },
  managed_agent: {
    cwd: workerRoot,
    cmd: "uv",
    args: ["run", "mda", "dev", "."],
    env: {
      ...rootEnv,
      PYTHONPATH: managedAgentPythonPath,
      ORCHESTRATION_DEBUG: defaultOrchestrationDebug,
      PHOENIX_TRACING: defaultPhoenixTracing,
      PHOENIX_COLLECTOR_ENDPOINT: defaultPhoenixCollectorEndpoint,
      PHOENIX_PROJECT: defaultPhoenixProject,
      OPENWIKI_RUNTIME_COMMAND: defaultOpenWikiRuntimeCommand,
      OPENWIKI_RUNTIME_TIMEOUT_SECONDS: defaultOpenWikiRuntimeTimeoutSeconds,
    },
    description: "Start LCSP Managed Deep Agent in local dev mode",
  },
  docker_worker_build: {
    cwd: repoRoot,
    cmd: "docker",
    args: [
      "build",
      "-f",
      "deepagents/Dockerfile",
      "-t",
      defaultDockerWorkerImage,
      ".",
    ],
    description: `Build Managed Deep Agent Docker image (${defaultDockerWorkerImage})`,
    oneshot: true,
    shell: false,
  },
  managed_agent_docker: dockerManagedAgentTarget(),
};

const groups = {
  fogewise: ["proxy", "infra"],
  fogewise_reset: ["proxy_reset", "infra_reset"],
  dev_app: ["api", "web"],
  dev_docker: [
    "api_docker_workers",
    "web",
    "managed_agent_docker",
  ],
  dev: [
    "api",
    "web",
    "managed_agent",
    "phoenix",
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

function stopDevProcesses() {
  const patterns = [
    "pnpm dev:fogewise",
    "node scripts/run.mjs fogewise",
    "node scripts/run.mjs dev",
    "node scripts/run.mjs dev_app",
    "mda dev .",
    "pnpm --dir apps/api start:dev",
    "nest start --watch",
    "apps/api/dist/src/main",
    "pnpm --dir apps/web dev",
    "next dev",
    "uvx arize-phoenix serve --port 6006",
    "arize-phoenix serve --port 6006",
  ];
  const protectedPids = new Set([
    process.pid,
    process.ppid,
    ...listParentPids(process.pid),
  ]);
  const protectedProcessGroups = new Set(
    [...protectedPids]
      .map((pid) => readProcessGroupId(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
  const killed = [];

  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const pattern of patterns) {
      for (const entry of findMatchingProcesses(pattern, protectedPids)) {
        const groupKilled = killProcessGroup(
          entry,
          signal,
          protectedProcessGroups,
        );
        if (groupKilled) {
          killed.push({
            pid: entry.pid,
            pgid: entry.pgid,
            signal,
            pattern,
            scope: "process-group",
          });
          continue;
        }
        try {
          process.kill(entry.pid, signal);
          killed.push({
            pid: entry.pid,
            pgid: entry.pgid,
            signal,
            pattern,
            scope: "process",
          });
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
      `  - ${entry.scope} pid=${entry.pid} pgid=${entry.pgid ?? "unknown"} signal=${entry.signal} pattern=${entry.pattern}`,
    );
  }
}

function findMatchingProcesses(pattern, protectedPids) {
  const result = spawnSync(
    "bash",
    [
      "-lc",
      `ps -eo pid=,pgid=,args= | grep -F ${shellQuote(pattern)} | grep -v grep`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) return [];

  const processes = [];
  const seen = new Set();
  for (const line of result.stdout.split("\n")) {
    const [rawPid, rawPgid] = line.trim().split(/\s+/, 2);
    const pid = Number.parseInt(rawPid, 10);
    const pgid = Number.parseInt(rawPgid, 10);
    if (
      Number.isInteger(pid) &&
      pid > 0 &&
      !protectedPids.has(pid) &&
      !seen.has(pid)
    ) {
      processes.push({
        pid,
        pgid: Number.isInteger(pgid) && pgid > 0 ? pgid : null,
      });
      seen.add(pid);
    }
  }
  return processes;
}

function killProcessGroup(entry, signal, protectedProcessGroups) {
  if (isWindows || !entry.pgid || protectedProcessGroups.has(entry.pgid)) {
    return false;
  }
  try {
    process.kill(-entry.pgid, signal);
    return true;
  } catch {
    return false;
  }
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

function readProcessGroupId(pid) {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
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

function runTarget(name) {
  const target = targets[name];
  cleanupDockerWorkerContainer(target);
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
    if (target.oneshot) {
      console.log(`[run] Running ${member}: ${target.description}`);
      const status = spawnSyncCompatible(target);
      if (status !== 0) process.exit(status);
    } else {
      longRunningMembers.push(member);
    }
  }

  assertPortsAvailable(longRunningMembers);

  for (const member of longRunningMembers) {
    const target = targets[member];
    cleanupDockerWorkerContainer(target);
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

function spawnTarget(target) {
  return spawn(target.cmd, target.args, {
    cwd: target.cwd,
    env: { ...process.env, ...target.env },
    stdio: "inherit",
    shell:
      target.shell ?? (process.platform === "win32" && target.cmd === "pnpm"),
  });
}

function cleanupDockerWorkerContainer(target) {
  if (target.kind !== "docker_worker" || !target.containerName) return;

  const existing = spawnSync(
    "docker",
    ["ps", "-aq", "--filter", `name=^/${target.containerName}$`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    },
  );
  const containerId = existing.status === 0 ? existing.stdout.trim() : "";
  if (!containerId) return;

  console.log(
    `[run] Removing existing Docker worker container: ${target.containerName}`,
  );
  const removed = spawnSync("docker", ["rm", "-f", target.containerName], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (removed.status !== 0) {
    process.exit(removed.status ?? 1);
  }
}

function dockerManagedAgentTarget() {
  const containerName = "lcsp-managed-agent";
  return {
    cwd: repoRoot,
    cmd: "docker",
    args: [
      "run",
      "--rm",
      "--name",
      containerName,
      "--add-host",
      "host.docker.internal:host-gateway",
      ...dockerEnvArgs(dockerWorkerEnv()),
      defaultDockerWorkerImage,
    ],
    kind: "docker_worker",
    containerName,
    description: "Start LCSP Managed Deep Agent in Docker",
    shell: false,
  };
}

function dockerWorkerEnv() {
  const apiBaseUrl = dockerizeLocalhost(
    process.env.NESTJS_API_BASE_URL ??
      rootEnv.NESTJS_API_BASE_URL ??
      rootEnv.LCSP_API_BASE_URL ??
      "http://127.0.0.1:4000",
  );
  const selectedKeys = [
    "LOG_LEVEL",
    "NODE_ENV",
    "ORCHESTRATION_DEBUG",
    "LCSP_DEV_UNSAFE_TRACE",
    "AGENTIC_RUNTIME_ENABLED",
    "AGENTIC_RUNTIME_MAX_TOOL_CALLS",
    "AGENTIC_RUNTIME_DEFAULT_MAX_ITEMS",
    "AGENTIC_RUNTIME_DEFAULT_MAX_DEPTH",
    "AGENTIC_RUNTIME_DEFAULT_MAX_BYTES",
    "AGENTIC_RUNTIME_DEFAULT_TIMEOUT_MS",
    "AGENTIC_RUNTIME_DISPATCH_PATH",
    "PBAC_PREFLIGHT_TIMEOUT_SECONDS",
    "LLM_PRIMARY_PROVIDER",
    "LLM_PRIMARY_MODEL",
    "OPENAI_API_KEY",
    "LLM_FALLBACK_PROVIDER_1",
    "LLM_FALLBACK_MODEL_1",
    "ANTHROPIC_API_KEY",
    "LLM_FALLBACK_PROVIDER_2",
    "LLM_FALLBACK_MODEL_2",
    "GEMINI_API_KEY",
    "LLM_MODEL_PRICING",
    "LLM_MAX_TOKENS_PER_CALL",
    "LLM_MONTHLY_BUDGET_USD",
    "LLM_MONTHLY_TOKEN_CAP",
    "LLM_PROVIDER_TIMEOUT_SECONDS",
    "LLM_FALLBACK_ON_CODES",
    "LLM_MAX_PROVIDER_ATTEMPTS",
    "LLM_BUDGET_REDIS_URL",
    "WORKER_RUNTIME_VERSION",
    "WORKER_RUNTIME_BUILD_REF",
    "PHOENIX_TRACING",
    "PHOENIX_COLLECTOR_ENDPOINT",
    "PHOENIX_PROJECT",
    "OPENWIKI_RUNTIME_COMMAND",
    "OPENWIKI_RUNTIME_TIMEOUT_SECONDS",
    "LEGAL_CHROMA_PATH",
  ];
  const env = Object.fromEntries(
    selectedKeys
      .map((key) => [key, process.env[key] ?? rootEnv[key]])
      .filter(([, value]) => value !== undefined && value !== ""),
  );

  return {
    ...env,
    RABBITMQ_URL: dockerizeLocalhost(
      process.env.RABBITMQ_URL ?? rootEnv.RABBITMQ_URL ?? "",
    ),
    RABBITMQ_EXCHANGE:
      process.env.RABBITMQ_EXCHANGE ??
      rootEnv.RABBITMQ_EXCHANGE ??
      "lcsp.events",
    NESTJS_API_BASE_URL: apiBaseUrl,
    LCSP_API_BASE_URL: apiBaseUrl,
    WORKER_API_KEY: process.env.WORKER_API_KEY ?? rootEnv.WORKER_API_KEY ?? "",
    PHOENIX_TRACING: defaultPhoenixTracing,
    PHOENIX_COLLECTOR_ENDPOINT: dockerizeLocalhost(
      defaultPhoenixCollectorEndpoint,
    ),
    PHOENIX_PROJECT: defaultPhoenixProject,
    HEALTH_PORT: "8080",
    PYTHONPATH: dockerManagedAgentPythonPath,
    KNIP_BINARY: "/usr/local/bin/knip",
  };
}

function dockerEnvArgs(env) {
  return Object.entries(env)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}

function dockerizeLocalhost(value) {
  return String(value ?? "")
    .replaceAll("127.0.0.1", "host.docker.internal")
    .replaceAll("localhost", "host.docker.internal");
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

  console.error(
    "[run] Cannot start dev group because required ports are already in use:",
  );
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
  return (
    result.stdout
      .split("\n")
      .map((value) => value.trim())
      .find(Boolean) ?? null
  );
}

function spawnSyncCompatible(target) {
  const result = spawnSync(target.cmd, target.args, {
    cwd: target.cwd,
    env: { ...process.env, ...target.env },
    stdio: "inherit",
    shell:
      target.shell ?? (process.platform === "win32" && target.cmd === "pnpm"),
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
  console.log(
    `Usage:\n\n  node scripts/run.mjs <target>\n\nTargets:\n  fogewise\n  fogewise_reset\n  dev_stop\n  dev_app\n  dev_docker\n  dev\n  docker_worker_build\n  managed_agent\n  managed_agent_docker\n\nExamples:\n  pnpm run dev:fogewise\n  pnpm run dev:fogewise:reset\n  pnpm run dev:stop\n  pnpm run dev:app\n  pnpm run dev:docker\n  pnpm run dev:agent:docker:build\n  pnpm run dev:agent:docker\n  pnpm run dev\n`,
  );
}
