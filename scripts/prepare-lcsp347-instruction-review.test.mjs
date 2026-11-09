import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const resultPath =
  "docs/implementation-artifacts/lcsp347-pm-rereview/instruction-equivalence.pending.json";

function isolated(run) {
  const dir = mkdtempSync(path.join(tmpdir(), "lcsp347-review-"));
  try {
    mkdirSync(path.join(dir, "scripts"));
    cpSync(
      path.join(root, "scripts/prepare-lcsp347-instruction-review.mjs"),
      path.join(dir, "scripts/prepare-lcsp347-instruction-review.mjs"),
    );
    cpSync(
      path.join(root, "deepagents/instructions"),
      path.join(dir, "deepagents/instructions"),
      { recursive: true },
    );
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          root,
          "deepagents/instructions/candidates/r1/manifest.pending.json",
        ),
        "utf8",
      ),
    );
    for (const entry of manifest.entries) {
      for (const relative of [
        entry.vietnameseSourcePath,
        entry.englishRuntimePath,
      ]) {
        const target = path.resolve(dir, "deepagents", relative);
        assert.ok(
          target.startsWith(path.resolve(dir, "deepagents") + path.sep),
        );
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(path.join(root, "deepagents", relative), target);
      }
    }
    const invoke = () =>
      spawnSync(
        process.execPath,
        ["scripts/prepare-lcsp347-instruction-review.mjs"],
        { cwd: dir, encoding: "utf8" },
      );
    run(dir, invoke);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith("lcsp347-review-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("59 exact unapproved pairs export deterministically and preserve independent annotations", () =>
  isolated((dir, invoke) => {
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    const file = path.join(dir, resultPath);
    const bytes = readFileSync(file);
    assert.equal(invoke().status, 0);
    assert.deepEqual(readFileSync(file), bytes);
    const data = JSON.parse(bytes);
    assert.equal(data.entries.length, 59);
    assert.equal(data.productionApproval, "BLOCKED");
    assert.ok(
      data.entries.every(
        (e) =>
          e.reviewerDecision === "PENDING_REVIEW" &&
          e.reviewerIdentity === null,
      ),
    );
    data.entries[0].reviewerEvidence =
      "Independent review notes must not be overwritten";
    writeFileSync(file, JSON.stringify(data));
    const annotated = readFileSync(file);
    assert.notEqual(invoke().status, 0);
    assert.deepEqual(readFileSync(file), annotated);
  }));

for (const kind of [
  "missing",
  "duplicate",
  "foreign",
  "source_path",
  "digest",
  "revision",
  "malformed",
]) {
  test(`rejects ${kind} candidate mapping before writing review output`, () =>
    isolated((dir, invoke) => {
      const file = path.join(
        dir,
        "deepagents/instructions/candidates/r1/manifest.pending.json",
      );
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (kind === "missing") data.entries.pop();
      if (kind === "duplicate") data.entries.push(data.entries[0]);
      if (kind === "foreign") data.entries[0].sourceId = "foreign-source";
      if (kind === "source_path")
        data.entries[0].vietnameseSourcePath = "instructions/vi/foreign.md";
      if (kind === "digest")
        data.entries[0].englishRuntimeSha256 = "0".repeat(64);
      if (kind === "revision")
        data.entries[0].vietnameseSourceRevision = "unbound-revision";
      writeFileSync(file, kind === "malformed" ? "{" : JSON.stringify(data));
      assert.notEqual(invoke().status, 0);
    }));
}
