#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const ALLOWED_BRANCHES = [
  /^main$/,
  /^develop$/,
  /^release\/.+$/,
  /^hotfix\/.+$/,
  /^dependabot\/.+$/,
];

const TASK_BRANCH_PATTERN =
  /^(feat|fix|docs|test|refactor|chore|ci|build|perf|style|revert)\/LCSP-[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CI_BRANCH_PATTERN = /^ci\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function currentBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const branch = process.env.BRANCH_NAME?.trim() || currentBranch();

if (!branch) {
  process.exit(0);
}

if (
  ALLOWED_BRANCHES.some((pattern) => pattern.test(branch)) ||
  TASK_BRANCH_PATTERN.test(branch) ||
  CI_BRANCH_PATTERN.test(branch)
) {
  process.exit(0);
}

console.error(`Invalid branch name: ${branch}`);
console.error("");
console.error("Expected task branch format:");
console.error("  feat/LCSP-<issue-number>-short-description");
console.error("");
console.error("Allowed type prefixes:");
console.error("  feat, fix, docs, test, refactor, chore, ci, build, perf, style, revert");
console.error("");
console.error("Allowed CI branch format:");
console.error("  ci/check-changed-workflow");
console.error("");
console.error("Allowed special branches:");
console.error("  main, develop, release/*, hotfix/*, dependabot/*");
process.exit(1);
