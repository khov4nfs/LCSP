---
status: ready
updated_at: 2026-08-12
---

# Sprint 6 Runtime Branch-Proof Checklist

## Purpose

This runbook covers Sprint 6 tool slices that already have runtime implementation evidence in the current source tree but do not yet have final isolated issue-branch proof.

Use it for:

- AO-2 evidence-query tools
- AO-4 artifact/reconciliation read tools
- AO-5 legal/classification gap tools
- AO-1 baseline scanner slices that still need ownership separation

Do not use this file for AO-6. AO-6 has its own delivery-specific runbook:

- [sprint-6-ao6-rematerialization-checklist.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-ao6-rematerialization-checklist.md)

## Preconditions

You should only use this runbook when all of these are already true:

1. the tool has a packet in `docs/implementation/tasks/modules/agentic-evidence-tools/packets/`
2. the runtime path is already present in source
3. the readiness board class is `RUNTIME_EXISTS_NO_EXTRACTION_PROOF` or a closely related branch-proof gap

Primary sources:

- [sprint-6-issue-readiness-board.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-issue-readiness-board.md)
- [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md)
- [sprint-6-extraction-playbook.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-extraction-playbook.md)

## Delivery rule

For these Sprint 6 slices, the branch is not considered delivery proof just because a similarly named local ref exists.

To count as valid issue delivery, the branch must prove:

- one issue key
- one owned tool slice
- one bounded diff
- one verification set that actually covers that slice
- one PR that is merged when the slice is complete

If a previously merged packet/task/issue/story later needs a small follow-up update:

- prefer folding it into the nearest still-open PR with the same scope
- otherwise open a new issue-owned PR

Do not keep piling finished updates into the mixed branch while waiting for unrelated tools.

## Current classes

### Class A — AO-2 branches likely near-ready after detached proof rerun

These currently look close to isolated issue delivery:

- `feat/LCSP-175-trace-static-flow`
- `feat/LCSP-176-get-evidence-subgraph`
- `feat/LCSP-177-search-evidence`
- `feat/LCSP-178-find-similar-symbols`
- `feat/LCSP-179-get-symbol-context`
- `feat/LCSP-180-get-finding-detail`
- `feat/LCSP-181-find-provider-invocations`
- `feat/LCSP-182-inspect-data-path`
- `feat/LCSP-183-inspect-human-review-path`
- `feat/LCSP-184-inspect-deployment-context`

Common branch shape:

- one contract
- one query/handler/spec
- shared `evidence.module.ts`
- shared `evidence.controller.ts`
- shared `packages/contracts/src/evidence/agentic-tool.ts`

### Class B — AO-2 branch with extra runtime spillover

- `feat/LCSP-174-get-scan-coverage`

Additional care needed because it also changes scanner worker files:

- `lcsp-python-workers/src/lcsp_workers/scanner/evidence_assembler.py`
- `lcsp-python-workers/src/lcsp_workers/scanner/inventory/analyzer_router.py`
- `lcsp-python-workers/src/lcsp_workers/scanner/scan_consumer.py`

### Class C — AO-4 focused read branches with shared reconciliation seams

- `feat/LCSP-185-get-artifact-chain`
- `feat/LCSP-188-propose-missing-targets`
- `feat/LCSP-192-get-reconciliation-context`

Common branch shape:

- one tool contract
- one query/handler/spec
- shared `reconciliation.controller.ts`
- shared `reconciliation.module.ts`

### Class D — broader branches needing deliberate scoping before final proof

- `feat/LCSP-196-validate-citation-set`
- `feat/LCSP-216-reconcile-verified-profile`
- `feat/LCSP-172-build-evidence-graph`
- `feat/LCSP-173-validate-evidence-report`

Why they are broader:

- AO-5 `LCSP-196` currently includes policy sync, retrieval changes, PBAC shared contracts, and shared barrels beyond the narrow tool surface
- AO-4 `LCSP-216` includes Prisma migration/schema, callback/worker changes, PBAC/contracts, and scan callback changes
- AO-1 `LCSP-172` and `LCSP-173` overlap in scanner graph + assembler ownership

## Standard branch-proof procedure

### Step 1 — confirm the exact Jira child-task key

Do not assume a story key is the same as the tool-level issue key.

Required result:

- exact `LCSP-XXX` issue key
- exact branch name using that key

### Step 2 — classify the branch before touching it

Pick one class:

- Class A: near-ready AO-2
- Class B: AO-2 with spillover
- Class C: focused AO-4 with reconciliation seams
- Class D: broad/overlapping branch

This determines whether the branch can be proof-rerun directly or needs trimming first.

### Step 3 — create a fresh scratch proof worktree

Recommended pattern:

```bash
git worktree add -b feat/LCSP-XXX-<tool-slug> /home/khovan/Workplaces/LCSP-proof-<tool-slug> HEAD
```

If the issue is already merged into `main` and the source evidence proves `main` is sufficient, recreate from `main` instead of from the mixed branch.

### Step 4 — carry only issue-owned files

Allowed:

- tool packet
- tool contract
- one handler/query/controller/spec set
- shared composition hunks required for registration
- directly related blocker fixes needed to keep the branch green

Not allowed:

- neighboring tool packets “because they are close”
- broad barrel cleanup unrelated to the issue
- speculative architecture cleanup

### Step 5 — trim shared files by ownership

Typical shared files to inspect:

- `apps/api/src/modules/evidence/evidence.module.ts`
- `apps/api/src/modules/evidence/presentation/http/evidence.controller.ts`
- `apps/api/src/modules/reconciliation/reconciliation.module.ts`
- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/pbac/actions.ts`
- `packages/contracts/src/pbac/manager-policy.ts`
- `packages/contracts/src/scan/callback.ts`

Rule:

- keep only the hunk needed by the current issue
- remove every unrelated AO registration/import/export/spread

### Step 6 — rerun issue-local verification

At minimum:

1. rerun the focused tests/specs for the issue
2. rerun any directly touched shared-module/controller specs
3. run:

```bash
git diff --check
```

4. inspect final diff for foreign tool bleed

### Step 7 — only then treat the branch as delivery proof

The branch becomes proof only when:

- issue key is correct
- diff is tool-bounded
- verification is green
- no unrelated packet/spec/code remains in diff

## Special notes by class

### Class A — near-ready AO-2

Preferred path:

- rerun detached proof first
- if green, promote to `READY_TO_CUT`

### Class B — AO-2 `get_scan_coverage`

Preferred path:

- keep the tool branch if worker-side spillover is truly required by the tool contract
- otherwise trim the worker changes and rerun proof

### Class C — focused AO-4

Preferred path:

- keep only one reconciliation tool per branch
- shared reconciliation module/controller files must contain one-tool registration only

### Class D — broader branches

Preferred path:

- do not call them delivery proof as-is
- split ownership first, then rerun proof

## Stop conditions

Stop and re-scope before opening a PR if any of these happen:

- the branch includes multiple tools from different AOs
- a shared file still contains another issue's registration/import/export
- the final verification set does not actually cover the touched surface
- the branch name uses the wrong issue key
- the branch depends on an unconfirmed Jira key or stale story-only mapping

## Practical outcome

If the team follows this checklist:

- AO-2 focused branches can move from “runtime exists” to “delivery proof”
- AO-4 focused branches can be isolated without re-deciding reconciliation seams each time
- AO-5 and AO-1 broader branches are forced through an explicit ownership split before they are allowed to count as done
