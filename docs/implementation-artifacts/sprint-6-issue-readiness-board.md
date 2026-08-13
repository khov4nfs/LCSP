---
status: in-progress
updated_at: 2026-08-12
---

# Sprint 6 Issue Readiness Board

## Purpose

This artifact answers one operational question from the current Sprint 6 mixed worktree:

- which issue/tool slices are ready to cut into isolated issue branches now
- which slices have runtime code but still need isolated-branch proof
- which parts of Sprint 6 are still missing real implementation work

It is grounded in the current source tree and the verified extraction/runtime artifacts, not in Jira intent alone.

Primary execution companion for AO-6 delivery:

- [sprint-6-ao6-rematerialization-checklist.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-ao6-rematerialization-checklist.md)

## Readiness legend

- `MERGED` — issue-owned PR has been opened and merged into `main`; remaining follow-up is only small same-scope maintenance.
- `READY_TO_CUT` — runtime path exists and a detached practical extraction proof already passed with focused verification.
- `RUNTIME_READY_NEEDS_ISSUE_KEY` — runtime path exists and the issue slice is defined, but final branch naming still depends on the confirmed Jira child-task key.
- `RUNTIME_EXISTS_NO_EXTRACTION_PROOF` — runtime path exists, but this audit has not yet proven an isolated issue-branch extraction in a detached worktree.
- `CORE_ONLY_NOT_TOOL_RUNTIME_COMPLETE` — worker/core implementation exists, but this board does not yet claim the named Sprint 6 tool contract is fully closed end-to-end.
- `MISSING_RUNTIME_IMPLEMENTATION` — the named Sprint 6 tool contract is still missing a convincing runtime path.

## Current board

| Group | Slice / tool | Readiness | Evidence | Notes |
| --- | --- | --- | --- | --- |
| AO-2 | Candidate 1 — `request_targeted_reanalysis` | READY_TO_CUT | [candidate-1-request-targeted-reanalysis-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-1-request-targeted-reanalysis-extraction-manifest.md), [candidate-1-extraction-commands.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-1-extraction-commands.md) | Keep compatibility constants in `callback.ts` until AO-3 review-event packet lands in its own branch. Current local refs show the tool was split across many `LCSP-187-*` micro-branches; the candidate manifest remains the only verified clean extraction boundary in this audit. |
| AO-3 | Candidate 2 — `resolve_independent_classification_review` | READY_TO_CUT | [candidate-2-independent-classification-review-resolution-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-2-independent-classification-review-resolution-extraction-manifest.md), [candidate-2-extraction-commands.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-2-extraction-commands.md) | Detached proof passed after Prisma bootstrap; keep AO-5 wiring out of `classification.module.ts`. |
| AO-5 | Candidate 3 — `get_gap_requirements` + gap chain | READY_TO_CUT | [candidate-3-gap-requirements-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-3-gap-requirements-extraction-manifest.md), [candidate-3-extraction-commands.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-3-extraction-commands.md) | Preferred before Candidate 2 to reduce repeated composition-root churn in `classification.module.ts`. |
| AO-4 | Candidate 4 — `compare_wizard_claim` | READY_TO_CUT | [candidate-4-compare-wizard-claim-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-4-compare-wizard-claim-extraction-manifest.md), [candidate-4-extraction-commands.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-4-extraction-commands.md) | Detached proof passed; keep wider reconciliation support-spec cleanup out unless required to keep branch green. |
| AO-2 | Candidate 5 — AO-2 evidence-query spec redistribution | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-agentic-verify-matrix.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-agentic-verify-matrix.md) | Not a clean product slice on its own; specs should follow their owning AO-2 tool issue branches. |
| AO-2 | `get_scan_coverage` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-01-get-scan-coverage.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-01-get-scan-coverage.md) | Local ref `feat/LCSP-174-get-scan-coverage` exists and is relatively focused, but still touches scanner callback/shared contract files; detached branch-proof was not rerun in this audit. |
| AO-2 | `search_evidence` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-02-search-evidence.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-02-search-evidence.md) | Local ref `feat/LCSP-177-search-evidence` exists and appears focused to its handler/query/controller/shared contract seam; detached proof still missing. |
| AO-2 | `get_finding_detail` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-03-get-finding-detail.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-03-get-finding-detail.md) | Local ref `feat/LCSP-180-get-finding-detail` exists and appears focused; detached proof still missing. |
| AO-2 | `get_symbol_context` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-04-get-symbol-context.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-04-get-symbol-context.md) | Local ref `feat/LCSP-179-get-symbol-context` exists and appears focused; detached proof still missing. |
| AO-2 | `get_evidence_subgraph` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-05-get-evidence-subgraph.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-05-get-evidence-subgraph.md) | Local ref `feat/LCSP-176-get-evidence-subgraph` exists and appears focused; detached proof still missing. |
| AO-2 | `trace_static_flow` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-06-trace-static-flow.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-06-trace-static-flow.md) | Local ref `feat/LCSP-175-trace-static-flow` exists and appears focused; detached proof still missing. |
| AO-2 | `find_similar_symbols` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-07-find-similar-symbols.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-07-find-similar-symbols.md) | Local ref `feat/LCSP-178-find-similar-symbols` exists and appears focused; detached proof still missing. |
| AO-2 | `find_provider_invocations` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-08-find-provider-invocations.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-08-find-provider-invocations.md) | Local ref `feat/LCSP-181-find-provider-invocations` exists and appears focused; detached proof still missing. |
| AO-2 | `inspect_data_path` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-09-inspect-data-path.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-09-inspect-data-path.md) | Local ref `feat/LCSP-182-inspect-data-path` exists and appears focused; detached proof still missing. |
| AO-2 | `inspect_decision_path` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-10-inspect-decision-path.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-10-inspect-decision-path.md) | Local ref `feat/LCSP-186-inspect-decision-path` exists and appears focused; detached proof still missing. |
| AO-2 | `inspect_human_review_path` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-11-inspect-human-review-path.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-11-inspect-human-review-path.md) | Local ref `feat/LCSP-183-inspect-human-review-path` exists and appears focused; detached proof still missing. |
| AO-2 | `inspect_deployment_context` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-2-12-inspect-deployment-context.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-12-inspect-deployment-context.md) | Local ref `feat/LCSP-184-inspect-deployment-context` exists and appears focused; detached proof still missing. |
| AO-4 | `get_assessment_context` / `propose_missing_targets` / `get_artifact_chain` / `get_reconciliation_context` / `get_verified_profile` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md) | Runtime is present. Local refs exist for `feat/LCSP-185-get-artifact-chain`, `feat/LCSP-188-propose-missing-targets`, `feat/LCSP-192-get-reconciliation-context`, and `feat/LCSP-216-reconcile-verified-profile`, but detached proof was not rerun in this audit and `get_assessment_context` / `get_verified_profile` still lack verified issue-owned refs here. |
| AO-5 | `get_legal_corpus_readiness` / `retrieve_legal_basis` / `get_legal_rule_match` / `validate_citation_set` / `get_classification_baseline` / `validate_classification_proposal` / `evaluate_gap_matrix` / `get_gap_evidence_trace` / `propose_gap_remediation` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md) | Production runtime exists. Local ref `feat/LCSP-196-validate-citation-set` exists and looks broader than a minimal single-tool slice; the current detached proof still only covers the Candidate 3 gap-chain boundary, not one issue branch per individual tool. |
| AO-1 | `materialize_snapshot` through `validate_evidence_report` | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md) | Focused runtime verification passed on Wednesday, August 12, 2026, but this board still lacks one-issue-per-tool branch-proof for the full baseline set. |
| AO-6 | `get_admin_source_catalog` | RUNTIME_READY_NEEDS_ISSUE_KEY | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [sprint-6-agentic-verify-matrix.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-agentic-verify-matrix.md) | Focused runtime verification passed on Wednesday, August 12, 2026, but `feat/task-ao-6-01-get-admin-source-catalog` currently points at `main` tip `c5a1ee43`, so it is not yet isolated delivery proof. Final Jira child-task key also remains unconfirmed locally. |
| AO-6 | `resume_waiting_runs` (`AO-6-12` = `LCSP-213`) | MERGED | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-6-12-resume-waiting-runs.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-6-12-resume-waiting-runs.md) | Delivered through PR [#193](https://github.com/khovan123/LCSP/pull/193), merged on Wednesday, August 12, 2026. Any later same-scope doc or packet updates must go into a still-open matching PR or a new issue-owned PR; never into the merged PR itself. |
| AO-6 | `activate_validated_corpus_version` (`AO-6-11` = `LCSP-215`) | RUNTIME_EXISTS_NO_EXTRACTION_PROOF | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [ao-6-11-activate-validated-corpus-version.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-6-11-activate-validated-corpus-version.md), [ao-6-11-activation-scope-split-plan.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/ao-6-11-activation-scope-split-plan.md) | Issue key and branch exist, but GitHub shows no PR history for `LCSP-215`, and the current branch diff also carries AO-6-03 through AO-6-10 runtime surfaces. Follow the linked scope-split plan before treating this as a compliant one-issue delivery branch. |
| AO-6 | `fetch_official_source_snapshot` (`AO-6-02` = `LCSP-205`) | MERGED | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [legal-corpus-recovery-tools.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/legal-corpus-recovery-tools.md), [ao-6-02-fetch-official-source-snapshot.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-6-02-fetch-official-source-snapshot.md) | Delivered through PR [#194](https://github.com/khovan123/LCSP/pull/194), merged on Wednesday, August 12, 2026 after packet metadata was aligned on the issue branch. |
| AO-6 | `extract_official_text` / `run_ocr_fallback` / `evaluate_ocr_quality` / `build_reviewed_corpus_input` / `build_legal_chunks` / `validate_chunk_integrity` / `build_legal_retrieval_index` / `validate_retrieval_index` | RUNTIME_READY_NEEDS_ISSUE_KEY | [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md), [legal-corpus-recovery-tools.md](/home/khovan/Workplaces/LCSP/docs/implementation/tasks/modules/agentic-evidence-tools/legal-corpus-recovery-tools.md) | Focused runtime verification passed on Wednesday, August 12, 2026 across dedicated AO-6 worktrees, but the branches still use `feat/task-...` names because Jira child-task keys are not confirmed in the local environment. |

## Hard conclusions

### 1. Four issue slices are now practically branchable

These have both:

- runtime implementation evidence, and
- detached practical extraction proof

They are:

1. Candidate 1 — `request_targeted_reanalysis`
2. Candidate 3 — `get_gap_requirements` + gap chain
3. Candidate 2 — `resolve_independent_classification_review`
4. Candidate 4 — `compare_wizard_claim`

### 2. Sprint 6 is still not complete

Current evidence still does **not** prove full Sprint 6 completion because:

- AO-1 still lacks isolated per-tool issue-branch proof even though runtime verification is now strong
- most AO-2/AO-4/AO-5 tools are runtime-present but not yet isolated per-issue in branch-proof form
- several AO-6 slices still need Jira-key finalization before they can become compliant `1 issue = 1 branch = 1 PR` deliveries

### 3. The biggest remaining delivery gap is issue isolation and Jira finalization, not raw AO-6 runtime implementation

AO-2 through AO-5 are mostly a branch decomposition and issue-isolation problem now.

AO-6 runtime evidence now exists, but several slices still cannot be finalized into compliant issue branches until their Jira child-task keys are confirmed in the local environment.

### AO-6 delivery map

| Packet | Tool | Current delivery key state | Current branch/worktree evidence |
| --- | --- | --- | --- |
| AO-6-01 | `get_admin_source_catalog` | issue key still unconfirmed locally | `feat/task-ao-6-01-get-admin-source-catalog`, worktree `LCSP-ao6-admin-source-catalog`, currently at `main` tip `c5a1ee43` so not isolated proof yet |
| AO-6-02 | `fetch_official_source_snapshot` | confirmed `LCSP-205` | `feat/LCSP-205-fetch-official-source-snapshot`, worktree `LCSP-ao6-fetch-snapshot`, commit `c01eb439`, no GitHub PR history found |
| AO-6-03 | `extract_official_text` | issue key still unconfirmed locally | `feat/task-ao-6-03-extract-official-text`, worktree `LCSP-ao6-extract-text`, commit `d05447d7` |
| AO-6-04 | `run_ocr_fallback` | issue key still unconfirmed locally | `feat/task-ao-6-04-run-ocr-fallback`, worktree `LCSP-ao6-ocr-fallback`, commit `938427af` |
| AO-6-05 | `evaluate_ocr_quality` | issue key still unconfirmed locally | `feat/task-ao-6-05-evaluate-ocr-quality`, worktree `LCSP-ao6-ocr-quality`, commit `a1c13149` |
| AO-6-06 | `build_reviewed_corpus_input` | issue key still unconfirmed locally | `feat/task-ao-6-06-build-reviewed-corpus-input`, worktree `LCSP-ao6-reviewed-input`, commit `3f349cc3` |
| AO-6-07 | `build_legal_chunks` | issue key still unconfirmed locally | `feat/task-ao-6-07-build-legal-chunks`, worktree `LCSP-ao6-legal-chunks`, commit `f05f6ecd` |
| AO-6-08 | `validate_chunk_integrity` | issue key still unconfirmed locally | `feat/task-ao-6-08-validate-chunk-integrity`, worktree `LCSP-ao6-chunk-integrity`, commit `c7aa3417` |
| AO-6-09 | `build_legal_retrieval_index` | issue key still unconfirmed locally | `feat/task-ao-6-09-build-legal-retrieval-index`, worktree `LCSP-ao6-index-build`, commit `6dabb6e8` |
| AO-6-10 | `validate_retrieval_index` | issue key still unconfirmed locally | `feat/task-ao-6-10-validate-legal-retrieval`, worktree `LCSP-ao6-retrieval-validation`, commit `c09bbc4d` |
| AO-6-11 | `activate_validated_corpus_version` | confirmed `LCSP-215` | `feat/LCSP-215-activate-validated-corpus-version`, worktree `LCSP-ao6-activate-corpus`, commit `043d66ca`, no GitHub PR history found and current diff is broader than AO-6-11 only |
| AO-6-12 | `resume_waiting_runs` | confirmed `LCSP-213` | `feat/LCSP-213-resume-waiting-runs`, worktree `LCSP-213-resume-waiting-runs`, commit `96ee7880` |

Use the AO-6 rematerialization checklist above when converting any row in this table into a compliant issue branch and PR.

### 4. Current git refs already prove partial issue ownership for AO-2, AO-4, and AO-5

The local repository now contains issue-linked branches for many tool slices even where this board still says `RUNTIME_EXISTS_NO_EXTRACTION_PROOF`.

- AO-2 evidence-query branches present in local refs:
  - `feat/LCSP-174-get-scan-coverage`
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
- AO-4 reconciliation/artifact branches present in local refs:
  - `feat/LCSP-185-get-artifact-chain`
  - `feat/LCSP-188-propose-missing-targets`
  - `feat/LCSP-192-get-reconciliation-context`
  - `feat/LCSP-216-reconcile-verified-profile`
- AO-5/legal-gate branches present in local refs:
  - `feat/LCSP-196-validate-citation-set`
- AO-1 scanner baseline branches present in local refs:
  - `feat/LCSP-172-build-evidence-graph`
  - `feat/LCSP-173-validate-evidence-report`

This is not yet treated as full `READY_TO_CUT` evidence for every branch because the current audit has not re-run detached per-branch verification for each one.

For AO-6 slices that are already merged into `main`, `main` is the authoritative implementation baseline for rebuilding issue delivery. In those cases the team may create a fresh issue branch from `main` and carry only the issue-owned proof, version, doc, and directly related fixes instead of excavating the original mixed-branch history.

Current branch-scope quality from `git diff main...branch` is now clearer:

- AO-2 likely near-ready after detached proof rerun:
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
  - common pattern: one contract, one query/handler/spec, and only the shared `evidence.module.ts` + `evidence.controller.ts` + `packages/contracts/src/evidence/agentic-tool.ts`
- AO-2 branch with extra shared-runtime spillover:
  - `feat/LCSP-174-get-scan-coverage`
  - still focused enough to salvage, but it also changes scanner worker files (`evidence_assembler.py`, `analyzer_router.py`, `scan_consumer.py`) beyond the normal evidence-query surface
- AO-4 branches currently look focused but still depend on shared reconciliation seams:
  - `feat/LCSP-185-get-artifact-chain`
  - `feat/LCSP-188-propose-missing-targets`
  - `feat/LCSP-192-get-reconciliation-context`
  - each changes one tool contract + one query/handler/spec plus shared `reconciliation.controller.ts` / `reconciliation.module.ts`
- AO-4 branch that is materially broader than a simple read-tool slice:
  - `feat/LCSP-216-reconcile-verified-profile`
  - includes Prisma migration/schema, worker callback/consumer changes, PBAC/contracts, and scan callback changes
- AO-5 branch currently broader than a minimal single-tool slice:
  - `feat/LCSP-196-validate-citation-set`
  - besides the target handler/controller/spec, it also changes policy sync script, retrieve-legal-basis handler, PBAC shared contracts, story/web test, and shared evidence barrels
- AO-1 baseline branches remain overlapping:
  - `feat/LCSP-172-build-evidence-graph`
  - `feat/LCSP-173-validate-evidence-report`
  - both still share scanner graph + assembler files, so they need a deliberate ownership split before they can both count as isolated issue branches

There are also targeted-reanalysis branch-ownership anomalies that must be corrected before final delivery:

- `feat/LCSP-191-request-targeted-reanalysis` currently resolves to tip commit `9d2e3ce3` with message `feat(reconciliation): LCSP-192 add get_reconciliation_context tool`, and its diff against `main` is empty. It should not be trusted as clean issue ownership evidence for targeted reanalysis.
- `request_targeted_reanalysis` is currently fragmented across many `feat/LCSP-187-*` branches, for example:
  - policy/packet only: `feat/LCSP-187-request-targeted-reanalysis`
  - scope resolution: `feat/LCSP-187-resolve-subject-reanalysis-scope`
  - checkpoint persistence: `feat/LCSP-187-targeted-reanalysis-checkpoint`
  - execution consumer: `feat/LCSP-187-targeted-reanalysis-execution-consumer`
  - scheduler/outbox behavior: `feat/LCSP-187-targeted-reanalysis-scheduler`
  - worker bridge/api client: `feat/LCSP-187-targeted-reanalysis-worker-bridge`
- Because of that fragmentation, the local git refs do not currently prove one clean issue-owned branch for the full tool. The verified ownership boundary for delivery remains Candidate 1's extraction manifest until a single issue branch is reconstructed and revalidated.

## Recommended next sequence

### Next branch cuts

1. Cut Candidate 1 with confirmed Jira child-task key
2. Cut Candidate 3 with confirmed Jira child-task key
3. Cut Candidate 2 with confirmed Jira child-task key
4. Cut Candidate 4 with confirmed Jira child-task key

### Next priority after those cuts

Finalize the remaining AO-6 issue branches in this order once Jira child-task keys are confirmed:

1. `get_admin_source_catalog`
2. `extract_official_text`
3. `run_ocr_fallback`
4. `evaluate_ocr_quality`
5. `build_reviewed_corpus_input`
6. `build_legal_chunks`
7. `validate_chunk_integrity`
8. `build_legal_retrieval_index`
9. `validate_retrieval_index`

## Operational rules

- Do not use story keys as final branch keys until the Jira child-task key is confirmed.
- If a Sprint 6 tool is already merged into `main`, recreate its delivery branch from `main` and carry only the issue-owned delta and proof; do not re-cut from older mixed or fragmented branches.
- If a packet/task/issue/story is complete, push a PR and merge it instead of letting completed delivery items accumulate indefinitely in the mixed branch.
- If an already-merged packet/task/issue/story needs a small follow-up update, fold that update into the nearest still-open PR that matches the same delivery scope; do not try to retroactively add commits to an already merged PR.
- Do not create a generic AO-2 cleanup PR for Candidate 5; redistribute each AO-2 spec file into its owning tool issue branch.
- Do not claim Sprint 6 done while AO-1, AO-2, AO-4, AO-5, and AO-6 still lack the remaining issue-isolated branch/PR proof required by `1 issue = 1 branch = 1 PR`.
