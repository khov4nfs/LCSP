---
status: ready
updated_at: 2026-08-12
---

# Sprint 6 AO-6 Rematerialization Checklist

## Purpose

This runbook defines the delivery-safe path for AO-6 legal corpus recovery tools that already have verified runtime evidence but still need compliant issue delivery under:

- `1 issue = 1 branch = 1 PR`
- branch recreation from `main` when runtime is already merged
- no historical branch archaeology unless current evidence proves it is necessary

It is grounded in:

- [sprint-6-issue-readiness-board.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-issue-readiness-board.md)
- [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md)
- [legal-corpus-recovery-tools.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/legal-corpus-recovery-tools.md)

## Delivery rule

If an AO-6 runtime path is already present on `main`, treat `main` as the authoritative implementation baseline.

For those tools:

1. create a fresh issue branch from `main`
2. carry only the issue-owned delta:
   - packet/story-proof alignment
   - missing version or contract metadata
   - focused tests or verification updates
   - directly related fixes required to keep that issue green
3. do not reconstruct or replay historical mixed-branch extraction unless current evidence proves the `main` baseline is insufficient
4. once the issue slice is complete, push the PR and merge it rather than leaving a finished AO-6 slice parked locally

If a previously merged AO-6 issue later needs a small follow-up packet/story/doc update:

- add it only to the nearest still-open PR with matching AO-6 delivery scope, or
- open a new issue-owned PR if no suitable open PR exists

Do not treat a merged PR as a live container for more commits.

## AO-6 current delivery classes

### Class A — confirmed issue key and isolated proof already present

These already have a confirmed issue key plus isolated worktree/branch evidence:

| Packet | Tool | Issue key | Branch | Commit |
| --- | --- | --- | --- | --- |
| AO-6-02 | `fetch_official_source_snapshot` | `LCSP-205` | `feat/LCSP-205-fetch-official-source-snapshot` | `7f919646` |
| AO-6-11 | `activate_validated_corpus_version` | `LCSP-215` | `feat/LCSP-215-activate-validated-corpus-version` | `043d66ca` |
| AO-6-12 | `resume_waiting_runs` | `LCSP-213` | `feat/LCSP-213-resume-waiting-runs` | `96ee7880` |

Use these as the reference pattern.

Current delivery reality:

- AO-6-02 is already merged through PR [#194](https://github.com/khovan123/LCSP/pull/194).
- AO-6-12 is already merged through PR [#193](https://github.com/khovan123/LCSP/pull/193).
- AO-6-11 is not yet a reference mergeable branch because its current diff is broader than AO-6-11 alone.

### Class B — runtime/worktree exists, but Jira child-task key is still unconfirmed locally

| Packet | Tool | Current worktree branch | Commit tip |
| --- | --- | --- | --- |
| AO-6-01 | `get_admin_source_catalog` | `feat/task-ao-6-01-get-admin-source-catalog` | `c5a1ee43` |
| AO-6-03 | `extract_official_text` | `feat/task-ao-6-03-extract-official-text` | `d05447d7` |
| AO-6-04 | `run_ocr_fallback` | `feat/task-ao-6-04-run-ocr-fallback` | `938427af` |
| AO-6-05 | `evaluate_ocr_quality` | `feat/task-ao-6-05-evaluate-ocr-quality` | `a1c13149` |
| AO-6-06 | `build_reviewed_corpus_input` | `feat/task-ao-6-06-build-reviewed-corpus-input` | `3f349cc3` |
| AO-6-07 | `build_legal_chunks` | `feat/task-ao-6-07-build-legal-chunks` | `f05f6ecd` |
| AO-6-08 | `validate_chunk_integrity` | `feat/task-ao-6-08-validate-chunk-integrity` | `c7aa3417` |
| AO-6-09 | `build_legal_retrieval_index` | `feat/task-ao-6-09-build-legal-retrieval-index` | `6dabb6e8` |
| AO-6-10 | `validate_retrieval_index` | `feat/task-ao-6-10-validate-legal-retrieval` | `c09bbc4d` |

Important exception:

- `AO-6-01` is not isolated branch proof yet because its branch currently points at `main` tip `c5a1ee43`.

## Standard procedure for any AO-6 tool already merged into `main`

### Step 1 — confirm the exact Jira child-task key

Do not use the story key as the final issue key.

Required result:

- exact issue key like `LCSP-2XX`
- exact branch name in the form `feat/<ISSUE>-<tool-slug>`

### Step 2 — create a fresh branch from `main`

Example:

```bash
git switch main
git pull --ff-only
git switch -c feat/LCSP-XXX-<tool-slug>
```

If using a scratch worktree:

```bash
git worktree add -b feat/LCSP-XXX-<tool-slug> /home/khovan/Workplaces/LCSP-<tool-slug> main
```

### Step 3 — bring only the issue-owned delta

Allowed scope:

- the tool packet for that AO-6 slice
- the minimal code, contract, test, and artifact updates needed to prove that slice
- directly related blocker fixes discovered while making that issue pass

Not allowed:

- unrelated AO-6 packet updates
- speculative cleanup
- multi-tool batching into one branch

### Step 4 — verify focused evidence

At minimum:

1. rerun the focused verification already recorded for that tool
2. rerun any directly touched tests
3. run:

```bash
git diff --check
```

4. inspect final diff to confirm one-tool ownership

### Step 5 — open one PR for one issue

Before PR:

- branch name must use the issue key
- packet/artifact mapping must match the same issue key
- no foreign packet or unrelated tool diff remains

## AO-6 per-tool notes

### AO-6-01 `get_admin_source_catalog`

- runtime evidence exists
- current task branch is not isolated proof because it sits on `main`
- when the Jira key is known, this one should be recreated from `main` first rather than reusing the current task branch as proof

### AO-6-03 through AO-6-10

- each has a dedicated AO-6 worktree with its own non-`main` commit tip
- once the Jira key is known, the preferred path is still to recreate from `main` and carry only the issue-owned proof/delta unless those branches contain unique unmerged evidence

### AO-6-02, AO-6-11, AO-6-12

- these are the reference examples of compliant AO-6 delivery
- if they ever need regeneration after merge, recreate from `main` instead of replaying old extraction history

## Stop conditions

Stop and re-check before opening a PR if any of these happen:

- branch still uses `feat/task-...` after the Jira key is known
- packet key, artifact key, and branch key disagree
- final diff contains more than one AO-6 tool
- the branch includes broad legal corpus cleanup not required for the issue
- focused verification was not rerun after the final diff was prepared

## Practical outcome

If the team follows this checklist, AO-6 can be finished as a delivery problem instead of a re-implementation problem:

- confirmed-key tools can be re-materialized directly from `main`
- unconfirmed-key tools remain runtime-ready and await Jira key confirmation
- AO-6-01 is explicitly prevented from being mistaken for isolated branch proof
