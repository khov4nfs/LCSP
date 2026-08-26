---
status: ready
updated_at: 2026-08-12
---

# Sprint 6 Extraction Playbook

## Purpose

This playbook defines the safest current extraction order for the mixed Sprint 6 worktree so the team can preserve:

- `1 branch = 1 issue = 1 PR`
- minimal repeated edits to shared composition files
- verification discipline based on already-recorded evidence

It is grounded in the current extraction manifests:

- [candidate-1-request-targeted-reanalysis-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-1-request-targeted-reanalysis-extraction-manifest.md)
- [candidate-2-independent-classification-review-resolution-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-2-independent-classification-review-resolution-extraction-manifest.md)
- [candidate-3-gap-requirements-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-3-gap-requirements-extraction-manifest.md)
- [candidate-4-compare-wizard-claim-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-4-compare-wizard-claim-extraction-manifest.md)

## Current recommended extraction order

1. Candidate 1 — `request_targeted_reanalysis`
2. Candidate 3 — `get_gap_requirements` + gap tool chain
3. Candidate 2 — `resolve_independent_classification_review`
4. Candidate 4 — `compare_wizard_claim`

## Why this order is safest

### 1. Candidate 1 first

Why:

- it is isolated mostly to scan command/spec files
- the only shared-file split is `packages/contracts/src/scan/callback.ts`
- it does not need the shared evidence/RBAC barrels

Main shared split:

- keep only `TARGETED_REANALYSIS_SCAN_EVENT_TYPES` in `packages/contracts/src/scan/callback.ts`
- do not carry `AO3_SCAN_EVENT_TYPES`

### 2. Candidate 3 second

Why:

- it owns the larger AO-5 classification surface
- it already carries the natural AO-5 additions to `classification.module.ts`
- landing it before Candidate 2 reduces repeated churn in the same module composition root

Main shared splits:

- `apps/api/src/modules/classification/classification.module.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`

Keep only AO-5 composition hunks.

### 3. Candidate 2 third

Why:

- once Candidate 3 is removed, the remaining AO-3 review-resolution diff is smaller
- the only remaining classification-module change should be the AO-3 registration hunk
- it still needs `packages/contracts/src/scan/callback.ts`, but only for AO-3 review events

Main shared splits:

- `apps/api/src/modules/classification/classification.module.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`
- `packages/contracts/src/scan/callback.ts`

Keep only AO-3 composition hunks.

### 4. Candidate 4 fourth

Why:

- it is already mostly isolated in reconciliation-specific files
- its shared overlap is limited to `reconciliation.module.ts` plus evidence barrel composition
- it does not collide with the classification/scan split chain

Main shared splits:

- `apps/api/src/modules/reconciliation/reconciliation.module.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`

Keep only AO-4 composition hunks.

## Shared-file split matrix

| Shared file | Candidate 1 | Candidate 3 | Candidate 2 | Candidate 4 |
| --- | --- | --- | --- | --- |
| `packages/contracts/src/scan/callback.ts` | targeted reanalysis only | exclude | AO-3 review events only | exclude |
| `apps/api/src/modules/classification/classification.module.ts` | exclude | AO-5 registration only | AO-3 registration only | exclude |
| `packages/contracts/src/evidence/agentic-tool.ts` | exclude | AO-5 only | AO-3 only | AO-4 only |
| `packages/contracts/src/evidence/index.ts` | exclude | AO-5 only | AO-3 only | AO-4 only |
| `packages/contracts/src/rbac/actions.ts` | exclude | AO-5 only | AO-3 only | exclude |
| `packages/contracts/src/rbac/manager-policy.ts` | exclude | AO-5 only | AO-3 only | exclude |
| `apps/api/src/modules/reconciliation/reconciliation.module.ts` | exclude | exclude | exclude | AO-4 registration only |

## Standard extraction procedure per candidate

For each candidate:

1. resolve the exact Jira task key for the candidate issue before naming the branch
2. create a fresh issue branch
3. move only the candidate-owned files listed in its manifest
4. hunk-split every shared file exactly as defined in the manifest
5. rerun the candidate-local verification commands from the manifest
6. run:

```bash
git diff --check
```

7. confirm no foreign packet files remain in the branch
8. open the PR only after the isolated branch is green

## Jira key preflight

The current repository artifacts prove story ownership, but they do not yet prove every tool-level Jira task key.

Current story-level mapping visible in repo artifacts:

- Candidate 1 (`request_targeted_reanalysis`) → AO-2 story [LCSP-159](https://minhpnq1807.atlassian.net/browse/LCSP-159)
- Candidate 2 (`resolve_independent_classification_review`) → AO-3 story [LCSP-160](https://minhpnq1807.atlassian.net/browse/LCSP-160)
- Candidate 3 (`get_gap_requirements` + gap chain) → AO-5 story [LCSP-162](https://minhpnq1807.atlassian.net/browse/LCSP-162)
- Candidate 4 (`compare_wizard_claim`) → AO-4 story [LCSP-161](https://minhpnq1807.atlassian.net/browse/LCSP-161)

Before creating a final issue branch, confirm the actual child-task key in Jira for that candidate. Do not assume the story key is the tool-level issue key unless Jira explicitly uses that structure.

## Stop conditions

Stop and re-check the manifest before opening a PR if any of these happen:

- a shared file still contains another candidate's packet import/spread
- a controller or spec from another issue is included “just because tests were nearby”
- build passes but the branch still contains unrelated untracked packet files
- a candidate-local spec now depends on a support spec not listed in the manifest
- the branch name uses only a story key when the tool-level task key has not been confirmed

If a new direct blocker appears, fix it only when it is required to keep the isolated candidate branch green and document it in that issue's PR scope.

## Practical outcome

If the team follows this order and the per-candidate manifests exactly, the current mixed Sprint 6 worktree can be decomposed into four issue-owned PRs without inventing new scope or re-deciding shared-file boundaries on the fly.
