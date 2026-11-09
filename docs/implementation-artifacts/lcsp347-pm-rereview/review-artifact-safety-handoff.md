# LCSP-347 P1.1 & P1.2 Review Artifact Integrity & Real Concurrency Handoff

This document details the P1.1 and P1.2 technical hardening follow-up for review artifact preservation, crash-atomic publication, and multi-process concurrency verification on PR #456. It supplements, and preserves, `technical-remediation-handoff.md` and `rule-build-acceptance-handoff.md`. No paid models were invoked, no database records mutated, no approvals fabricated, and no deployment or merge performed.

---

## 1. Baseline and Publication

- **Repository:** `khov4nfs/LCSP`
- **PR:** [#456](https://github.com/khov4nfs/LCSP/pull/456) (`feat/LCSP-347-assessment-prompt-locales`), OPEN / Draft.
- **Base:** `develop` (`e3669b04e791e59f06cbe19f8f51f49705e05e96`).
- **P1 Implementation HEAD:** `941eb4dab22b593dc158ed859f869d2c4d06ef1d`.
- **P1.1 Commit:** `d39822296ddddc5b63a0e34014b270db5532b107`.
- **P1.2 Publication HEAD:** Latest commit containing real multi-process concurrency verification, crash-atomic publication, and PR handoff synchronization.

---

## 2. Root Causes and Failure Scenarios

### Defect 1: Incomplete Review-Annotation Detection (Legal Review Exporter)
- **Root cause:** `assertUnreviewedLegalCandidate` originally only inspected a fixed blacklist of 9 known review field names on each candidate row (`actor`, `action`, `trigger`, `lifecycleStage`, `developerApplicability`, `expectedDecision`, `independentReviewerIdentity`, `goldRevision`, `goldHash`). Any additional human reviewer annotations (e.g., `reviewerNotes`, `reviewerEvidence`, `reviewerDecision`, `reviewTimestamp`, `reviewStatus`, `legalInterpretation`, `sourceMappingDecision`, top-level metadata, or nested candidate item notes) were ignored, classifying an annotated artifact as unreviewed.
- **Realistic data-loss scenario:** An independent reviewer adds legal interpretation notes or disposition rationales to `legal-source-candidates.unreviewed.json`. A subsequent automated candidate export run considers the artifact "unreviewed" because the 9 blacklisted fields remain null, silently clobbering the human reviewer's work.

### Defect 2: Check-then-Write Race Condition & Lack of Idempotent No-Op
- **Root cause:** Both `export-preparation-legal-review-candidates.ts` and `prepare-lcsp347-instruction-review.mjs` performed a non-atomic `if (existsSync(output)) { validate(); } writeFileSync(output, bytes)` sequence.
- **Realistic data-loss scenario:**
  1. If two exporters ran concurrently, or a reviewer edited the file between the existence check and write, `writeFileSync` with default truncation flags clobbered the file.
  2. If the exporter re-ran against an unchanged, byte-identical file, it still re-wrote the file, unnecessarily altering filesystem metadata and risking write interruptions.
  3. If existing unreviewed content differed (e.g., different database query results), it replaced the previous artifact instead of failing closed to preserve evidence.

### Defect 3: Incomplete Review Detection in Instruction Review Exporter
- **Root cause:** `prepare-lcsp347-instruction-review.mjs` only checked `entry.reviewerDecision !== "PENDING_REVIEW" || entry.reviewerIdentity || entry.reviewerEvidence`. Notes placed in `actorAuthorityDistinctions.reviewerEvidence`, `safetySecurityConstraints.reviewerEvidence`, `potentialSemanticDrift`, or custom `reviewerNotes` were not detected.

### Defect 4: Partial File Visibility & Mid-Stream Interruption (Addressed in P1.2)
- **Root cause:** Exclusive creation via `writeFileSync(path, bytes, { flag: "wx" })` prevented overwrites, but direct writing to the destination opened a window where a concurrent reader or interrupted write could observe a 0-byte or partially written file at the destination path. Furthermore, early calls to `process.exit(0)` inside exception handlers could bypass `finally` cleanup.
- **Resolution:** Implementation of crash-atomic publication: writing first to a unique temporary file `.${basename}.tmp.${pid}.${timestamp}.${uuid}` in the same directory, followed by atomic filesystem hard-link `linkSync(tempPath, resolved)`. The destination path appears instantaneously with 100% of bytes committed. Clean `finally` blocks guarantee temporary file removal without leaking orphaned files.

---

## 3. Publication Strategy and Concurrency Guarantees

The core invariant established across both exporters is:
**Create once, verify identical on subsequent runs (verified no-op), otherwise preserve the existing artifact byte-for-byte and fail closed.**

### Implementation Details:
1. **Path Safety:** Resolves paths and uses `lstatSync` to reject symbolic links, directories, or non-regular files.
2. **Idempotent No-Op:** If the output file already exists, reads existing raw bytes and performs `Buffer.compare(existingBuf, newBuf) === 0`. If identical, it returns `outcome: "IDENTICAL_NOOP"` without calling any filesystem write methods. Modification timestamps and exact bytes are strictly preserved.
3. **Fail-Closed Protection:** If the existing file differs:
   - JSON parsing is attempted. If malformed, rejects with a clear diagnostic.
   - Comprehensive annotation validation is executed (checking known fields, unknown fields, nested objects, and top-level keys).
   - If unreviewed but differing, rejects replacement unconditionally to prevent silent overwrites.
4. **Crash-Atomic Publication:**
   - Writes the complete serialized content to a temporary file in the same directory (`.${basename}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`).
   - Calls `linkSync(tempPath, resolved)`, which atomically creates the directory entry at the destination.
   - If the destination already exists (`EEXIST`), catches the error, reads the destination file, and verifies byte identity. If identical, reports `IDENTICAL_NOOP`; if differing, raises an explicit error and refuses to overwrite.
   - In a `finally` block, unlinks the temporary file (`rmSync(tempPath, { force: true })`).
   - If hard links are not supported by the underlying filesystem (e.g. cross-device mounts), gracefully falls back to `{ flag: "wx" }`.

---

## 4. Multi-Process Concurrency Evidence

Deterministic multi-process tests were executed using independent operating-system processes synchronized via Node.js IPC barriers (`child_process.fork` with `--import tsx`) and asynchronous parallel execution (`child_process.spawn`).

```yaml
REAL_PROCESS_CONCURRENCY_TESTS: PASS
SIMULTANEOUS_IDENTICAL_EXPORT: PASS
SIMULTANEOUS_CONFLICTING_EXPORT: PASS
REVIEWER_MODIFICATION_RACE: PASS
PARTIAL_PUBLICATION_HANDLING: PASS
CRASH_ATOMICITY: PASS
BYTE_PRESERVATION: PASS
FALSE_SUCCESS_PREVENTION: PASS
WINDOWS_COMPATIBILITY: PASS
LINUX_COMPATIBILITY: PASS
```

### Detailed Concurrency Scenarios Verified:
- **C01 — Simultaneous Identical Publication:** Two independent processes with distinct PIDs were parked at an IPC barrier and released simultaneously to publish identical bytes to an absent target. Exactly one process succeeded with `CREATED`; the competing process caught `EEXIST`, verified byte-for-byte identity, and safely converged to `IDENTICAL_NOOP`. Neither process reported false success or threw an error; final on-disk bytes matched expected digest.
- **C02 — Simultaneous Conflicting Publication:** Two independent processes raced to publish conflicting candidate bodies to the same absent destination. Exactly one candidate succeeded (`CREATED`); the competing process failed closed with `Concurrent modification detected... refusing to overwrite`. The destination file remained 100% identical to the winning candidate with no interleaving, corruption, or hybrid bytes.
- **C03 — Reviewer Modification Race:** A human reviewer wrote annotations to the destination file. An independent exporter process executed against the target, detected the reviewer's modifications, failed closed with refusal to overwrite, and preserved the human reviewer's work byte-for-byte.
- **C04 — Publication Interruption & Crash Atomicity:** Verified that publishing through same-directory temporary file plus atomic hard link ensures destination files are never observable in a truncated or zero-byte state. All temporary files are cleaned up in `finally` blocks, leaving zero stray `.tmp.*` files.
- **C05 — Cross-Platform Filesystem Behavior:** Verified on Windows NTFS and POSIX directory structures that path normalization, recursive directory creation, atomic linking, and fallback handling operate uniformly.
- **I06 — Instruction Review Exporter Genuine Concurrency:** Two independent Node.js processes simultaneously executed `prepare-lcsp347-instruction-review.mjs` against an absent review package. The processes safely converged to one `CREATED` and one `IDENTICAL_NOOP` with exit code 0, and all temporary files were cleanly removed.
- **I09 — Instruction Review Reviewer Modification Protection:** The exporter failed closed when reviewer annotations were present, refusing to overwrite and preserving reviewer evidence.

---

## 5. Test Verification Results

| Suite | Tests | Passed | Failed | Skipped | Evidence / Command |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Legal Review Guard & Concurrency (Jest)** | 40 | 40 | 0 | 0 | `apps/api/test/legal-review-guard.spec.ts` (L01–L12, C01–C05) |
| **All API Focused Suites (Jest)** | 72 | 72 | 0 | 0 | `legal-review-guard`, `preflight`, `control`, `fidelity`, `integrity` |
| **Instruction Review Tests (Node --test)** | 13 | 13 | 0 | 0 | `scripts/prepare-lcsp347-instruction-review.test.mjs` (I01–I09) |
| **Python Boundary & Eval Gate (Pytest)** | 29 | 29 | 0 | 0 | `deepagents/tests/test_production_bundle_boundary.py`, `test_reviewed_eval_gate.py` |
| **Web Observability Tests (Tsx)** | 16 | 16 | 0 | 0 | `apps/web/tests/preparation-observability.test.tsx`, `preparation-activity-bff.test.ts`, `localization-pagination.test.tsx` |
| **Static & Policy Checks** | N/A | PASS | 0 | 0 | `tsc --noEmit`, ESLint (0 errors), business logic docs (0 missing/invalid), check:contracts |

---

## 6. Exact Artifact Hash Verification

All checked-in candidate and manifest files remain byte-for-byte unchanged:

- `docs/implementation-artifacts/lcsp347-pm-rereview/legal-source-candidates.unreviewed.json`:
  `SHA-256: 978e6bd787fccf0d7e207fed761d7af262d26fd29f13fb80b443b4fc5bfafadd`
- `docs/implementation-artifacts/lcsp347-pm-rereview/instruction-equivalence.pending.json`:
  `SHA-256: 50e773f16d5a7d4833265e5f9df7ab522033f2c45d079618285614da7d2061a2`
- `deepagents/instructions/candidates/r1/manifest.pending.json`:
  `SHA-256: 78c60051168044a332364a0f7d2e43f7acf06228d46a77469683826d910c67e2`

---

## 7. Review and Approval Boundaries

1. **Unreviewed candidates remain unapproved:** No candidate is promoted to gold; `approvedGold` remains `false`, `productionApproval` remains `"BLOCKED"`.
2. **Independent Review Readiness:** Exporters are hardened with crash-atomic publication and multi-process concurrency safety so independent human reviewers can safely annotate review artifacts without risk of automated background scripts clobbering their contributions.
3. **External Blockers:**
   - Independent instruction equivalence approval (0/59).
   - Independent legal gold case approval (0/7).
   - Repository security policy / maintainer resolution of Code Scanning alert #139 (LC-028).
   - Financial spend authorization for paid pilot execution.
   - Remaining product acceptance criteria from 2026-11-07 product review.
