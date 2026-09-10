import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
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
const analyzerNodeModules = path.join(analyzerRoot, "node_modules");
const analyzerPackageJson = path.join(analyzerRoot, "package.json");
const tsMorphPackage = path.join(
  analyzerNodeModules,
  "ts-morph",
  "package.json",
);
const npmCache = path.join(analyzerNodeModules, ".npm-cache");
const inputs = ["analyzer.ts", "cli.ts", "package.json", "tsconfig.json"].map(
  (file) => path.join(analyzerRoot, file),
);

main();

function main() {
  const dependenciesReady = isDependenciesReady();
  const outputFresh = isOutputFresh();

  if (!dependenciesReady) {
    console.log("[ts-js-analyzer] Installing local runtime dependencies...");
    rmSync(analyzerNodeModules, { recursive: true, force: true });
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

function isDependenciesReady() {
  return (
    existsSync(tsMorphPackage) &&
    existsSync(analyzerPackageJson) &&
    statSync(analyzerPackageJson).mtimeMs <= statSync(tsMorphPackage).mtimeMs
  );
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
  const env = { ...process.env, NPM_CONFIG_CACHE: npmCache };
  delete env.npm_config_manage_package_manager_versions;
  delete env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS;
  const result = spawnSync(npm, [...args, "--cache", npmCache], {
    cwd: analyzerRoot,
    env,
    stdio: "inherit",
    // Windows command shims such as npm.cmd must be launched through cmd.exe.
    // Spawning the shim directly can fail with EINVAL on Node.js 22.
    shell: process.platform === "win32",
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
