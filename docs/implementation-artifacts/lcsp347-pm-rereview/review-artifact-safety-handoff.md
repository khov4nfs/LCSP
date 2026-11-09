# LCSP-347 P1.1 Review Artifact Integrity & Safe Export Handoff

This document details the P1.1 technical hardening follow-up for review artifact preservation on PR #456. It supplements, and preserves, `technical-remediation-handoff.md` and `rule-build-acceptance-handoff.md`. No paid models were invoked, no database records mutated, no approvals fabricated, and no deployment or merge performed.

---

## 1. Baseline and Publication

- **Repository:** `khov4nfs/LCSP`
- **PR:** [#456](https://github.com/khov4nfs/LCSP/pull/456) (`feat/LCSP-347-assessment-prompt-locales`), OPEN / Draft.
- **Base:** `develop` (`e3669b04e791e59f06cbe19f8f51f49705e05e96`).
- **Baseline HEAD:** `941eb4dab22b593dc158ed859f869d2c4d06ef1d`.
- **Publication HEAD:** Commit containing this handoff, safe-export implementations, and regression test suites.

---

## 2. Root Causes and Failure Scenarios

### Defect 1: Incomplete Review-Annotation Detection (Legal Review Exporter)
- **Root cause:** `assertUnreviewedLegalCandidate` only inspected a fixed blacklist of 9 known review field names on each candidate row (`actor`, `action`, `trigger`, `lifecycleStage`, `developerApplicability`, `expectedDecision`, `independentReviewerIdentity`, `goldRevision`, `goldHash`). Any additional human reviewer annotations (e.g., `reviewerNotes`, `reviewerEvidence`, `reviewerDecision`, `reviewTimestamp`, `reviewStatus`, `legalInterpretation`, `sourceMappingDecision`, top-level metadata, or nested candidate item notes) were ignored, classifying an annotated artifact as unreviewed.
- **Realistic data-loss scenario:** An independent reviewer adds legal interpretation notes or disposition rationales to `legal-source-candidates.unreviewed.json`. A subsequent automated candidate export run considers the artifact "unreviewed" because the 9 blacklisted fields remain null, silently clobbering the human reviewer's work.

### Defect 2: Check-then-Write Race Condition & Lack of Idempotent No-Op
- **Root cause:** Both `export-preparation-legal-review-candidates.ts` and `prepare-lcsp347-instruction-review.mjs` performed a non-atomic `if (existsSync(output)) { validate(); } writeFileSync(output, bytes)` sequence.
- **Realistic data-loss scenario:**
  1. If two exporters ran concurrently, or a reviewer edited the file between the existence check and write, `writeFileSync` with default truncation flags clobbered the file.
  2. If the exporter re-ran against an unchanged, byte-identical file, it still re-wrote the file, unnecessarily altering filesystem metadata and risking write interruptions.
  3. If existing unreviewed content differed (e.g., different database query results), it replaced the previous artifact instead of failing closed to preserve evidence.

### Defect 3: Incomplete Review Detection in Instruction Review Exporter
- **Root cause:** `prepare-lcsp347-instruction-review.mjs` only checked `entry.reviewerDecision !== "PENDING_REVIEW" || entry.reviewerIdentity || entry.reviewerEvidence`. Notes placed in `actorAuthorityDistinctions.reviewerEvidence`, `safetySecurityConstraints.reviewerEvidence`, `potentialSemanticDrift`, or custom `reviewerNotes` were not detected.

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
4. **Atomic Exclusive Creation:** If the output file does not exist, uses `writeFileSync(path, bytes, { flag: "wx" })` (OS kernel-level `O_CREAT | O_EXCL`). If another process created the file in the interim, it catches `EEXIST`, re-reads the file, and safely succeeds if identical or fails closed if differing.

### Platform and Filesystem Limitations:
- The exclusive creation guarantee (`flag: "wx"`) relies on native OS filesystem semantics supported across Windows NTFS and POSIX filesystems.
- On network filesystems (e.g. NFS without lockd or CIFS with broken caching), exclusive creation guarantees depend on server-side locking behavior; local development and CI containers on ext4/NTFS are strictly protected.

---

## 4. Test Verification Results

| Suite | Tests | Passed | Failed | Skipped | Evidence / Command |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Legal Review Guard (Jest)** | 35 | 35 | 0 | 0 | `apps/api/test/legal-review-guard.spec.ts` (L01–L12) |
| **All API Suites (Jest)** | 86 | 86 | 0 | 0 | 8 suites: diagnostic-db, preflight, legal-guard, observability, activity-view, runtime-events, routes |
| **Instruction Review Tests (Node --test)** | 12 | 12 | 0 | 0 | `scripts/prepare-lcsp347-instruction-review.test.mjs` (I01–I08) |
| **Python Boundary & Eval Gate (Pytest)** | 29 | 29 | 0 | 0 | `deepagents/tests/test_production_bundle_boundary.py`, `test_reviewed_eval_gate.py` |
| **Web Observability Tests (Tsx)** | 16 | 16 | 0 | 0 | `apps/web/tests/preparation-observability.test.tsx`, `preparation-activity-bff.test.ts`, `localization-pagination.test.tsx` |
| **Static & Policy Checks** | N/A | PASS | 0 | 0 | `tsc --noEmit`, ESLint (0 errors), business logic docs (0 missing/invalid), check:contracts |

---

## 5. Exact Artifact Hash Verification

All checked-in candidate and manifest files remain byte-for-byte unchanged:

- `docs/implementation-artifacts/lcsp347-pm-rereview/legal-source-candidates.unreviewed.json`:
  `SHA-256: 978e6bd787fccf0d7e207fed761d7af262d26fd29f13fb80b443b4fc5bfafadd`
- `docs/implementation-artifacts/lcsp347-pm-rereview/instruction-equivalence.pending.json`:
  `SHA-256: 50e773f16d5a7d4833265e5f9df7ab522033f2c45d079618285614da7d2061a2`
- `deepagents/instructions/candidates/r1/manifest.pending.json`:
  `SHA-256: 78c60051168044a332364a0f7d2e43f7acf06228d46a77469683826d910c67e2`

---

## 6. Review and Approval Boundaries

1. **Unreviewed candidates remain unapproved:** No candidate is promoted to gold; `approvedGold` remains `false`, `productionApproval` remains `"BLOCKED"`.
2. **Independent Review Readiness:** Exporters are hardened so independent human reviewers can safely annotate review artifacts without risk of automated background scripts clobbering their contributions.
3. **External Blockers:**
   - Independent instruction equivalence approval (0/59).
   - Independent legal gold case approval (0/7).
   - Repository security policy / maintainer resolution of Code Scanning alert #139 (LC-028).
   - Financial spend authorization for paid pilot execution.
