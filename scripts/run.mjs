import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { expand } from "dotenv-expand";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workerRoot = path.join(repoRoot, "deepagents");
const dockerGraphStorageRoot = path.join(repoRoot, "tmp", "agent-runtime");
const isWindows = process.platform === "win32";
const workerPython =
  process.platform === "win32"
    ? path.join(workerRoot, ".venv", "Scripts", "python.exe")
    : path.join(workerRoot, ".venv", "bin", "python");
const workerLangGraph =
  process.platform === "win32"
    ? path.join(workerRoot, ".venv", "Scripts", "langgraph.exe")
    : path.join(workerRoot, ".venv", "bin", "langgraph");
const rootEnv = loadDotEnv(path.join(repoRoot, ".env"));
const defaultPhoenixTracing =
  process.env.PHOENIX_TRACING ?? rootEnv.PHOENIX_TRACING ?? "true";
const defaultDockerPhoenixTracing =
  process.env.LCSP_DOCKER_PHOENIX_TRACING ??
  rootEnv.LCSP_DOCKER_PHOENIX_TRACING ??
  "false";
const defaultPhoenixCollectorEndpoint =
  process.env.PHOENIX_COLLECTOR_ENDPOINT ?? "http://localhost:6006/v1/traces";
const defaultPhoenixHost =
  process.env.PHOENIX_HOST ?? rootEnv.PHOENIX_HOST ?? "127.0.0.1";
const defaultPhoenixProject =
  process.env.PHOENIX_PROJECT ?? rootEnv.PHOENIX_PROJECT ?? "deepagents";
const defaultDockerWorkerImage =
  process.env.LCSP_WORKER_DOCKER_IMAGE ??
  rootEnv.LCSP_WORKER_DOCKER_IMAGE ??
  "lcsp-agent-runtime:dev";
const agentRuntimePythonPath = ".";
const dockerAgentRuntimePythonPath = "/app/deepagents";
const agentRuntimeEventsModule =
  "tools.common.capabilities.agent_runtime.rabbitmq_consumer";
const agentRuntimeJobsPerWorker = resolvePositiveInteger(
  process.env.LCSP_AGENT_RUNTIME_JOBS_PER_WORKER ??
    rootEnv.LCSP_AGENT_RUNTIME_JOBS_PER_WORKER ??
    "1",
  "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER",
);
const isDarwin = process.platform === "darwin";
const devMemoryLimits = {
  dev: "2400M",
  dev_app: "2800M",
  dev_docker: "1500M",
  agent_runtime: "2400M",
};
const devSandboxMemory = "512m";

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
      : isDarwin
        ? ["./fogewise-dev-launchers/macos/fogewise-dev-macos.command"]
        : ["./fogewise-dev-launchers/fedora/fogewise-dev-fedora.sh"],
    env: { FOGEWISE_SUBDOMAIN: "lcsp" },
    description: "Start Fogewise local proxy (hosts override + Caddy)",
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
      : isDarwin
        ? ["./fogewise-dev-launchers/macos/fogewise-local-reset-macos.command"]
        : ["./fogewise-dev-launchers/fedora/fogewise-local-reset-fedora.sh"],
    description:
      "Reset Fogewise local proxy (remove hosts override + stop Caddy)",
    oneshot: true,
  },
  infra: {
    cwd: repoRoot,
    cmd: isWindows ? "powershell.exe" : isDarwin ? "docker" : "bash",
    args: isWindows
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "fogewise-dev-launchers/windows/fogewise-local-infra-windows.ps1",
        ]
      : isDarwin
        ? [
            "compose",
            "-f",
            "fogewise-dev-launchers/common/docker-compose.local-infra.yml",
            "up",
            "-d",
          ]
        : ["./fogewise-dev-launchers/fedora/fogewise-local-infra-fedora.sh"],
    description: "Start local PostgreSQL + RabbitMQ + Redis",
    oneshot: true,
  },
  infra_reset: {
    cwd: repoRoot,
    cmd: isWindows ? "powershell.exe" : isDarwin ? "docker" : "bash",
    args: isWindows
      ? [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "fogewise-dev-launchers/windows/fogewise-local-infra-reset-windows.ps1",
        ]
      : isDarwin
        ? [
            "compose",
            "-f",
            "fogewise-dev-launchers/common/docker-compose.local-infra.yml",
            "down",
            "-v",
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
    args: [
      "--python",
      "3.13",
      "--with",
      "sqlalchemy<2.1",
      "arize-phoenix",
      "serve",
      "--host",
      defaultPhoenixHost,
      "--port",
      "6006",
    ],
    env: rootEnv,
    description: "Start Arize Phoenix trace UI",
    healthPort: 6006,
    optional: true,
  },
  agent_runtime: {
    cwd: workerRoot,
    cmd: existsSync(workerLangGraph) && !isWindows ? workerLangGraph : "uv",
    args:
      existsSync(workerLangGraph) && !isWindows
        ? [
            "dev",
            "--no-browser",
            "--no-reload",
            "--allow-blocking",
            "--n-jobs-per-worker",
            String(agentRuntimeJobsPerWorker),
          ]
        : [
            "run",
            "--extra",
            "dev",
            "langgraph",
            "dev",
            "--no-browser",
            "--no-reload",
            "--allow-blocking",
            "--n-jobs-per-worker",
            String(agentRuntimeJobsPerWorker),
          ],
    env: {
      ...rootEnv,
      PYTHONPATH: agentRuntimePythonPath,
      UV_CACHE_DIR: rootEnv.UV_CACHE_DIR ?? "/tmp/uv-cache",
      UV_LINK_MODE: rootEnv.UV_LINK_MODE ?? "copy",
      LCSP_LOCAL_GRAPH_DEV: "1",
      LCSP_AGENT_RUNTIME_JOBS_PER_WORKER: String(agentRuntimeJobsPerWorker),
      LCSP_REPOSITORY_SANDBOX_MEMORY:
        process.env.LCSP_REPOSITORY_SANDBOX_MEMORY ??
        rootEnv.LCSP_REPOSITORY_SANDBOX_MEMORY ??
        devSandboxMemory,
      PHOENIX_TRACING: defaultPhoenixTracing,
      PHOENIX_COLLECTOR_ENDPOINT: defaultPhoenixCollectorEndpoint,
      PHOENIX_PROJECT: defaultPhoenixProject,
    },
    scrubVirtualEnv: true,
    description: "Start LCSP LangGraph Deep Agent runtime",
  },
  agent_runtime_events: {
    cwd: workerRoot,
    cmd: existsSync(workerPython) ? workerPython : "uv",
    args: existsSync(workerPython)
      ? ["-m", agentRuntimeEventsModule]
      : ["run", "python", "-m", agentRuntimeEventsModule],
    env: {
      ...rootEnv,
      PYTHONPATH: agentRuntimePythonPath,
      UV_CACHE_DIR: rootEnv.UV_CACHE_DIR ?? "/tmp/uv-cache",
      UV_LINK_MODE: rootEnv.UV_LINK_MODE ?? "copy",
      PHOENIX_TRACING: defaultPhoenixTracing,
      PHOENIX_COLLECTOR_ENDPOINT: defaultPhoenixCollectorEndpoint,
      PHOENIX_PROJECT: defaultPhoenixProject,
    },
    scrubVirtualEnv: true,
    description: "Start LCSP Agent Runtime RabbitMQ event bridge",
  },
  docker_worker_build: {
    cwd: repoRoot,
    cmd: "docker",
    args: [
      "build",
      "-f",
      "deepagents/Dockerfile.dev",
      "-t",
      defaultDockerWorkerImage,
      ".",
    ],
    description: `Build LCSP Agent Runtime development Docker image (${defaultDockerWorkerImage})`,
    oneshot: true,
    shell: false,
  },
  agent_runtime_docker: dockerAgentRuntimeTarget(),
};

const groups = {
  fogewise: ["proxy", "infra"],
  fogewise_reset: ["proxy_reset", "infra_reset"],
  dev_app: ["api", "web"],
  dev_docker: ["api_docker_workers", "web", "agent_runtime_docker"],
  dev: ["api", "web", "agent_runtime", "agent_runtime_events", "phoenix"],
};

const selection = process.argv[2] ?? "help";
if (process.platform === "linux" && devMemoryLimits[selection] && !process.env.LCSP_DEV_MEMORY_SCOPE) {
  const result = spawnSync(
    "systemd-run",
    [
      "--user",
      "--scope",
      "--collect",
      "-p",
      `MemoryMax=${devMemoryLimits[selection]}`,
      "--setenv=LCSP_DEV_MEMORY_SCOPE=1",
      process.execPath,
      __filename,
      selection,
    ],
    { cwd: repoRoot, env: process.env, stdio: "inherit", shell: false },
  );
  if (result.error) console.error(`[run] Cannot enforce development memory limit: ${result.error.message}`);
  process.exit(result.status ?? 1);
}
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

function prepareAgentRuntime() {
  stopStaleAgentRuntimeProcesses();
}

function stopStaleAgentRuntimeProcesses() {
  if (process.platform !== "linux") return;
  const result = spawnSync("ps", ["-eo", "pid=,args="], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) return;

  const candidates = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const command = match[2];
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (!/langgraph(?:\.exe)?\s+dev\b|langgraph-cli\[inmem\]/u.test(command)) {
      continue;
    }

    let cwd;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      continue;
    }
    const relative = path.relative(workerRoot, cwd);
    const belongsToWorkspace =
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative));
    if (belongsToWorkspace) candidates.push(pid);
  }

  if (candidates.length === 0) return;
  console.log(
    `[run] Stopping stale LCSP Agent Runtime processes: ${candidates.join(", ")}`,
  );
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const pid of candidates) {
      try {
        process.kill(pid, signal);
      } catch {
        // Process already exited.
      }
    }
    if (signal === "SIGTERM") sleepMs(250);
  }
}

function stopDevProcesses() {
  const patterns = [
    "node scripts/run.mjs dev",
    "node scripts/run.mjs dev_app",
    ".venv/bin/langgraph dev --no-browser --no-reload --allow-blocking",
    ".venv/Scripts/langgraph.exe dev --no-browser --no-reload --allow-blocking",
    "uv run --extra dev langgraph dev --no-browser --no-reload --allow-blocking",
    "uv run --extra dev langgraph dev",
    "uv run langgraph dev --no-browser --no-reload --allow-blocking",
    "uv run langgraph dev",
    `python -m ${agentRuntimeEventsModule}`,
    `uv run python -m ${agentRuntimeEventsModule}`,
    "langgraph dev --no-browser --no-reload --allow-blocking",
    "langgraph dev",
    "python entrypoint.py",
    "uv run --with langgraph-cli[inmem]",
    "pnpm --dir apps/api start:dev",
    "nest start --watch",
    "apps/api/dist/src/main",
    "pnpm --dir apps/web dev",
    "next dev",
    "arize-phoenix serve",
  ];
  const protectedPids = new Set([
    process.pid,
    process.ppid,
    ...listParentPids(process.pid),
  ]);
  // Fogewise owns proxy/infra independently of the application dev processes.
  // Protect its group too when both launchers share the same terminal/session.
  for (const pattern of [
    "scripts/run.mjs fogewise",
    "fogewise-dev-launchers/",
  ]) {
    for (const entry of findMatchingProcesses(pattern, protectedPids)) {
      protectedPids.add(entry.pid);
    }
  }
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

function resolvePositiveInteger(value, name) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new Error(
      `[run] ${name} must be a positive integer; received "${normalized}".`,
    );
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed > 64) {
    throw new Error(
      `[run] ${name} must be between 1 and 64; received "${normalized}".`,
    );
  }
  return parsed;
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = parse(readFileSync(filePath));
  return expand({ parsed, processEnv: { ...process.env } }).parsed ?? {};
}

function runTarget(name) {
  const target = targets[name];
  if (name === "agent_runtime") prepareAgentRuntime();
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

  if (longRunningMembers.includes("agent_runtime")) {
    prepareAgentRuntime();
  }

  assertPortsAvailable(longRunningMembers);

  for (const member of longRunningMembers) {
    const target = targets[member];
    cleanupDockerWorkerContainer(target);
    console.log(`[run] Starting ${member}: ${target.description}`);
    children.push({
      name: member,
      child: spawnTarget(target),
      optional: target.optional === true,
    });
  }

  forwardSignals(children.map(({ child }) => child));
  let exiting = false;
  for (const { name: member, child, optional } of children) {
    child.on("exit", (code, signal) => {
      if (exiting) return;
      if (optional) {
        const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
        console.warn(
          `[run] Optional ${member} exited with ${detail}; core dev services remain running.`,
        );
        return;
      }
      exiting = true;
      if ((code ?? 0) !== 0) {
        console.error(
          `[run] ${member} exited with code ${code}. Stopping remaining processes.`,
        );
        if (member === "agent_runtime") {
          console.error(
            "[run] Agent Runtime failed. Check the labelled process output above. " +
              "For API + web only, run `pnpm dev:app`.",
          );
        }
      }
      shutdown(children.map(({ child: runningChild }) => runningChild));
      if (signal) process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    });
  }
}

function spawnTarget(target) {
  return spawn(target.cmd, target.args, {
    cwd: target.cwd,
    env: buildSpawnEnv(target),
    stdio: "inherit",
    shell:
      target.shell ?? (process.platform === "win32" && target.cmd === "pnpm"),
  });
}

function buildSpawnEnv(target) {
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...target.env }).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
  hardenLangSmithEnv(env);

  if (target.scrubVirtualEnv) {
    const virtualEnv = env.VIRTUAL_ENV;
    delete env.VIRTUAL_ENV;

    if (virtualEnv && env.PATH) {
      const virtualEnvBin = path.resolve(
        virtualEnv,
        process.platform === "win32" ? "Scripts" : "bin",
      );
      env.PATH = env.PATH.split(path.delimiter)
        .filter((entry) => path.resolve(entry) !== virtualEnvBin)
        .join(path.delimiter);
    }
  }

  return env;
}

function hardenLangSmithEnv(env) {
  const tracingEnabled = String(env.LCSP_LANGSMITH_TRACING ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "on"].includes(tracingEnabled)) return;

  for (const key of Object.keys(env)) {
    if (
      key.startsWith("LANGSMITH_") ||
      key === "LANGSMITH_API_KEY" ||
      key === "LANGGRAPH_CLOUD_LICENSE_KEY" ||
      key === "LANGGRAPH_ENTERPRISE_LICENSE_KEY" ||
      key === "LANGCHAIN_API_KEY" ||
      key === "LANGCHAIN_ENDPOINT" ||
      key === "LANGCHAIN_PROJECT"
    ) {
      delete env[key];
    }
  }
  env.LANGSMITH_TRACING = "false";
  env.LANGCHAIN_TRACING_V2 = "false";
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

// Model routes ship in the worker image (deepagents/config/model_routes.yaml). Only an
// operator override file (LCSP_MODEL_ROUTES_FILE) is bind-mounted, read-only; the worker
// validates it fail-closed.
const dockerModelRoutesTarget = "/app/deepagents/config/model_routes.override.yaml";

function dockerModelRoutesFile() {
  const file = process.env.LCSP_MODEL_ROUTES_FILE ?? rootEnv.LCSP_MODEL_ROUTES_FILE;
  return file ? path.resolve(repoRoot, file) : "";
}

function dockerAgentRuntimeTarget() {
  const containerName = "lcsp-agent-runtime";
  mkdirSync(dockerGraphStorageRoot, { recursive: true });
  return {
    cwd: repoRoot,
    cmd: "docker",
    args: [
      "run",
      "--rm",
      "--name",
      containerName,
      "--memory",
      "768m",
      "--add-host",
      "host.docker.internal:host-gateway",
      "--mount",
      `type=bind,source=${dockerGraphStorageRoot},target=/app/deepagents/tmp`,
      ...(dockerModelRoutesFile()
        ? [
            "--mount",
            `type=bind,source=${dockerModelRoutesFile()},target=${dockerModelRoutesTarget},readonly`,
          ]
        : []),
      ...dockerEnvArgs(dockerWorkerEnv()),
      defaultDockerWorkerImage,
    ],
    kind: "docker_worker",
    containerName,
    description: "Start LCSP Agent Runtime in Docker",
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
  // One request timeout (LLM_PROVIDER_TIMEOUT_SECONDS) is shared by every
  // provider; forward it only when the operator configured it.
  const providerTimeoutKeys = [
    ...Object.keys(rootEnv),
    ...Object.keys(process.env),
  ].includes("LLM_PROVIDER_TIMEOUT_SECONDS")
    ? ["LLM_PROVIDER_TIMEOUT_SECONDS"]
    : [];
  const selectedKeys = [
    "LOG_LEVEL",
    "NODE_ENV",
    "ORCHESTRATION_DEBUG",
    "LCSP_DEV_UNSAFE_TRACE",
    "RBAC_PREFLIGHT_TIMEOUT_SECONDS",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    // Every provider key list is forwarded whole: the worker rotates across the
    // comma-separated slots, so each configured provider needs its own variable.
    "LLM7_API_KEY",
    "LLM7_BASE_URL",
    "INCEPTION_API_KEY",
    "INCEPTION_BASE_URL",
    "APX_API_KEY",
    "APX_BASE_URL",
    ...providerTimeoutKeys,
    "LCSP_LANGSMITH_TRACING",
    "LCSP_AGENT_RUNTIME_JOBS_PER_WORKER",
    "LCSP_REPOSITORY_SANDBOX_MEMORY",
    "PHOENIX_TRACING",
    "PHOENIX_COLLECTOR_ENDPOINT",
    "PHOENIX_PROJECT",
    "LEGAL_CHROMA_PATH",
    "LEGAL_SOURCE_STORAGE_ROOT",
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
    // Docker dev does not start a Phoenix collector.  Keep tracing opt-in here
    // so the worker does not repeatedly send spans to an unavailable host port.
    PHOENIX_TRACING: defaultDockerPhoenixTracing,
    PHOENIX_COLLECTOR_ENDPOINT: dockerizeLocalhost(
      defaultPhoenixCollectorEndpoint,
    ),
    PHOENIX_PROJECT: defaultPhoenixProject,
    HEALTH_PORT: "8080",
    PYTHONPATH: dockerAgentRuntimePythonPath,
    LANGSMITH_TRACING:
      process.env.LCSP_LANGSMITH_TRACING ??
      rootEnv.LCSP_LANGSMITH_TRACING ??
      "false",
    LANGCHAIN_TRACING_V2:
      process.env.LCSP_LANGSMITH_TRACING ??
      rootEnv.LCSP_LANGSMITH_TRACING ??
      "false",
    LCSP_GRAPH_STORAGE_PATH: "/app/deepagents/tmp",
    ...(dockerModelRoutesFile()
      ? { LCSP_MODEL_ROUTES_FILE: dockerModelRoutesTarget }
      : {}),
    LCSP_REPOSITORY_SANDBOX_MEMORY:
      process.env.LCSP_REPOSITORY_SANDBOX_MEMORY ??
      rootEnv.LCSP_REPOSITORY_SANDBOX_MEMORY ??
      devSandboxMemory,
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
    env: buildSpawnEnv(target),
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
    `Usage:\n\n  node scripts/run.mjs <target>\n\nTargets:\n  fogewise\n  fogewise_reset\n  dev_stop\n  dev_app\n  dev_docker\n  dev\n  docker_worker_build\n  agent_runtime\n  agent_runtime_docker\n\nExamples:\n  pnpm run dev:fogewise\n  pnpm run dev:fogewise:reset\n  pnpm run dev:stop\n  pnpm run dev:app\n  pnpm run dev:docker\n  pnpm run dev:agent:docker:build\n  pnpm run dev:agent:docker\n  pnpm run dev\n`,
  );
}
