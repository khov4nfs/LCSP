import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  utimesSync,
  statSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const resultPath =
  "docs/implementation-artifacts/lcsp347-pm-rereview/instruction-equivalence.pending.json";

async function isolated(run) {
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
    await run(dir, invoke);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith("lcsp347-review-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("I01 & I08 — Exact 59-pair export generates expected pending review package with approval blocked", () =>
  isolated((dir, invoke) => {
    const first = invoke();
    assert.equal(first.status, 0, first.stderr);
    const file = path.join(dir, resultPath);
    const bytes = readFileSync(file);
    const data = JSON.parse(bytes);
    assert.equal(data.entries.length, 59);
    assert.equal(data.productionApproval, "BLOCKED");
    assert.equal(data.packageKind, "LCSP_INDEPENDENT_EQUIVALENCE_REVIEW_INPUT");
    assert.ok(
      data.entries.every(
        (e) =>
          e.reviewerDecision === "PENDING_REVIEW" &&
          e.reviewerIdentity === null &&
          e.reviewerEvidence === null,
      ),
    );
  }));

test("I02 — Idempotent retry: identical rerun preserves bytes and mtime as verified no-op", () =>
  isolated((dir, invoke) => {
    assert.equal(invoke().status, 0);
    const file = path.join(dir, resultPath);
    const originalBytes = readFileSync(file);

    // Set past timestamp to verify no rewrite occurs
    const past = new Date("2026-01-01T00:00:00Z");
    utimesSync(file, past, past);
    const mtimeBefore = statSync(file).mtimeMs;

    const rerun = invoke();
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.ok(rerun.stdout.includes('"publishOutcome":"IDENTICAL_NOOP"'));
    assert.equal(statSync(file).mtimeMs, mtimeBefore);
    assert.deepEqual(readFileSync(file), originalBytes);
  }));

test("I03 — Unknown and nested reviewer annotations block replacement and preserve evidence", () =>
  isolated((dir, invoke) => {
    assert.equal(invoke().status, 0);
    const file = path.join(dir, resultPath);
    const data = JSON.parse(readFileSync(file, "utf8"));

    // Case A: unknown reviewer field
    data.entries[0].reviewerNotes = "Custom human notes";
    writeFileSync(file, JSON.stringify(data));
    let annotatedBytes = readFileSync(file);
    assert.notEqual(invoke().status, 0);
    assert.deepEqual(readFileSync(file), annotatedBytes);

    // Case B: nested actor authority evidence
    delete data.entries[0].reviewerNotes;
    data.entries[0].actorAuthorityDistinctions.reviewerEvidence = "Authority verified";
    writeFileSync(file, JSON.stringify(data));
    annotatedBytes = readFileSync(file);
    assert.notEqual(invoke().status, 0);
    assert.deepEqual(readFileSync(file), annotatedBytes);

    // Case C: nested safety security evidence
    data.entries[0].actorAuthorityDistinctions.reviewerEvidence = null;
    data.entries[0].safetySecurityConstraints.reviewerEvidence = "Security verified";
    writeFileSync(file, JSON.stringify(data));
    annotatedBytes = readFileSync(file);
    assert.notEqual(invoke().status, 0);
    assert.deepEqual(readFileSync(file), annotatedBytes);

    // Case D: altered potentialSemanticDrift
    data.entries[0].safetySecurityConstraints.reviewerEvidence = null;
    data.entries[0].potentialSemanticDrift = "NO_DRIFT_OBSERVED";
    writeFileSync(file, JSON.stringify(data));
    annotatedBytes = readFileSync(file);
    assert.notEqual(invoke().status, 0);
    assert.deepEqual(readFileSync(file), annotatedBytes);

    // Case E: top-level unknown field
    data.entries[0].potentialSemanticDrift = "NOT_ASSESSED_REQUIRES_INDEPENDENT_REVIEW";
    data.independentReviewerOrganization = "External Legal Corp";
    writeFileSync(file, JSON.stringify(data));
    annotatedBytes = readFileSync(file);
    assert.notEqual(invoke().status, 0);
    assert.deepEqual(readFileSync(file), annotatedBytes);
  }));

test("I06 — Concurrent export: genuine simultaneous processes converge safely to one creation and verified no-op", () =>
  isolated(async (dir) => {
    const script = path.resolve(
      dir,
      "scripts/prepare-lcsp347-instruction-review.mjs",
    );
    const runProcess = () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [script], {
          cwd: dir,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d;
        });
        child.stderr.on("data", (d) => {
          stderr += d;
        });
        child.on("close", (status) => {
          resolve({ status, stdout, stderr });
        });
      });

    // Launch two independent operating system processes simultaneously
    const [p1, p2] = await Promise.all([runProcess(), runProcess()]);

    assert.equal(p1.status, 0, `Process 1 stderr: ${p1.stderr}`);
    assert.equal(p2.status, 0, `Process 2 stderr: ${p2.stderr}`);

    const outcomes = [
      p1.stdout.includes('"publishOutcome":"CREATED"')
        ? "CREATED"
        : p1.stdout.includes('"publishOutcome":"IDENTICAL_NOOP"')
          ? "IDENTICAL_NOOP"
          : "OTHER",
      p2.stdout.includes('"publishOutcome":"CREATED"')
        ? "CREATED"
        : p2.stdout.includes('"publishOutcome":"IDENTICAL_NOOP"')
          ? "IDENTICAL_NOOP"
          : "OTHER",
    ].sort();

    assert.deepEqual(outcomes, ["CREATED", "IDENTICAL_NOOP"]);

    const file = path.join(dir, resultPath);
    assert.ok(existsSync(file));
    const content = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(content.entries.length, 59);
    assert.equal(content.productionApproval, "BLOCKED");

    // Verify atomic temp file cleanup: no lingering .tmp.* files
    const dirFiles = readdirSync(path.dirname(file));
    const tempFiles = dirFiles.filter((f) => f.includes(".tmp."));
    assert.equal(tempFiles.length, 0);
  }));

test("I09 — Concurrent reviewer modification: exporter fails closed and refuses to overwrite reviewed package", () =>
  isolated((dir, invoke) => {
    const file = path.join(dir, resultPath);
    mkdirSync(path.dirname(file), { recursive: true });
    const reviewerData = {
      packageKind: "LCSP_347_INSTRUCTION_EQUIVALENCE_REVIEW_PACKAGE",
      annotatedByHumanReviewer: "Reviewer Team A",
      entries: [],
      approval: { approvedByLegalGoldReview: false },
    };
    const reviewerBytes = JSON.stringify(reviewerData, null, 2) + "\n";
    writeFileSync(file, reviewerBytes);

    // Competing export runs while reviewer data is present
    const res = invoke();
    assert.notEqual(res.status, 0);
    assert.ok(
      res.stderr.includes("Existing independent review evidence must be preserved") ||
        res.stderr.includes("refusing to overwrite"),
      `Unexpected stderr: ${res.stderr}`,
    );

    // Reviewer content is preserved byte-for-byte
    assert.equal(readFileSync(file, "utf8"), reviewerBytes);
  }));

test("I07 — Partial publication failure / invalid input preserves existing valid review package", () =>
  isolated((dir, invoke) => {
    assert.equal(invoke().status, 0);
    const file = path.join(dir, resultPath);
    const validBytes = readFileSync(file);

    // Corrupt manifest input
    const manifestFile = path.join(
      dir,
      "deepagents/instructions/candidates/r1/manifest.pending.json",
    );
    writeFileSync(manifestFile, "{ invalid json");

    const failedRun = invoke();
    assert.notEqual(failedRun.status, 0);
    assert.deepEqual(readFileSync(file), validBytes);
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
  test(`I04 & I05 — rejects ${kind} candidate mapping before writing review output`, () =>
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
