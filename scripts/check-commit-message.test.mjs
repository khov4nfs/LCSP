import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checkerPath = fileURLToPath(
  new URL("./check-commit-message.mjs", import.meta.url),
);

function runChecker(message) {
  const directory = mkdtempSync(join(tmpdir(), "lcsp-commit-message-"));
  const messagePath = join(directory, "message.txt");

  try {
    writeFileSync(messagePath, message, "utf8");
    return spawnSync(process.execPath, [checkerPath, messagePath], {
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("accepts LCSP issue-linked Conventional Commit subjects", () => {
  const result = runChecker("fix(api): LCSP-513 repair dependency schema gate\n");
  assert.equal(result.status, 0, result.stderr);
});

test("accepts Dependabot production dependency subjects", () => {
  const result = runChecker("chore(deps): Bump zod from 4.0.17 to 4.6.6\n");
  assert.equal(result.status, 0, result.stderr);
});

test("accepts Dependabot development dependency subjects", () => {
  const result = runChecker("chore(deps-dev): bump jest from 30.0.0 to 30.1.0\n");
  assert.equal(result.status, 0, result.stderr);
});

test("rejects non-dependency scopes without an LCSP issue key", () => {
  const result = runChecker("chore(api): update dependencies\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid commit message/);
});

test("rejects dependency scopes that do not describe a dependency update", () => {
  const result = runChecker("chore(deps): improve documentation\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid commit message/);
});
