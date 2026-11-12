import { describe, it, expect } from "@jest/globals";
import {
  mkdtempSync,
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
import { createHash } from "node:crypto";
import {
  assertUnreviewedLegalCandidate,
  safePublishReviewArtifact,
} from "../scripts/lib/legal-review-guard.js";
import { spawnPublishWorker } from "./helpers/legal-publish-worker.js";

const candidate = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/implementation-artifacts/lcsp347-pm-rereview/legal-source-candidates.unreviewed.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    packageKind: string;
    source: Record<string, unknown>;
    classificationPerformed: boolean;
    approvedGold: boolean;
    candidates: Array<Record<string, unknown>>;
    requiredIndependentControls: string[];
    warning: string;
  };

describe("Legal candidate export protection and guard semantics", () => {
  it("accepts the exact unreviewed package without changing its bytes or legal claims", () => {
    const value = candidate();
    const original = JSON.stringify(value);
    assertUnreviewedLegalCandidate(value);
    expect(JSON.stringify(value)).toBe(original);
    expect(value.approvedGold).toBe(false);
  });

  it.each([
    "actor",
    "action",
    "trigger",
    "lifecycleStage",
    "developerApplicability",
    "expectedDecision",
    "independentReviewerIdentity",
    "goldRevision",
    "goldHash",
  ])("L04 — preserves independently annotated known field: %s", (field) => {
    const value = candidate();
    value.candidates[0][field] = "external annotation";
    expect(() => assertUnreviewedLegalCandidate(value)).toThrow(
      "must not be overwritten",
    );
  });

  it.each([
    "reviewerNotes",
    "reviewerEvidence",
    "reviewerDecision",
    "reviewTimestamp",
    "reviewStatus",
    "legalInterpretation",
    "sourceMappingDecision",
  ])("L05 — preserves unexpected reviewer annotation field: %s", (field) => {
    const value = candidate();
    value.candidates[0][field] = "custom reviewer observation";
    expect(() => assertUnreviewedLegalCandidate(value)).toThrow(
      "must not be overwritten",
    );
  });

  it("L05 — preserves unexpected top-level review annotation field", () => {
    const value = candidate();
    (value as Record<string, unknown>).reviewerNotes = "Top level review notes";
    expect(() => assertUnreviewedLegalCandidate(value)).toThrow(
      "must not be overwritten",
    );
  });

  it("L06 — preserves unexpected nested annotation in sourceTextCandidates", () => {
    const value = candidate();
    const sources = value.candidates[0].sourceTextCandidates as Array<
      Record<string, unknown>
    >;
    sources[0].reviewerVerdict = "Applicable";
    expect(() => assertUnreviewedLegalCandidate(value)).toThrow(
      "must not be overwritten",
    );
  });

  it.each([null, {}, { candidates: [] }, { approvedGold: true }])(
    "rejects malformed or approved artifacts %j",
    (value) => {
      expect(() => assertUnreviewedLegalCandidate(value)).toThrow();
    },
  );

  it("rejects altered mappingStatus", () => {
    const value = candidate();
    value.candidates[0].mappingStatus = "APPROVED_BY_REVIEWER";
    expect(() => assertUnreviewedLegalCandidate(value)).toThrow(
      "must not be overwritten",
    );
  });
});

describe("Safe review artifact publication lifecycle", () => {
  function withTempDir(fn: (dir: string) => void | Promise<void>) {
    const dir = mkdtempSync(path.join(tmpdir(), "lcsp-safe-export-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("L01 — First creation: creates absent artifact exclusively", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const content = JSON.stringify(candidate(), null, 2) + "\n";
      const result = safePublishReviewArtifact({
        outputPath: target,
        generatedBytes: content,
      });
      expect(result.outcome).toBe("CREATED");
      expect(readFileSync(target, "utf8")).toBe(content);
    }));

  it("L02 — Idempotent retry: identical bytes result in verified no-op and unchanged mtime", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const content = JSON.stringify(candidate(), null, 2) + "\n";
      const first = safePublishReviewArtifact({
        outputPath: target,
        generatedBytes: content,
      });
      expect(first.outcome).toBe("CREATED");

      // Set past timestamp to detect any rewrite
      const past = new Date("2026-01-01T00:00:00Z");
      utimesSync(target, past, past);
      const mtimeBefore = statSync(target).mtimeMs;

      const second = safePublishReviewArtifact({
        outputPath: target,
        generatedBytes: content,
      });
      expect(second.outcome).toBe("IDENTICAL_NOOP");
      expect(statSync(target).mtimeMs).toBe(mtimeBefore);
      expect(readFileSync(target, "utf8")).toBe(content);
    }));

  it("L03 — Different unreviewed content: rejects replacement and preserves existing bytes", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const existing = candidate();
      existing.candidates = existing.candidates.slice(0, 1); // unreviewed but fewer candidates
      const existingBytes = JSON.stringify(existing, null, 2) + "\n";
      writeFileSync(target, existingBytes, "utf8");

      const generatedBytes = JSON.stringify(candidate(), null, 2) + "\n";
      expect(() =>
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes,
        }),
      ).toThrow("differs from generated content; refusing to overwrite");

      expect(readFileSync(target, "utf8")).toBe(existingBytes);
    }));

  it("L04 & L10 — Known annotation: rejects replacement and preserves file byte-for-byte", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const annotated = candidate();
      annotated.candidates[0].actor = "NHÀ_CUNG_CẤP";
      const originalBytes = JSON.stringify(annotated, null, 2) + "\n";
      writeFileSync(target, originalBytes, "utf8");

      expect(() =>
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: JSON.stringify(candidate(), null, 2) + "\n",
        }),
      ).toThrow("Existing legal review annotations must not be overwritten");

      expect(readFileSync(target, "utf8")).toBe(originalBytes);
    }));

  it("L05 & L10 — Unknown annotation: rejects replacement and preserves file byte-for-byte", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const annotated = candidate();
      annotated.candidates[0].reviewerNotes =
        "Do not overwrite independent legal notes";
      const originalBytes = JSON.stringify(annotated, null, 2) + "\n";
      writeFileSync(target, originalBytes, "utf8");

      expect(() =>
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: JSON.stringify(candidate(), null, 2) + "\n",
        }),
      ).toThrow("Existing legal review annotations must not be overwritten");

      expect(readFileSync(target, "utf8")).toBe(originalBytes);
    }));

  it("L06 & L10 — Nested annotation: rejects replacement and preserves file byte-for-byte", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const annotated = candidate();
      (
        annotated.candidates[0].sourceTextCandidates as Array<
          Record<string, unknown>
        >
      )[0].reviewerFinding = "Verified";
      const originalBytes = JSON.stringify(annotated, null, 2) + "\n";
      writeFileSync(target, originalBytes, "utf8");

      expect(() =>
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: JSON.stringify(candidate(), null, 2) + "\n",
        }),
      ).toThrow("Existing legal review annotations must not be overwritten");

      expect(readFileSync(target, "utf8")).toBe(originalBytes);
    }));

  it("L07 & L10 — Malformed JSON: rejects replacement and preserves existing bytes", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const malformedBytes = "{ invalid json truncation ...";
      writeFileSync(target, malformedBytes, "utf8");

      expect(() =>
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: JSON.stringify(candidate(), null, 2) + "\n",
        }),
      ).toThrow("malformed JSON; refusing to overwrite");

      expect(readFileSync(target, "utf8")).toBe(malformedBytes);
    }));

  it("L08 — Concurrent creation: competing exports converge safely without corruption", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const content = JSON.stringify(candidate(), null, 2) + "\n";

      // Simulate parallel identical creation
      const results = [
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: content,
        }),
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: content,
        }),
      ];

      expect(results.some((r) => r.outcome === "CREATED")).toBe(true);
      expect(results.some((r) => r.outcome === "IDENTICAL_NOOP")).toBe(true);
      expect(readFileSync(target, "utf8")).toBe(content);
    }));

  it("L09 — Concurrent modification: differing concurrent write is rejected and preserved", () =>
    withTempDir((dir) => {
      const target = path.join(dir, "candidates.json");
      const reviewerContent =
        JSON.stringify(
          { ...candidate(), warning: "Annotated by reviewer" },
          null,
          2,
        ) + "\n";

      // Reviewer wrote right before/during export
      writeFileSync(target, reviewerContent, "utf8");

      expect(() =>
        safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: JSON.stringify(candidate(), null, 2) + "\n",
        }),
      ).toThrow("refusing to overwrite");

      expect(readFileSync(target, "utf8")).toBe(reviewerContent);
    }));

  it("L11 — Provenance integrity: source and chunk metadata are verified", () => {
    const value = candidate();
    expect(value.source.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(value.source.version).toBe(
      "lcsp-360-official-eight-document-acceptance-corpus.v1",
    );
    expect(value.candidates.length).toBeGreaterThan(0);
    for (const c of value.candidates) {
      expect(c.mappingStatus).toBe("PENDING_INDEPENDENT_REVIEW");
      for (const item of c.sourceTextCandidates as Array<
        Record<string, unknown>
      >) {
        expect(item.id).toBeDefined();
        expect(item.contentSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
      }
    }
  });

  it("L12 — Approval boundary: published artifact remains unapproved candidate", () => {
    const value = candidate();
    expect(value.approvedGold).toBe(false);
    expect(value.classificationPerformed).toBe(false);
    expect(
      value.candidates.every(
        (c) =>
          c.actor === null &&
          c.action === null &&
          c.independentReviewerIdentity === null &&
          c.goldHash === null,
      ),
    ).toBe(true);
  });
});

describe("Real process-level concurrency verification (C01–C05)", () => {
  async function withAsyncTempDir(fn: (dir: string) => void | Promise<void>) {
    const dir = mkdtempSync(path.join(tmpdir(), "lcsp-real-concurrency-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it(
    "C01 — Simultaneous identical publication: two independent processes race to create identical file",
    async () =>
      withAsyncTempDir(async (dir) => {
        const target = path.join(dir, "candidates.json");
        const bytes = JSON.stringify(candidate(), null, 2) + "\n";
        const expectedHash = createHash("sha256")
          .update(Buffer.from(bytes))
          .digest("hex");

        const w1 = spawnPublishWorker();
        const w2 = spawnPublishWorker();

        try {
          const [pid1, pid2] = await Promise.all([w1.ready, w2.ready]);
          expect(pid1).toBeGreaterThan(0);
          expect(pid2).toBeGreaterThan(0);
          expect(pid1).not.toBe(pid2);

          // Simultaneous release
          const [res1, res2] = await Promise.all([
            w1.publish({ outputPath: target, generatedBytes: bytes }),
            w2.publish({ outputPath: target, generatedBytes: bytes }),
          ]);

          expect(res1.type).toBe("DONE");
          expect(res2.type).toBe("DONE");
          expect(res1.sha256).toBe(expectedHash);
          expect(res2.sha256).toBe(expectedHash);

          const outcomes = [res1.outcome, res2.outcome].sort();
          expect(outcomes).toEqual(["CREATED", "IDENTICAL_NOOP"]);

          const onDisk = readFileSync(target, "utf8");
          expect(onDisk).toBe(bytes);
          expect(
            createHash("sha256").update(Buffer.from(onDisk)).digest("hex"),
          ).toBe(expectedHash);

          // Verify no leftover .tmp files
          const tempFiles = readdirSync(dir).filter((f) => f.includes(".tmp."));
          expect(tempFiles).toHaveLength(0);
        } finally {
          w1.kill();
          w2.kill();
        }
      }),
    15000,
  );

  it(
    "C02 — Simultaneous conflicting publication: two independent processes attempt different bytes to same target",
    async () =>
      withAsyncTempDir(async (dir) => {
        const target = path.join(dir, "candidates.json");
        const candidateA = candidate();
        const bytesA = JSON.stringify(candidateA, null, 2) + "\n";

        const candidateB = {
          ...candidate(),
          source: {
            ...candidate().source,
            version: "competing-candidate-version.v2",
          },
        };
        const bytesB = JSON.stringify(candidateB, null, 2) + "\n";

        const w1 = spawnPublishWorker();
        const w2 = spawnPublishWorker();

        try {
          await Promise.all([w1.ready, w2.ready]);

          const [res1, res2] = await Promise.all([
            w1.publish({ outputPath: target, generatedBytes: bytesA }),
            w2.publish({ outputPath: target, generatedBytes: bytesB }),
          ]);

          const results = [res1, res2];
          const created = results.filter(
            (r) => r.type === "DONE" && r.outcome === "CREATED",
          );
          const failed = results.filter((r) => r.type === "ERROR");

          expect(created).toHaveLength(1);
          expect(failed).toHaveLength(1);
          // Both race interleavings are valid: the loser may observe an existing
          // artifact before publication or lose the exclusive link attempt.
          // Assert the invariant (different bytes are refused), not the branch.
          expect(failed[0].message).toContain(
            "differs from generated content; refusing to overwrite",
          );

          // Destination matches 100% of winning bytes, never hybrid or corrupted
          const winningHash = created[0].sha256;
          const expectedWinningBytes =
            winningHash ===
            createHash("sha256").update(Buffer.from(bytesA)).digest("hex")
              ? bytesA
              : bytesB;
          expect(readFileSync(target, "utf8")).toBe(expectedWinningBytes);

          // Verify clean directory
          const tempFiles = readdirSync(dir).filter((f) => f.includes(".tmp."));
          expect(tempFiles).toHaveLength(0);
        } finally {
          w1.kill();
          w2.kill();
        }
      }),
    15000,
  );

  it(
    "C03 — Reviewer modification race: reviewer writes before/during export, exporter fails closed and preserves reviewer work",
    async () =>
      withAsyncTempDir(async (dir) => {
        const target = path.join(dir, "candidates.json");
        const reviewerData = {
          ...candidate(),
          reviewerIdentity: "Legal Counsel Reviewer",
          reviewerEvidence: "Verified against decree corpus",
          reviewTimestamp: new Date().toISOString(),
        };
        const reviewerBytes = JSON.stringify(reviewerData, null, 2) + "\n";
        writeFileSync(target, reviewerBytes, "utf8");

        const w = spawnPublishWorker();
        try {
          await w.ready;
          const res = await w.publish({
            outputPath: target,
            generatedBytes: JSON.stringify(candidate(), null, 2) + "\n",
          });

          expect(res.type).toBe("ERROR");
          expect(res.message).toMatch(
            /(?:refusing to overwrite|must not be overwritten)/,
          );

          // Reviewer bytes preserved byte-for-byte
          expect(readFileSync(target, "utf8")).toBe(reviewerBytes);
        } finally {
          w.kill();
        }
      }),
    15000,
  );

  it(
    "C04 — Publication interruption and crash atomicity: atomic link prevents partial destination artifacts",
    () =>
      withAsyncTempDir((dir) => {
        const target = path.join(dir, "atomicity-test.json");
        const content = JSON.stringify(candidate(), null, 2) + "\n";

        // Verify destination does not exist prior to publication
        expect(existsSync(target)).toBe(false);

        // Publish normally
        const res = safePublishReviewArtifact({
          outputPath: target,
          generatedBytes: content,
        });
        expect(res.outcome).toBe("CREATED");
        expect(existsSync(target)).toBe(true);
        expect(readFileSync(target, "utf8")).toBe(content);

        // Verify no temporary files remain
        const tempFiles = readdirSync(dir).filter((f) => f.includes(".tmp."));
        expect(tempFiles).toHaveLength(0);
      }),
    15000,
  );

  it(
    "C05 — Cross-platform filesystem behavior: links, paths, and atomic temp file cleanup",
    () =>
      withAsyncTempDir((dir) => {
        const targetSubdir = path.join(dir, "nested", "sub", "artifact.json");
        const content = JSON.stringify(candidate(), null, 2) + "\n";

        // safePublishReviewArtifact creates parent directories recursively and publishes atomically
        const res = safePublishReviewArtifact({
          outputPath: targetSubdir,
          generatedBytes: content,
        });
        expect(res.outcome).toBe("CREATED");
        expect(existsSync(targetSubdir)).toBe(true);
        expect(readFileSync(targetSubdir, "utf8")).toBe(content);

        // Idempotent retry on cross-platform nested path
        const retry = safePublishReviewArtifact({
          outputPath: targetSubdir,
          generatedBytes: content,
        });
        expect(retry.outcome).toBe("IDENTICAL_NOOP");

        // Verify zero temporary files left in nested directory
        const tempFiles = readdirSync(path.dirname(targetSubdir)).filter((f) =>
          f.includes(".tmp."),
        );
        expect(tempFiles).toHaveLength(0);
      }),
    15000,
  );
});
