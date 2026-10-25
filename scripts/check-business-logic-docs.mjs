import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  collectTypeScriptBusinessFunctions,
  findBusinessDocumentationViolations,
  isBusinessSource,
  isPythonBusinessSource,
  validateBusinessDocumentation,
} from "./business-logic-docs-core.mjs";

const REPO = resolve(import.meta.dirname, "..");
const BASELINE_PATH = join(REPO, "scripts/business-logic-docs-baseline.json");
const SCAN_ROOTS = [
  "apps/api/src",
  "apps/web/src",
  "packages/contracts/src",
  "deepagents",
  "deepagents-langgraph",
];
const IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".venv",
  ".mda",
  "__pycache__",
  "dist",
  "build",
  "coverage",
  "node_modules",
  "venv",
  "fixtures",
  "tests",
  "test",
  "generated",
  "__generated__",
]);
const EXPLICIT_PATHS = process.argv.filter(
  (value) =>
    value.endsWith(".ts") ||
    value.endsWith(".tsx") ||
    value.endsWith(".js") ||
    value.endsWith(".jsx") ||
    value.endsWith(".py"),
);
const generateBaseline = process.argv.includes("--generate-baseline");
const auditOnly = process.argv.includes("--audit");
const strict = process.argv.includes("--strict");

function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, item.name);
    if (item.isDirectory() && !IGNORED_DIRS.has(item.name)) {
      files.push(...listFiles(full));
    } else if (item.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function candidateFiles() {
  const paths = EXPLICIT_PATHS.length
    ? EXPLICIT_PATHS.map((path) => resolve(REPO, path))
    : SCAN_ROOTS.flatMap((root) => listFiles(join(REPO, root)));
  return paths
    .map((absolute) => ({
      absolute,
      path: relative(REPO, absolute).replaceAll("\\", "/"),
    }))
    .filter(
      ({ absolute, path }) =>
        existsSync(absolute) &&
        (isBusinessSource(path) || isPythonBusinessSource(path)),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

function collectRecords(files) {
  const typed = [];
  const python = [];
  for (const { absolute, path } of files) {
    const source = readFileSync(absolute, "utf8");
    if (isPythonBusinessSource(path)) python.push({ path, source });
    else typed.push(...collectTypeScriptBusinessFunctions(source, path));
  }
  if (!python.length) return typed;

  const processResult = spawnSync(
    "python3",
    [join(REPO, "scripts/business-logic-docs-python.py")],
    {
      cwd: REPO,
      encoding: "utf8",
      input: JSON.stringify({ files: python }),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (processResult.error || processResult.status !== 0) {
    throw new Error(
      `Python business logic scan failed: ${processResult.stderr || processResult.error?.message}`,
    );
  }
  return typed.concat(
    JSON.parse(processResult.stdout).map((row) => ({
      ...row,
      problems: validateBusinessDocumentation(row.documentation),
    })),
  );
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    throw new Error(
      "Business documentation baseline missing. It must be checked in; do not generate it in CI.",
    );
  }
  const payload = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  if (
    payload.version !== 1 ||
    typeof payload.entries !== "object" ||
    !payload.entries
  ) {
    throw new Error("Business documentation baseline has invalid schema");
  }
  return payload.entries;
}

function main() {
  const files = candidateFiles();
  const records = collectRecords(files);
  const undocumented = records.filter((record) => record.problems.length);
  if (generateBaseline) {
    if (existsSync(BASELINE_PATH)) {
      throw new Error(
        "Refusing to replace an existing business documentation baseline. Review migration explicitly.",
      );
    }
    const entries = Object.fromEntries(
      undocumented
        .map((record) => [record.key, record.hash])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(
      BASELINE_PATH,
      JSON.stringify(
        {
          version: 1,
          note: "Frozen unstructured legacy functions at adoption. Each SHA-256 identifies the original implementation; new or changed functions MUST adopt the standard. Never regenerate during CI.",
          entries,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `Captured ${undocumented.length} legacy functions in ${BASELINE_PATH}`,
    );
    return;
  }

  const baseline = strict ? {} : loadBaseline();
  const failures = findBusinessDocumentationViolations(undocumented, baseline);
  const grandfathered = undocumented.length - failures.length;
  console.log(
    `Business logic documentation: ${records.length} functions in ${files.length} production source files; ${records.length - undocumented.length} conformant; ${grandfathered} unchanged legacy; ${failures.length} missing/invalid.`,
  );
  const show = auditOnly ? undocumented : failures;
  for (const row of show.slice(0, 35)) {
    console.error(
      `${row.path}:${row.line} (${row.name}): ${row.problems.join("; ")}`,
    );
  }
  if (show.length > 35) {
    console.error(
      `... plus ${show.length - 35} more. See docs/developer/business-logic-documentation-standard.md.`,
    );
  }
  if (!auditOnly && failures.length) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
