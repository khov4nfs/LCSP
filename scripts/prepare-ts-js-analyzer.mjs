import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const analyzerRoot = path.join(
  repoRoot,
  "deepagents",
  "tools",
  "common",
  "capabilities",
  "evidence",
  "scanner",
  "ts_js_bridge",
  "ts-js-analyzer",
);
const analyzerCli = path.join(
  analyzerRoot,
  "dist",
  "tools",
  "ts-js-analyzer",
  "cli.js",
);
const tsMorphPackage = path.join(
  analyzerRoot,
  "node_modules",
  "ts-morph",
  "package.json",
);
const inputs = ["analyzer.ts", "cli.ts", "package.json", "tsconfig.json"].map(
  (file) => path.join(analyzerRoot, file),
);

main();

function main() {
  const dependenciesReady = existsSync(tsMorphPackage);
  const outputFresh = isOutputFresh();

  if (!dependenciesReady) {
    console.log("[ts-js-analyzer] Installing local runtime dependencies...");
    runNpm([
      "install",
      "--include=dev",
      "--package-lock=false",
      "--workspaces=false",
      "--no-audit",
      "--no-fund",
    ]);
  }

  if (!outputFresh) {
    console.log("[ts-js-analyzer] Building analyzer...");
    runNpm(["run", "build"]);
  }

  if (!existsSync(tsMorphPackage)) {
    fail(`ts-morph was not installed at ${tsMorphPackage}`);
  }
  if (!existsSync(analyzerCli)) {
    fail(`build did not create ${analyzerCli}`);
  }

  console.log("[ts-js-analyzer] Runtime is ready.");
}

function isOutputFresh() {
  if (!existsSync(analyzerCli)) {
    return false;
  }

  const outputMtime = statSync(analyzerCli).mtimeMs;
  return inputs.every(
    (input) => existsSync(input) && statSync(input).mtimeMs <= outputMtime,
  );
}

function runNpm(args) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, args, {
    cwd: analyzerRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    fail(`failed to execute npm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`[ts-js-analyzer] ${message}`);
  process.exit(1);
}
