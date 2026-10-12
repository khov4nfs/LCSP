#!/usr/bin/env node
import { readFileSync } from "node:fs";

const ALLOWED_TYPES = [
  "feat",
  "fix",
  "docs",
  "test",
  "refactor",
  "chore",
  "ci",
  "build",
  "perf",
  "style",
  "revert",
];

const COMMIT_MESSAGE_PATTERN = new RegExp(
  `^(${ALLOWED_TYPES.join("|")})(\\([a-z0-9-]+\\))?!?:\\s+LCSP-[0-9]+\\b.+`,
);
const MERGE_COMMIT_PATTERN = /^Merge branch '[^']+' into .+$/;

const messageFile = process.argv.slice(2).find((arg) => arg !== "--");

if (!messageFile) {
  console.error("Missing commit message file path.");
  process.exit(1);
}

const message = readFileSync(messageFile, "utf8");

// Husky passes the full commit message file; validate the first non-comment line.
const subject = message
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line && !line.startsWith("#"));

if (!subject) {
  console.error("Commit message is empty.");
  process.exit(1);
}

if (subject === "ci: auto-fix imports and lint") {
  process.exit(0);
}

if (MERGE_COMMIT_PATTERN.test(subject)) {
  process.exit(0);
}

if (COMMIT_MESSAGE_PATTERN.test(subject)) {
  process.exit(0);
}

console.error(`Invalid commit message: ${subject}`);
console.error("");
console.error("Expected commit message format:");
console.error("  feat: LCSP-<issue-number> short description");
console.error("  fix(api): LCSP-<issue-number> short description");
console.error("");
console.error("Rules:");
console.error(
  `  type must be one of: ${ALLOWED_TYPES.join(", ")}`,
);
console.error("  LCSP ticket must appear after ':' in the subject");
console.error("  description is required after the LCSP ticket");
process.exit(1);
