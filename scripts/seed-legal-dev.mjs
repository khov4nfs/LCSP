#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSourcePath = join(rootDir, "lcsp-python-workers", "src");
const defaultChromaPath = join(rootDir, "tmp", "lcsp-legal-chroma");
const defaultBundlePath = join(
  rootDir,
  "reports",
  "legal-corpus-ocr",
  "lcsp-precompiled-engineering-rules-vn-2026-08.json",
);
const defaultCorpusVersion = "VN-LEGAL-2026-08";
const defaultCatalogVersion = "VN-LEGAL-RULES-2026-08-DEV";

const commands = {
  corpus: {
    script: join(rootDir, "scripts", "seed_legal_corpus_dev.py"),
    defaultArgs: [],
  },
  "legal-rules": {
    script: join(rootDir, "scripts", "seed_legal_rules_dev.py"),
    defaultArgs: [
      "--bundle",
      defaultBundlePath,
      "--corpus-version",
      defaultCorpusVersion,
      "--catalog-version",
      defaultCatalogVersion,
    ],
  },
  "engineering-rules": {
    script: join(
      rootDir,
      "scripts",
      "import_lcsp_precompiled_engineering_rules.py",
    ),
    defaultArgs: [
      "--bundle",
      defaultBundlePath,
      "--corpus-version",
      defaultCorpusVersion,
      "--catalog-version",
      defaultCatalogVersion,
    ],
  },
};

function usage() {
  console.error(
    [
      "Usage: node scripts/seed-legal-dev.mjs <corpus|legal-rules|engineering-rules|all> [--dry-run] [-- ...extra args]",
      "",
      "Environment:",
      "  PYTHON or PYTHON_BIN can override the Python executable.",
    ].join("\n"),
  );
}

function resolvePythonExecutable() {
  const explicit = process.env.PYTHON_BIN || process.env.PYTHON;
  if (explicit) {
    return explicit;
  }

  const platformCandidate =
    process.platform === "win32"
      ? join(rootDir, "lcsp-python-workers", ".venv", "Scripts", "python.exe")
      : join(rootDir, "lcsp-python-workers", ".venv", "bin", "python");

  if (existsSync(platformCandidate)) {
    return platformCandidate;
  }

  const alternateCandidate =
    process.platform === "win32"
      ? join(rootDir, "lcsp-python-workers", ".venv", "bin", "python")
      : join(rootDir, "lcsp-python-workers", ".venv", "Scripts", "python.exe");

  if (existsSync(alternateCandidate)) {
    return alternateCandidate;
  }

  return process.platform === "win32" ? "python.exe" : "python";
}

function splitArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  if (separatorIndex === -1) {
    return [argv, []];
  }
  return [argv.slice(0, separatorIndex), argv.slice(separatorIndex + 1)];
}

function envWithPythonPath() {
  const existing = process.env.PYTHONPATH;
  const legalChromaPath = resolveLegalChromaPath();
  mkdirSync(legalChromaPath, { recursive: true });

  return {
    ...process.env,
    LEGAL_CHROMA_PATH: legalChromaPath,
    PYTHONPATH: existing
      ? `${workerSourcePath}${process.platform === "win32" ? ";" : ":"}${existing}`
      : workerSourcePath,
  };
}

function resolveLegalChromaPath() {
  const current = process.env.LEGAL_CHROMA_PATH;
  if (
    process.platform !== "win32" ||
    (current && !current.startsWith("/tmp/"))
  ) {
    return current || defaultChromaPath;
  }

  return defaultChromaPath;
}

function runSeed(commandName, options = []) {
  const command = commands[commandName];
  if (!command) {
    throw new Error(`Unknown seed command: ${commandName}`);
  }

  const python = resolvePythonExecutable();
  const args = [command.script, ...command.defaultArgs, ...options];
  const result = spawnSync(python, args, {
    cwd: rootDir,
    env: envWithPythonPath(),
    stdio: "inherit",
    windowsHide: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.signal) {
    throw new Error(`${commandName} seed stopped by signal ${result.signal}`);
  }
}

const [mainArgs, extraArgs] = splitArgs(process.argv.slice(2));
const [target, ...optionArgs] = mainArgs;

if (!target || target === "-h" || target === "--help") {
  usage();
  process.exit(target ? 0 : 1);
}

const options = [...optionArgs, ...extraArgs];

if (target === "all") {
  runSeed("corpus", options);
  runSeed("legal-rules", options);
  runSeed("engineering-rules", options);
} else {
  runSeed(target, options);
}
