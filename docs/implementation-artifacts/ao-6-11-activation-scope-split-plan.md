---
status: ready
updated_at: 2026-08-12
---

# AO-6-11 Activation Scope Split Plan

## Purpose

This plan defines how to turn the current `feat/LCSP-215-activate-validated-corpus-version` branch into a compliant one-issue delivery branch for:

- `AO-6-11`
- `activate_validated_corpus_version`
- Jira issue `LCSP-215`

The current branch is not yet PR-safe because it includes AO-6-03 through AO-6-10 runtime surfaces in addition to AO-6-11.

## Current evidence

Verified from the current `LCSP-ao6-activate-corpus` worktree on Wednesday, August 12, 2026:

- branch: `feat/LCSP-215-activate-validated-corpus-version`
- tip: `043d66ca`
- no GitHub PR history found for this branch
- `git diff main...HEAD` includes:
  - AO-6-11 activation service/contract/controller work
  - AO-6-03 through AO-6-10 worker scripts, repositories, builders, validators, contracts, and tests

This means the branch is runtime-rich but not issue-isolated.

## Keep vs exclude

### Keep for AO-6-11

These are the AO-6-11-owned surfaces that should stay in the final issue branch unless a focused diff review proves a smaller subset is enough:

- `apps/api/prisma/migrations/20260812004000_add_legal_corpus_activation_tracking/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/infrastructure/prisma/prisma-enum-mappers.ts`
- `apps/api/src/modules/legal-rule-catalog/application/contracts/legal-corpus.contract.ts`
- `apps/api/src/modules/legal-rule-catalog/application/services/legal-corpus.service.ts`
- `apps/api/src/modules/legal-rule-catalog/presentation/http/legal-rule-catalog.controller.ts`
- `apps/api/test/legal-rule-catalog.e2e-spec.ts`
- `packages/contracts/src/evidence/activate-validated-corpus-version.ts`
- shared contract files only for the AO-6-11 registration hunks:
  - `packages/contracts/src/evidence/agentic-tool.ts`
  - `packages/contracts/src/evidence/index.ts`
  - `packages/contracts/src/legal-rule-catalog/event-types.ts`
  - `packages/contracts/src/outbox/outbox-message.types.ts`
  - `packages/contracts/src/pbac/actions.ts`

### Exclude from AO-6-11

These belong to earlier AO-6 runtime slices and should not remain in the final `LCSP-215` PR:

- worker scripts for:
  - `build_legal_chunks`
  - `build_legal_retrieval_index`
  - `build_reviewed_corpus_input`
  - `evaluate_ocr_quality`
  - `extract_official_text`
  - `run_ocr_fallback`
  - `validate_chunk_integrity`
  - `validate_retrieval_index`
- worker runtime modules and repositories for:
  - chunk integrity
  - legal chunk building
  - retrieval index building/validation
  - OCR fallback and OCR quality
  - official text extraction
  - reviewed corpus input
- AO-6-03 through AO-6-10 evidence contracts:
  - `build-legal-chunks.ts`
  - `build-legal-retrieval-index.ts`
  - `build-reviewed-corpus-input.ts`
  - `evaluate-ocr-quality.ts`
  - `extract-official-text.ts`
  - `run-ocr-fallback.ts`
  - `validate-chunk-integrity.ts`
  - `validate-retrieval-index.ts`
- their associated worker tests

## Extraction strategy

Use a fresh scratch worktree from `main`, not the current broad branch as the final PR branch.

### Step 1 — create a new scratch issue branch

```bash
git worktree add -b feat/LCSP-215-activate-validated-corpus-version-clean /home/khovan/Workplaces/LCSP-215-clean main
```

### Step 2 — copy only the keep-set files

Copy the keep-set from `LCSP-ao6-activate-corpus` into the clean worktree.

### Step 3 — trim shared files

In shared files, keep only the AO-6-11-specific hunks:

- activation tool registration
- activation event type
- activation PBAC action

Remove all AO-6-03 through AO-6-10 contract exports or registrations.

### Step 4 — rerun focused validation

At minimum:

- the focused API/E2E verification previously used for AO-6-11
- `git diff --check`
- final diff review confirming no AO-6-03..10 files remain

### Step 5 — open the real issue PR

Only after the branch is reduced to AO-6-11-owned surface.

## Stop conditions

Do not open the PR if any of these remain true:

- any worker builder/validator/repository for AO-6-03..10 remains in diff
- shared contract files still export unrelated AO-6 tools
- the migration/schema diff now implies unrelated corpus build/index scope
- validation still depends on a broad branch state instead of the clean issue branch

## Practical outcome

If the team follows this plan:

- `LCSP-215` becomes a real issue-owned PR candidate
- AO-6-03 through AO-6-10 stay available for their own future issue keys
- AO-6-11 stops blocking Sprint 6 delivery hygiene through over-broad branch scope
