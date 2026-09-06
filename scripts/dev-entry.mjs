import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const isWindows = process.platform === "win32";
const pnpmCommand = "pnpm";
const defaultDevelopmentInterviewGuidanceVersion = "interview-guidance-dev-v1";
const requestedMode = process.argv[2];
const mode = requestedMode ?? (isWindows ? "docker" : "local");
const targets = {
  app: "dev_app",
  docker: "dev_docker",
  local: "dev",
};

await main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  if (!Object.hasOwn(targets, mode)) {
    throw new Error(
      `[dev] Unknown mode: ${mode}. Use one of: ${Object.keys(targets).join(", ")}.`,
    );
  }

  if (mode === "local" && isWindows) {
    throw new Error(
      "[dev] Python local-worker mode is not supported on Windows yet. Run `pnpm dev` or `pnpm dev:docker` to use the Docker worker.",
    );
  }

  configureDevelopmentDefaults();

  if (mode === "docker") {
    await requireDockerDaemon();
  }

  await run(pnpmCommand, ["run", "prepare:cli"]);
  await run(pnpmCommand, ["run", "build:runtime-packages"]);
  await run(pnpmCommand, ["--filter", "@lcsp/api", "prisma:migrate:deploy"]);

  if (mode === "docker") {
    console.log("[dev] Building the Docker worker image (Docker cache is reused).");
    await run(pnpmCommand, ["run", "dev:agent:docker:build"]);
  }

  console.log(`[dev] Starting ${mode} development mode.`);
  await run(process.execPath, ["scripts/run.mjs", targets[mode]]);
}

function configureDevelopmentDefaults() {
  if (process.env.INTERVIEW_GUIDANCE_VERSION?.trim()) return;

  process.env.INTERVIEW_GUIDANCE_VERSION =
    defaultDevelopmentInterviewGuidanceVersion;
  console.log(
    `[dev] INTERVIEW_GUIDANCE_VERSION is unset; using ${defaultDevelopmentInterviewGuidanceVersion}.`,
  );
}

async function requireDockerDaemon() {
  const result = spawnSync(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
    },
  );
  const serverVersion = result.stdout?.trim();
  if (result.error || result.status !== 0 || !serverVersion) {
    const detail = result.stderr?.trim();
    throw new Error(
      `[dev] Docker Desktop must be running and its daemon must be reachable before Docker development mode can start.${detail ? ` ${detail}` : ""}`,
    );
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `[dev] ${command} ${args.join(" ")} exited with ${signal ?? code ?? 1}.`,
        ),
      );
    });
  });
}

function spawnCommand(command, args) {
  const isPnpmOnWindows = isWindows && command === pnpmCommand;
  return spawn(
    isPnpmOnWindows ? (process.env.ComSpec ?? "cmd.exe") : command,
    isPnpmOnWindows ? ["/d", "/s", "/c", command, ...args] : args,
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
    },
  );
}
