# LCSP Production Agentic Migration — Single-Agent Handoff

## 1. Handoff purpose

The previous implementation used Orca multi-worker orchestration. That campaign is now **FROZEN** at the user's instruction. No further migration Tasks, workers, or gate retries were started after the freeze instruction. Continue with **one primary agent sequentially**, directly in the canonical source below, not by restarting the campaign.

The Architecture Freeze remains authoritative. This handoff is the operational continuation authority; neither old worker prose nor a green preparation test overrides a frozen architecture decision or integration gate. Continue from the present implementation, not from HEAD alone and not from scratch.

The current position is **W1 foundation implemented, W1 integration gate FAIL; focused web repair present but not gate-accepted. W2–W7 production verticals are not implemented.** Production completion is NOT PROVEN.

## 2. Canonical repository state

- Canonical workspace: `/home/khovan/Workplaces/LCSP`.
- Repository: `https://github.com/khovan123/LCSP.git`; verified through Git common directory/worktree records and Orca repository identity, not guessed.
- Branch: `develop`.
- HEAD: `c6ce6d954f02a755beffe3f62df2f5cc3e8bfa24` — deliberately unchanged.
- Local consolidation checkpoint: `58c7416f9f2fe8b39c83db4561e06c067d79aa5f`, on the historical integration branch. Message: `chore(agentic-migration): consolidation checkpoint before single-agent handoff`.
- Original integration workspace: `/home/khovan/orca/workspaces/LCSP/agentic-prod-integration`, branch `khovan123/agentic-prod-integration`; pre-checkpoint HEAD `1e2107956eeb55930859d9d69b0c311fdf698007`.
- Old Orca Run: `run_ee9d143f896c`, **historical only**. Leave intact; do not resume/rebind/recreate it.
- Handoff timestamp: 2026-10-06 11:13:59 UTC; Playwright inventory/validation addendum: 2026-10-06 11:28 UTC (Asia/Ho_Chi_Minh is UTC+07).
- Canonical worktree: **DIRTY, intentionally uncommitted and unstaged**: 67 tracked dirty paths and 75 untracked files at final verification. It contains the transferred migration plus the original user WIP and this handoff. Do not use `git diff` alone as the inventory: new migration files remain untracked.
- No remote push, PR, branch change, reset, restore, stash, clean, dependency/cache copy, or database/container transfer occurred.
- Snapshot directory: `/home/khovan/Workplaces/lcsp-migration-consolidation-20261006.tnyLNS`. It contains `pre-transfer-inventory.json`, `canonical-user-wip.patch`, `canonical-user-wip-files.tar.gz`, `integration-final-working.patch`, `transfer-manifest.json`, and the deterministic `consolidation.patch`. These are local safety/evidence artifacts, not runtime prerequisites.
- Local checkpoint used the previous campaign's `HUSKY=0` convention for the naming-incompatible migration branch/message; it is not CI acceptance. No hook/config was edited.

Transfer method: compare each migration path against the canonical base/current bytes, reject non-identical collisions, generate a binary Git patch from the canonical HEAD to the checkpoint, check it, then apply it **without moving HEAD or updating the canonical index**. All 133 migration inventory paths match the checkpoint, including absent deleted paths. The only collision was the original untracked implementation plan, already byte-identical; excluded it from application and left it untouched. No manual three-way conflict merge was needed.

Counts: **54 production paths** (51 written/updated files and 3 intended deletions); **78 test/report/fixture files transferred**, plus this new handoff = **79 supporting files written**. One additional useful architecture-plan file was already present and retained unchanged. Counts classify production as app source excluding test/spec files, Prisma/schema/migration, shared package source, and Python production tools; all other migration paths are supporting artifacts.

Before transfer, integration status had 3 tracked modifications and 1 tracked deletion, with 43 relevant checkpoint paths total; tracked diff was 45 insertions/72 deletions. Eighteen `.playwright-mcp/*.yml` snapshots were excluded as transient browser output and retained only in the old workspace. Relevant reports, including the durable historical W1.4 recovery patch, were transferred. Patch application warned about whitespace **inside that preserved patch artifact**; production bytes were not whitespace-rewritten. Canonical `git diff --check` passes.

### Original user-owned WIP — preserve byte-for-byte

The following nine files existed dirty/untracked before consolidation. Their final hashes were checked against these recorded originals; all matched. Their presence is not migration acceptance. None of this canonical working-tree WIP was committed; the already-identical architecture plan is also recorded in the integration checkpoint as useful migration authority, without overwriting its canonical copy.

| File                                                                                                                | Original status | SHA256                                                             |
| ------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `deepagents/subagents/repository_analyst/definition.py`                                                             | `M`             | `55f5a6bbe724f954fbc3a0878bd5d4d66e2c05c1f6d0cf0ba283165356381514` |
| `deepagents/tests/test_assessment_interview_resume_boundary.py`                                                     | `M`             | `6d83734c6fdc3f3c6e9f3c267b530b71836e5f32676c361a4002db7080563492` |
| `deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/engineering_assessment_boundary.py` | `M`             | `b3a08b3c938938c0938789a20cf300556cb34900ccf8e4493259743584826edd` |
| `deepagents/tools/common/capabilities/assessment/rule_assessment/run.py`                                            | `M`             | `a4fc90694e526c493a8d13c8ab9d767156d52df0512e45ef57f69121d1ba1d51` |
| `deepagents/tools/common/capabilities/assessment/rule_assessment/validation.py`                                     | `M`             | `021053d0ef134e130f78bc235e915e22c5290fe23d823a8e62b8643a2c3fbbf2` |
| `deepagents/tools/common/capabilities/workflow/recovery/interview_boundary.py`                                      | `M`             | `31a9cbd730d3ea93032901da8b8c0a993e0291374533c9f4abec79d6e9741fcf` |
| `deepagents/tests/test_rule_assessment_need_id.py`                                                                  | `??`            | `3bea15fea29fea339200764b3f3dbdb0e2edc5508fe15b68d695a6b7bf7f557f` |
| `deepagents/tools/common/capabilities/assessment/rule_assessment/need_id.py`                                        | `??`            | `9536be66af9be96d4f844c6e50ccc8ecbd8f05c5f8bf5c9e08074a471f1f0669` |
| `docs/architecture/agentic-production-implementation-plan.md`                                                       | `??`            | `8ab2305c8cc192763f3c0fc81db0cc2cb7ba1b97e029b16484fba9ade30d25fb` |

These contain legacy question/need-ID and Interview/resume work. Some will eventually be superseded by gated W3–W7 replacement; do not erase them under the guise of transfer or cleanup. Resolve future overlaps narrowly and deliberately.

### Local migration commit history

All these commits are local objects in the same repository, not changes pushed by this consolidation:

```text
58c7416f9f2fe8b39c83db4561e06c067d79aa5f chore(agentic-migration): consolidation checkpoint before single-agent handoff
1e2107956eeb55930859d9d69b0c311fdf698007 refactor(web): project persisted canonical assessment state [task_a12c998de321] [task_3130e2f80a70]
07be60bc284cbd0630fe7a35d57d76fd3ddd9ba7 test(agentic): verify pinned legal-only native preparation tools [task_cd02622c5259]
edf324c932f854c944cb2ecc37dc075653a4b175 test(agentic): preserve native capability and legal prompt preparation
0e4960a680a0b45666353e95a8b6cb555300edc3 test(agentic): prepare native Root checkpoint replay proof
051e1bbc921a3792a7638abfec3a0daf50ac680f refactor: isolate deterministic official source payload
e98ddee69ffd5fef4c9e0ba8f67d14c3f9090e4d test: prepare legal and researcher evaluation boundaries
df4ae5eb930763a53bd2a24e51574bef3552381c feat(assessment): canonical lifecycle coordinator and persisted reads
5cc2ea8da4a93535e059c40bc195274cc9c2098c task_867e9f693ac9: prepare Assessment Root structural eval fixtures
0b6788178c8c05c25a003bbb8482e1e0969f1255 feat: task_70ba843b8285 canonical assessment persistence expand
6f668296f0444157cab1a8a1ff3244d54db30148 test: task_bb148a9955ce prepare legal source context fixtures
988e51f4d307343f49a0facbcc66aed9e95ae772 feat(contracts): W1.1 canonical assessment runtime
```

### Exact migration path inventory

`A/M/D` are relative to canonical HEAD and describe the checkpoint, not production acceptance. The additional handoff is `docs/architecture/LCSP_AGENTIC_MIGRATION_HANDOFF.md`.

```text
A	apps/api/prisma/migrations/20261005140000_assessment_canonical_persistence/migration.sql
M	apps/api/prisma/schema.prisma
M	apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts
M	apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts
A	apps/api/src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.command.ts
A	apps/api/src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.handler.ts
M	apps/api/src/modules/assessment/application/contracts/assessment/assessment-detail.contract.ts
M	apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts
M	apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts
M	apps/api/src/modules/assessment/application/services/assessment-interview-runtime.service.spec.ts
M	apps/api/src/modules/assessment/application/services/assessment-interview-runtime.service.ts
A	apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts
A	apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts
M	apps/api/src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts
M	apps/api/src/modules/assessment/application/services/assessment-pipeline-continuation.service.ts
M	apps/api/src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.spec.ts
M	apps/api/src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.ts
M	apps/api/src/modules/assessment/assessment.module.ts
M	apps/api/src/modules/assessment/presentation/http/assessment-runtime-control.controller.ts
M	apps/api/src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts
M	apps/api/src/modules/scan/presentation/http/workspace-runtime-events.controller.ts
M	apps/api/src/platform/runtime-events/assessment-runtime-control.service.spec.ts
M	apps/api/src/platform/runtime-events/assessment-runtime-control.service.ts
M	apps/api/src/platform/runtime-events/assessment-runtime-event.service.spec.ts
M	apps/api/src/platform/runtime-events/assessment-runtime-event.service.ts
A	apps/api/src/platform/runtime-events/canonical-assessment-projection.ts
A	apps/api/test/assessment-lifecycle-protocol.test.ts
M	apps/api/test/assessment-runtime-control.e2e-spec.ts
A	apps/api/test/w1-canonical-browser-support.ts
A	apps/api/test/w1-canonical-read-isolation.e2e-spec.ts
M	apps/web/src/features/assessment-runtime/components/atoms/runtime-status-badge.tsx
D	apps/web/src/features/assessment-runtime/components/molecules/workflow-status-row.tsx
M	apps/web/src/features/assessment-runtime/components/organisms/assessment-runtime-sidebar.tsx
A	apps/web/src/features/assessment-runtime/components/organisms/canonical-assessment-status.tsx
M	apps/web/src/features/assessment-runtime/components/organisms/workflow-status-list.tsx
M	apps/web/src/features/assessment-runtime/dev/assessment-runtime-sidebar-preview.ts
A	apps/web/src/features/assessment-runtime/types/canonical-assessment-status.types.ts
M	apps/web/src/features/workspace/components/molecules/assessment-summary-card.tsx
M	apps/web/src/features/workspace/components/organisms/assessment-composer.tsx
M	apps/web/src/features/workspace/components/organisms/assessment-list.tsx
M	apps/web/src/features/workspace/components/organisms/assessment-overview.tsx
M	apps/web/src/features/workspace/components/organisms/assessments-directory.tsx
M	apps/web/src/features/workspace/components/organisms/workspace-dashboard.tsx
M	apps/web/src/features/workspace/components/organisms/workspace-overview.tsx
M	apps/web/src/features/workspace/components/organisms/workspace-runtime-provider.tsx
M	apps/web/src/features/workspace/hooks/use-assessment-runtime-view-model.ts
M	apps/web/src/features/workspace/types/assessment-composer.types.ts
M	apps/web/src/features/workspace/types/assessment-runtime-adapter.types.ts
M	apps/web/src/features/workspace/types/assessment-summary-card.types.ts
M	apps/web/src/features/workspace/types/workspace-overview.types.ts
M	apps/web/src/features/workspace/types/workspace-runtime.types.ts
M	apps/web/src/features/workspace/utils/assessment-composer-control.ts
M	apps/web/src/features/workspace/utils/assessment-runtime-adapter.ts
D	apps/web/src/features/workspace/utils/assessment-runtime-control-presentation.ts
M	apps/web/src/features/workspace/utils/assessment-runtime-formatter.ts
M	apps/web/src/features/workspace/utils/assessment-runtime-selectors.ts
D	apps/web/src/features/workspace/utils/assessment-runtime-usage.ts
M	apps/web/src/features/workspace/utils/workspace-runtime-parser.ts
M	apps/web/tests/agent-stream-usage-footer.test.ts
M	apps/web/tests/assessment-composer-control.test.ts
M	apps/web/tests/assessment-composer.test.tsx
M	apps/web/tests/assessment-native-stop-projection.test.ts
M	apps/web/tests/assessment-runtime-adapter.test.ts
M	apps/web/tests/assessment-runtime-preview.test.ts
A	apps/web/tests/workspace-overview.test.tsx
M	apps/web/tests/workspace-runtime-provider.test.ts
A	deepagents/tests/fixtures/assessment_researcher_isolation/scenarios.json
A	deepagents/tests/fixtures/legal_portfolio_context/pins.json
A	deepagents/tests/fixtures/legal_portfolio_context/synthetic-notice-v1.txt
A	deepagents/tests/fixtures/legal_portfolio_context/synthetic-notice-v2.txt
A	deepagents/tests/fixtures/legal_preparation_eval/cases.json
A	deepagents/tests/fixtures/legal_preparation_eval/native-preparation-prompt.md
A	deepagents/tests/fixtures/legal_preparation_eval/rubric.json
A	deepagents/tests/test_assessment_researcher_isolation_fixtures.py
A	deepagents/tests/test_legal_preparation_eval_fixtures.py
A	deepagents/tests/test_legal_preparation_native_isolation_preparation.py
A	deepagents/tests/test_legal_source_acquisition_boundary_preparation.py
A	deepagents/tests/test_legal_source_context_fixture.py
A	deepagents/tests/test_native_researcher_capability_preparation.py
A	deepagents/tests/test_native_researcher_task_preparation.py
A	deepagents/tests/test_native_root_checkpoint_preparation.py
A	deepagents/tests/test_repository_citation_boundary_preparation.py
A	deepagents/tools/legal/sources/ingest/official_source_payload.py
M	deepagents/tools/legal/sources/recovery/legal_corpus_recovery_driver.py
A	docs/architecture/agentic-production-implementation-plan.md  [already present, byte-identical; not overwritten]
A	packages/contracts/src/assessment/agentic-runtime.ts
M	packages/contracts/src/assessment/events.ts
M	packages/contracts/src/assessment/index.ts
M	packages/contracts/src/evidence/assessment-runtime.ts
M	packages/i18n/src/locales/en/pages.ts
M	packages/i18n/src/locales/vi/pages.ts
M	packages/i18n/src/types.ts
A	reports/agentic-migration-coordinator-ledger.md
A	reports/agentic-w1-integration-gate.md
A	reports/api-ui-event-lifecycle-audit.md
A	reports/architecture-freeze-migration-manifest.md
A	reports/assessment-runtime-audit.md
A	reports/legacy-agent-image-cutover-preparation.md
A	reports/legal-prep-inventory-audit.md
A	reports/state-inventory-audit.md
A	reports/tests-ci-production-audit.md
A	reports/w1-1-independent-review.md
A	reports/w1-2-implementation.md
A	reports/w1-3-implementation.md
A	reports/w1-3-independent-review.md
A	reports/w1-3-r2-persistence-repair.md
A	reports/w1-3-r3-canonical-read-repair.md
A	reports/w1-3-r4-test-contract-alignment.md
A	reports/w1-3-repair.md
A	reports/w1-4-api-browser-preparation.md
A	reports/w1-4-coordinator-acceptance.md
A	reports/w1-4-fixture-activity-visibility.md
A	reports/w1-4-r1-canonical-control-closure.md
A	reports/w1-4-recovery-20261006-075925.patch
A	reports/w1-4-web-canonical-projection.md
A	reports/w1-canonical-read-isolation-preparation.md
A	reports/w2-legal-eval-preparation.md
A	reports/w2-native-legal-isolation-preparation.md
A	reports/w2-native-legal-prompt-preparation.md
A	reports/w2-official-source-payload-refactor.md
A	reports/w2-portfolio-persistence-boundary-preparation.md
A	reports/w2-portfolio-submit-interface-preparation.md
A	reports/w2-source-acquisition-boundary-preparation.md
A	reports/w3-domain-researcher-interface-preparation.md
A	reports/w3-native-checkpoint-preparation.md
A	reports/w3-native-researcher-capability-preparation.md
A	reports/w3-native-task-preparation.md
A	reports/w3-repository-citation-boundary-preparation.md
A	tests/agentic-runtime-contracts.test.ts
A	tests/assessment-canonical-persistence.mjs
A	tests/assessment-lifecycle-migrated-db.mjs
A	tests/assessment-root-eval-fixtures.test.ts
A	tests/fixtures/assessment-root/decision-cases.json
```

## 3. Architecture authority

Read in this order:

1. `reports/architecture-freeze-migration-manifest.md` — authoritative, especially §§1–6, disposition §§7/9, data migration §8, runtime flows §10, DAG §11, and acceptance §12.
2. This handoff for current state, preservation and sequencing.
3. `docs/architecture/agentic-production-implementation-plan.md` — detailed design/context; the Freeze wins over any older shadow/flag, approval, classifier, or naming proposal.
4. `reports/agentic-migration-coordinator-ledger.md` — historical acceptance/recovery/ownership evidence; its newest freeze section supersedes earlier “active worker” statements.
5. `reports/{state-inventory-audit,assessment-runtime-audit,legal-prep-inventory-audit,api-ui-event-lifecycle-audit,tests-ci-production-audit}.md` and `reports/legacy-agent-image-cutover-preparation.md` — discovery/disposition inventories, not a complete release proof. Directly verify current source and callers before deletion.

Frozen invariants:

- Exactly one Legal Preparation Deep Agent authors both LegalRule and EngineeringRule from one pinned immutable corpus. Deterministic code checks source/hash/citation/shape/provenance integrity, not legal meaning; valid complete output automatically activates, with no human legal approval.
- Exactly one assessment-private Assessment Root Deep Agent, created through managed/native `create_deep_agent`, owns applicability, criteria, compliance and report synthesis for the entire pinned portfolio. Generic bounded Repository Researcher children use native `task()`; no one-rule-one-agent dispatcher or custom Python semantic workflow.
- Only `AssessmentLifecycleCoordinator` writes persisted AssessmentLifecycleState (ALS), with expected-revision CAS, row lock, same-transaction ordered event/outbox and idempotent replay. GET/SSE/snapshot/UI are pure projections, never lifecycle writers.
- Canonical ALS: CREATED, PREPARING, ACTIVE, WAITING_FOR_HUMAN, WAITING_FOR_REQUIRED_INPUT, PAUSED, FINALIZING, COMPLETE, BLOCKED, FAILED, CANCELLED. AES: QUEUED, RUNNING, INTERRUPTED, PAUSED, SUCCEEDED, FAILED, CANCELLED. DRS: PENDING, INVESTIGATING, WAITING_FOR_INPUT, RESOLVED, INVALIDATED. Artifact lifecycle (ALCS): BUILDING, ACTIVE, SUPERSEDED, INVALID. Use the existing constant sources and exact frozen transition tables, not aliases, enums or new lifecycle values.
- One server-generated unique AssessmentRuntime thread mapping and at most one active Root lease per assessment. All native descendants retain authorized lineage. Pause/HITL/retry/restart preserve assessment/thread identity.
- API/PostgreSQL owns case/evidence/request/decision/artifact/portfolio truth. Root proposals are not accepted authority until integrity/revision/provenance validation. No duplicate cache, bundle, checkpoint-text or browser authority.
- Four memory scopes only: assessment-private checkpoint/sandbox; authoritative domain rows; sanitized generic learning Store; reviewed procedural skills. Raw facts/source/evidence/answers never cross assessments or enter shared learning. Learning is NON_AUTHORITATIVE_HEURISTIC and cannot be evidence.
- Human Resolution asks only material human-owned facts after tool/repository investigation, never approves a verdict. “I do not know” leaves a request OPEN. No finalization with an open request, required input, stale pin/evidence/decision, missing rule coverage or unresolved execution failure.
- Completion Gate is mechanical, not another judge; artifact must persist/validate before COMPLETE. No final UNKNOWN/PARTIAL/open-question outcome.
- Forward-only expand/archive/validate/backfill/cutover/drop. No semantic V1 backfill, dual writer, shadow evaluator or V1 runtime fallback. Preserve history/retention; rollback snapshot applies only before the first accepted V2 write.

Draft preparation reports are not new specifications. In particular, do not add DRAFT as ALCS, enforce one activation ever per portfolio, or preserve live old approval/recovery/cache writers until W7. Valid audited SUPERSEDED → ACTIVE pointer rollback is frozen; V1 storage/history preservation does not authorize V1 runtime authority.

## 4. Migration status overview

Classification vocabulary: **ACCEPTED**, **IMPLEMENTED_BUT_NOT_GATE_ACCEPTED**, **PREPARATION_ONLY**, **TEST_SCAFFOLD_ONLY**, **BLOCKED**, **OBSOLETE**. “Accepted” below is scoped to the stated subtask; it is not an entire-wave or production release gate.

| Wave | Area                                                             | Status                                                                                                                                  | Evidence                                                                     | Remaining                                                                                                            |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| W0   | Architecture freeze and inventories                              | ACCEPTED Freeze; audits are supporting inventory, not full production proof                                                             | Freeze manifest, plan, five audit reports                                    | Preserve authority; refresh source-specific evidence when implementing                                               |
| W1   | Contracts, expand persistence, lifecycle authority, canonical UI | W1.1–W1.4 ACCEPTED at scoped task/review level; latest usage/preview repair IMPLEMENTED_BUT_NOT_GATE_ACCEPTED; integration BLOCKED/FAIL | Four source commits, review reports; current canonical 200 API/129 web tests | Full W1 gate rerun, live migrated DB/GET/SSE/browser proof and repair any real failures                              |
| W2   | Single legal portfolio vertical                                  | PREPARATION_ONLY; small source-payload refactor implemented but no W2 gate                                                              | Source/context/eval/prompt/isolation/portfolio design preparation            | Versioned DB portfolio, sole submit/validate/activate API, native agent, trigger/read cutover and semantic/live gate |
| W3   | Assessment domain and isolated Root                              | PREPARATION_ONLY / TEST_SCAFFOLD_ONLY                                                                                                   | Structural packets, native task/checkpoint/capability/citation probes        | Domain persistence/tools, durable server-bound Root and generic researcher, native lineage/isolation/restart gate    |
| W4   | Decisions, HITL, absence, finalization                           | BLOCKED — production not started                                                                                                        | W1 structural schemas and Root fixture candidates only                       | Root-authored decisions, native Human Resolution, authenticated coverage, Completion Gate/report vertical            |
| W5   | Full API/web/i18n/event cutover                                  | BLOCKED — production cutover not started; W1 projection subset exists                                                                   | Current canonical UI and W1 tests only                                       | Replace all old runtime/action/Interview/legal admin consumers, real complete browser flow                           |
| W6   | Production archive/backfill/cutover                              | BLOCKED — not started                                                                                                                   | W1 expand-only clean/populated DB test evidence is not W6                    | Quiescence/snapshots/restartable backfill/archive/audited atomic traffic cutover/rollback proof                      |
| W7   | Hard deletion and release proof                                  | PREPARATION_ONLY deletion/image inventory; release BLOCKED                                                                              | Legacy cutover preparation report                                            | Delete replaced code/exports/jobs/images, later DB drops, required CI, staging/canary and all §12 rows               |

## 5. Completed production implementation

### W1.1 canonical contracts — ACCEPTED scoped foundation

`packages/contracts/src/assessment/agentic-runtime.ts`, assessment barrel, event/evidence contract plumbing. Constant-derived types, strict schemas, exact ALS/AES/DRS/ALCS/request transitions, blockers, AssessmentEvent, typed request/decision/evidence packets. No Python lifecycle mirror.

Historical independent review: 770 assertions and 227 state pairs. Current canonical rerun: five runtime-contract tests plus one Root structural fixture test, 6/6. This proves structural contracts, not agent semantics or production HITL.

### W1.2 persistence — ACCEPTED expand-only foundation

`apps/api/prisma/schema.prisma` and ordered `20261005140000_assessment_canonical_persistence/migration.sql`. Adds nullable canonical Assessment state/revision for safe V1 preservation, one-to-one AssessmentRuntime/unique assessment and thread, canonical event ordering/outbox linkage, enums/check constraints/indexes/FKs.

No V1 semantic conversion; existing V1 rows stay canonical-null. Historical migrated PostgreSQL evidence: 96 ordered migrations; 55 V1 tables/21 synthetic rows preserved; 152 expand/replay assertions and 16 protocol assertions. Whole-schema migration drift exit 2 was identical to the V1 baseline and is **not** whole-schema conformance PASS. Current transfer regenerated Prisma Client 7.8.0 and API typecheck, but did not rerun live migrations.

### W1.3 lifecycle/read authority — ACCEPTED scoped foundation

`assessment-lifecycle-coordinator.service.ts`, transition command/handler, create/get handlers, `canonical-assessment-projection.ts`, runtime-control/event services and workspace runtime controller; related continuation/reconciliation/Interview paths now avoid canonical direct writes/read mutation.

Lock + expected revision CAS, guarded transitions, post-lock committed event-ID replay, monotonic per-assessment sequence, atomic row/event/outbox, pure persisted ALS/AES projection. Strict null/malformed/ownership handling; event activity never reconciles lifecycle during GET. Existing legacy pipeline classes remain staged replacement targets, not a claim W3/W5 is done.

Nine canonical foundation API suites pass 200/200 from the canonical workspace. Real durable Root/provider/restart/physical cancellation proof is not implied.

### W1.4 canonical customer projection — ACCEPTED reviewed subset; later repair ungated

Workspace runtime parser/provider/adapter/selectors, canonical status component, composer/actions, summary/directory/dashboard/overview and `packages/i18n`. Read canonical ALS/AES, display explicit unavailable for null canonical data; no invented V1 state fallback. DRS cannot be displayed as authoritative until its future persisted domain source exists. Same-ID stale RUNNING controls cannot override canonical terminal or PAUSED state; only consistent pending commands overlay controls. Dead composer booleans/no-op wrapper removed.

Historical R1 browser evidence: real Playwright sign-in and canonical PAUSED/null-unavailable views against real guarded API/Pg, with explicit 404/409 fixture limits. Not clean production browser/provider proof.

Latest repair: hook reuses existing `projectCurrentRunUsage` directly; deleted redundant `assessment-runtime-usage.ts` and stale control-query plumbing. Tests assert latest native generation, exact provider usage/no estimation, run-scoped usage without native ID, and real canonical-unavailable preview; no fabricated workflow restored. Current 8-file canonical focused run passes 129/129. Historical full web gate failed 592/594; no final post-cleanup full-suite/browser result was harvested. Do not call the latest repair gate-accepted.

### Source acquisition extraction — IMPLEMENTED_BUT_NOT_GATE_ACCEPTED W2-adjacent change

`deepagents/tools/legal/sources/ingest/official_source_payload.py` and recovery-driver call sites factor deterministic source payload construction, preserving bytes/hash/hierarchy/locators/identity metadata. This does not replace the old legal pipeline or make an unverified source accepted. Source-preservation/adversarial mechanical tests pass; actual API rejection of false document identity remains a production requirement/gap to verify.

No W2/W3 production vertical moved beyond this small acquisition refactor and preparation.

## 6. Preparation/scaffolding already available

| Available artifact                                                                                               | Reuse                                                                                                                                                                                                           | Explicit limit                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/w1-canonical-read-isolation.e2e-spec.ts`; corresponding preparation report                        | Real AppModule/auth/RBAC/Prisma canonical present/null, owner/foreign GET/snapshot/SSE/history and unchanged authority rows; exact55441 guard/known-fixture reuse; explicit successful HTTP200 vs failed stream | TEST_SCAFFOLD_ONLY; report claims 3/3 live checks but no final closure receipt was harvested and current DB is absent; no full tenant/provider/broker/Root acceptance |
| `apps/api/test/w1-canonical-browser-support.ts`; W1.4 API/browser/fixture-visibility reports                     | Fresh-only synthetic PAUSEDrev7 and canonical-null fixtures; conflicting RUNNING activity with non-null tool marker reproduces projection separation                                                            | Never reset/reseed an existing fixture; API startup harness lived in /tmp and is not transferred; no reusable clean production browser gate yet                       |
| `tests/assessment-root-eval-fixtures.test.ts`, `tests/fixtures/assessment-root/decision-cases.json`              | Strict decision/HITL packet examples and invalid packet cases                                                                                                                                                   | Authored/static packets, not semantic Root eval                                                                                                                       |
| `deepagents/tests/fixtures/legal_portfolio_context/*`; `test_legal_source_context_fixture.py`                    | Two immutable source versions/pins, bytes, normalized content hashes, definitions/exceptions/cross-references/hierarchy; 15 locators, only art-5::cl-1 changes                                                  | Mechanical preservation, not classifier/legal correctness                                                                                                             |
| `fixtures/legal_preparation_eval/{cases.json,rubric.json,native-preparation-prompt.md}`; legal-eval test/reports | Valid portfolio candidates, fake/stale/orphan/duplicate/context adversaries and draft native Legal Preparation instructions                                                                                     | Draft fixtures/rubric; real reviewed semantic output and API activation unproven                                                                                      |
| `test_legal_source_acquisition_boundary_preparation.py`; acquisition/payload reports                             | Actual parser/fetch/source payload seams and identity/hash mismatch cases                                                                                                                                       | Python mismatch flag does not prove downstream API rejects it                                                                                                         |
| `test_legal_preparation_native_isolation_preparation.py`; native legal isolation report                          | Installed native create_deep_agent with only pinned-corpus read_file; scripted mutation/task/HITL/context denial                                                                                                | Tool advertisement/private permissions are not a server/backend security boundary; no provider/portfolio activation proof                                             |
| `reports/w2-portfolio-{persistence-boundary,submit-interface}-preparation.md`                                    | Inventory existing V1 FKs/DTOs, draft authority/transaction/pin/validation mapping; start serialized W2 contract/schema design from these exact seams                                                           | Not approved new production schemas; no DRAFT ALCS; preserve V1 history but retire replaced live writers at gate; allow audited superseded rollback                   |
| `fixtures/assessment_researcher_isolation/scenarios.json`; researcher fixture test/report                        | Bounded task packets with distinct assessment/source pins, canaries and adversarial scenarios                                                                                                                   | Static task design, not tenant/domain authorization                                                                                                                   |
| `test_native_researcher_task_preparation.py`                                                                     | Real installed native task schema, isolated child prompt, one result/read-only tool/error behavior                                                                                                              | Scripted model, no deployed Root/provider/lineage gate                                                                                                                |
| `test_native_researcher_capability_preparation.py`                                                               | Denied advertised mutation tools plus direct-backend escape demonstration                                                                                                                                       | FilesystemBackend.write bypass is real; future server read-only/sandbox enforcement required                                                                          |
| `test_native_root_checkpoint_preparation.py`                                                                     | InMemorySaver interrupt/Command resume, same-thread state, two-thread isolation                                                                                                                                 | Pre-interrupt tool code replays; idempotency required. No durable Postgres checkpointer/process crash or physical Stop proof                                          |
| `test_repository_citation_boundary_preparation.py`                                                               | Real temporary source/HMAC mint/parse/range/path/replay/commit and live source revalidation; well-formed single-field tampering; bounded fresh-interpreter secret check                                         | Mechanical legacy helper boundary only; process-local secret persistence issue and future V2 tenant/native execution refs remain open                                 |
| `reports/legacy-agent-image-cutover-preparation.md`                                                              | Source/registration/caller/image inventory and corrected merged-rootfs W7 probe procedure                                                                                                                       | Do not scan outer docker-save TAR as filesystem proof. No actual image/pull/export/cutover/removal acceptance was executed                                            |

An attempted final source-integrity API preparation Task produced **no owned test/report on disk**. Classify that attempted Dispatch as OBSOLETE campaign work, not a missing hidden implementation to recreate. Its transcript discovery that source-snapshot intake may persist `documentIdentityVerified:false` is a **hypothesis/source gap to verify in W2**, not an executed API test result.

The original user need-ID test/helper remain separate user WIP; current 8-case focused test passed without modifying their bytes.

## 7. Tests and verification evidence

**TEST PASS does not mean GATE PASS.** Current canonical checks below were actually rerun after transfer. Historical results remain historical, with skipped/resource/environment limits intact.

| Test/command                                                                  | Last result                                                                                                    | Where run                         | Meaning                                                                                      | Must rerun?                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| SHA256 comparison of all133 migration paths and all9 original WIP files       | PASS; zero mismatches, including deletes                                                                       | Canonical after transfer          | Transfer completeness and WIP preservation                                                   | Recheck after any collision resolution                        |
| `git status --short`, `git diff --check`                                      | Dirty expected; diff check PASS                                                                                | Canonical after transfer          | No whitespace damage in tracked diff; untracked inventory separately verified                | Yes before changes/acceptance                                 |
| `pnpm run build:runtime-packages`                                             | PASS                                                                                                           | Canonical                         | Contracts/i18n rebuilt locally, not copied dist                                              | After package edits                                           |
| `pnpm --dir apps/api run prisma:generate`                                     | PASS; Prisma Client7.8.0                                                                                       | Canonical                         | Generated current schema client, not live DB migration                                       | After schema edits                                            |
| Contracts no-emit command in §13                                              | PASS                                                                                                           | Canonical                         | Shared TS consistency                                                                        | W1 gate and after edits                                       |
| API/Web no-emit commands in §13                                               | Both PASS                                                                                                      | Canonical                         | Consumer TS consistency                                                                      | W1 gate and after edits                                       |
| Import/contract/agentic-tool policies                                         | All PASS                                                                                                       | Canonical                         | Static architecture/literal/tool checks                                                      | At every wave gate                                            |
| Runtime contract + Root fixture tests                                         | 6/6 PASS                                                                                                       | Canonical                         | Packet structure only                                                                        | W1 gate/contract edits                                        |
| Nine W1 API specs listed in §13                                               | 200/200,9 suites PASS,10.942s                                                                                  | Canonical                         | Coordinator/control/read/event/legacy guard preservation                                     | W1 gate/affected edits                                        |
| Eight W1 web specs listed in §13                                              | 129/129 PASS, zero skips/cancelled,13.859s                                                                     | Canonical                         | Canonical UI/control/current usage/preview regression                                        | W1 gate/affected edits                                        |
| Eight Python mechanical/source/citation/sandbox/user-WIP suites listed in §13 | 66/66 PASS,4.13s                                                                                               | Canonical                         | Transfer/source/provenance mechanical checks                                                 | Affected edits; not semantic gate                             |
| Four installed-native preparation suites listed in §13                        | 8/8 PASS,4.06s                                                                                                 | Canonical                         | Native advertised task/isolation/in-memory mechanics                                         | Root/legal implementation, with stronger real vertical        |
| API browser/isolation scaffold Prettier + isolation ESLint                    | PASS                                                                                                           | Canonical                         | New harness syntax/style/types; no live DB proof                                             | Harness edits                                                 |
| `graphify update . --no-cluster`                                              | PASS;26932 nodes/69368 edges; SQL dependency and existing smoke parse warnings                                 | Canonical                         | Local AST index refreshed, not copied graph/runtime data                                     | After code edits; validate source directly                    |
| Historical W1 exhaustive independent review                                   | 770 assertions/227 pairs PASS; fresh gate227 pairs/69 legal edges PASS                                         | Integration                       | Exact frozen transition topology/guards                                                      | Yes fresh holistic W1                                         |
| Full API Jest at4GiB                                                          | 187 passed suites/1222 passed tests;7 suites/22 optional/environment skips                                     | Integration                       | Historical full local test result; default heap OOM was NOT PASS                             | Yes W1; account for skips                                     |
| Full web gate                                                                 | FAIL:592/594, stale generation usage + fabricated preview assertions                                           | Integration                       | W1 gate FAIL; repair now present                                                             | YES full current source                                       |
| Worker full web before final helper deletion                                  | Reported595/595 PASS                                                                                           | Integration, before final cleanup | Not proof of final transferred source                                                        | YES; final rerun receipt unavailable                          |
| PostgreSQL foundation runners                                                 | Historical16 protocol +152 expand/replay assertions PASS;96 migrations/55 V1 tables/21 rows preserved          | Isolated integration55437/55432   | W1 scoped DB/CAS/event/null/upgrade evidence; identical V1 drift exit2 not whole-schema PASS | YES with independently verified disposable targets            |
| Read-isolation live e2e                                                       | Historical3/3 directly verified before closure; final report also claims3/3; final closure receipt unavailable | Isolated integration55441         | Real auth/read scope, broker stub; current patched live proof NOT rerun                      | YES; target absent now                                        |
| W1.4 Playwright actual UI                                                     | Historical R1 PAUSED + unavailable flow PASS, known404/409                                                     | Integration3310/3311 +55439       | Real rendered canonical projection subset, not full W5/§12                                   | YES against canonical source, final repaired code             |
| Chrome DevTools                                                               | Environment-blocked: headful browser needs X server                                                            | Integration                       | No clean console/DevTools PASS                                                               | Reconfigure approved headless/X prerequisite; disclose limits |
| Remote CI, production provider/outbox/checkpointer/image, full §12 matrix     | NOT RUN/NOT PROVEN                                                                                             | No new remote run                 | No production release evidence                                                               | Required at corresponding gates                               |

Full API/web/CI and real migrated W1 DB/SSE/assessment-browser gates were not rerun during consolidation. The Playwright addendum did rerun the existing fixture-backed browser suite: 13/13 PASS in 28.4s, and performed an actual MCP sign-in-page smoke from canonical Next3310. See the dedicated browser section below for exact commands, scope and environment failures. Neither result changes the W1 gate FAIL. Minimum transfer checks passed; this operation intentionally did not finish W1 or implement later waves.

## 8. Known environment/runtime issues

- Orca terminal-scoped IPC repeatedly failed while useful work remained in shared source. Exact abandoned Dispatches were fenced and artifacts preserved; replacement closures never restarted implementation from HEAD. At final freeze, runtime observed `e80fa8d4-cdd0-4cb5-92c8-6d626923faa6` had auto-fenced the three latest terminal-missing workers; no active Dispatch remained. No restart/rebind was performed by this coordinator. **Not an active canonical implementation blocker: do not depend on Orca.**
- Historical abandoned/fenced terminals are read-only. Do not send continue or use codex resume. Their historical failure status does not invalidate harvested source or prove tests passed.
- Browser Next3310/API3311 are **not listening at final handoff**. During the addendum, canonical Next3310 was started, its listener and HTTP200 were verified, and Playwright MCP rendered the sign-in page; it was then stopped. API3311 stayed absent, so workspace BFF requests returned503. The separate fixture suite started/stopped Next3100 and fixture3102 automatically and passed13/13. Former guarded API harness was /tmp-only and is not transferred; use canonical real AppModule/startup with explicitly scoped test env. Do not assume a report's “server running” is current.
- Former task-owned isolated PostgreSQL containers on55432/55437/55439/55441 were absent in final docker/port inspection. `55443/lcsp_w2_source_integrity` was reserved but produced no harvested scaffold. No DB/container bytes were copied. Historical identifiers:
  -55437: `lcsp_api_w13_r2_repair`, migrated protocol runner.
  -55439: `lcsp_w14_browser`, browser fixture.
  -55441: `lcsp_w1_read_isolation`, read-isolation fixture.
  -55432: W1 expand/upgrade runner's isolated test target; inspect its exact script identity before provisioning.
- Only unrelated `fogewise-postgres`5432, `fogewise-redis`6379 and `fogewise-rabbitmq`5672/15672 were running. Never treat those as disposable migration services or publish old commands into that broker.
- Read-isolation e2e and historical browser harness stub only the RabbitMQ edge. Real Nest/auth/RBAC/Prisma/read paths are exercised; actual broker/outbox/provider execution, billing and durable Root checkpoints are not.
- Synthetic browser fixture: email `w1-4-browser-owner@invalid.test`, password `W1CanonicalBrowserFixture!2026`; canonical-present assessment `2e8b6fc8-2cb0-4b74-9b9e-8b1a7c0af8c1`, unavailable assessment `3d9c7ad9-3dc1-4c85-a1c0-9f7df4d0d2a7`. These are public synthetic test values, not production credentials. Known409 RUNTIME_CONTROL_TARGET_STALE/404 graph responses reflect missing old control/repository fixture prerequisites; not physical Stop or clean console proof.
- Headful DevTools lacked X; Playwright rendered actual flows historically. Do not kill/clear a competing browser profile or claim DevTools success without output.
- Full Web suite's unchanged admin locale QueryClient timers can retain a process about5 minutes. Do not label it OOM/hung or start duplicates merely for that known delay. Historical large DOM equality failures did cause memory-amplified stuck child processes; terminated runs were not PASS.
- Installed Python versions verified in canonical environment: deepagents0.7.17, langchain1.4.2, langchain-core1.6.4, langgraph1.2.11. Native probes use scripted models/InMemorySaver; private permissions/direct backend and interpreter-secret boundaries need production enforcement.
- AST refresh skips96 SQL migrations without tree_sitter_sql and warns on existing `apps/api/test/smoke.e2e-spec.ts` parse line84. Graph absence is not source absence; do not infer deletion/security from indexing coverage.

## 9. Remaining architecture work

### W1 remaining

Objective: finish present usage/preview repair acceptance and freeze the actual foundation as a whole, without rebuilding accepted W1.1–W1.4.

Inspect first: gate report; `agentic-runtime.ts`; canonical migration; lifecycle coordinator/projection/control/event/GET/SSE source; current hook and usage projection; current 8 web specs; browser/isolation fixtures.

Prerequisite: current source/dirty WIP preserved and fresh disposable DB/browser services correctly isolated. Exit: shared/API/web typechecks + policies + full current suites; exhaustive exact transition/guard matrix; real concurrent stale-CAS rejection, same-transaction row/event/outbox rollback, monotonic ordering/idempotency; authoritative GET/snapshot/SSE agree; no UI lifecycle derivation/writer/fallback or legacy canonical values. Explicitly separate scoped W1 evidence from all §12 production provider/Root gates. Failed/partial gate blocks W2/W3; repair root cause and rerun.

### W2 remaining

1. Freeze actual portfolio submit/read/provenance contract after W1 passes. Inspect current legal catalog/corpus DTOs and preparation reports. Preserve frozen ALS/AES/ALCS, separate server identity/pins from agent-authored meaning.
2. Serialize schema/ordered migration: LegalPortfolioVersion, versioned LegalRule, first-class EngineeringRule, legal context relations/provenance, activation audit/history and one active pointer. Existing V1 LegalRule FKs/history must not be destructively repointed; draft LegalPortfolioRule storage proposal is not a contract alias. Test BUILDING/ACTIVE/SUPERSEDED/INVALID and audited rollback.
3. Replace API legal write authority in `apps/api/src/modules/legal-rule-catalog`: one submit → integrity validate → atomic activate transaction; idempotency/concurrency; invalid result leaves previous ACTIVE unchanged; actual hash/identity/effect/locator/pin rejection and coverage/duplicate/orphan validation. No deterministic legal/normative judge or approval.
4. Separate `create_legal_preparation_agent` from `deepagents/agent.py`'s Triage coupling; author both layers against one corpus, retain definitions/scope/exceptions/qualifiers/cross-refs/non-repository duties. No assessment/customer/repository context, human handoff or model Scanner. Use native Deep Agents tools/skills, not custom orchestration.
5. Registered source-change/admin preparation triggers use that single command; unwired daily prompt is not a live scheduler. Assessment `rule_sources.py` only reads/pins the DB ACTIVE portfolio, never recovers/compiles/caches it.
6. Retire replaced triage/manual draft/approve/signoff/publish/discard/recovery semantic writers and duplicate classifiers/cache/bundle authorities after replacement gate, while preserving V1 history/FKs until safe later drops. Update legal admin/i18n and reviewed skills.

Prerequisite: W1 gate, then serialized contract/schema before consumers. W2 acceptance: live pinned corpus → complete context-preserving portfolio → automatic activation; every in-scope provision covered or agent-declared non-assessable with reason; organizational/document duty represented; fake/stale/repealed refs/duplicates/orphans reject; failure preserves old ACTIVE; zero approval endpoint/row dependency; exactly one runtime API portfolio reader; reviewed semantic evals, not only scripted fixtures.

### W3 remaining

1. Serialize next schema migration after W2 schema: AssessmentCase, AssessmentEvidence with SEARCH_COVERAGE subtype, HumanResolutionRequest, RuleDecision immutable history/latest/DRS constraints, AssessmentArtifact metadata.
2. In API assessment/evidence modules implement authorized case/evidence/request/decision tools and structural DecisionValidator: tenant/source pin/hash/citation/actor/revision/execution lineage, CAS/idempotency and stale dependent invalidation. Reuse mechanical evidence-ref/HMAC/source validators; remove legacy criterion semantics, not integrity protection.
3. Implement sole `create_assessment_root_agent` entrypoint with server-owned AssessmentRuntime.threadId, deployed durable LangGraph checkpointer, unique lease, pinned portfolio/repository/case, execution/event/usage mapping and idempotent tool replay.
4. Generic bounded Repository Researcher through native task(), server-enforced read-only/sandbox source tools; no separate per-rule Root/thread, direct dispatcher or decision/domain/shared-memory mutation. Keep deterministic snapshot/hydration/index/source tools; replace model-driven Scanner/callback semantic gates.
5. Bind four memory scopes; assess-private canary isolation under same/different users/tenants/repo/portfolio; governed typed SANITIZED_GENERIC promotion/injection/privacy/dedup/versioning; no raw episode promotion, historical-thread lookup or evidence from learning Store.
6. Replace startup/resume/control adapters with exact same-thread native execution; actual authorization, provenance, lifecycle command ingress, provider usage/billing, outbox/checkpointer and crash/restart proof. Delete replaced Interview/per-rule/targeted/custom registry runtime routes after gates and safe pending-delivery migration.

Prerequisite: W1 gate and accepted W2 active portfolio/pins; schema/tool contracts before Root. W3 acceptance: exactly one authorized Root thread/active lease per assessment; descendant refs; accepted facts/evidence survive compaction/process restart; children cannot mutate domain decisions; disjoint tenants/assessment/thread/sandbox/store namespaces; all pinned EngineeringRules covered; real production-shaped API/Pg/checkpointer/provider tests, not InMemory/scripted advertisement only.

### W4 remaining

Implement Root-authored applicability APPLICABLE/NOT_APPLICABLE, applicable criteria MET/NOT_MET and COMPLIANT/NON_COMPLIANT packets and DRS coverage; structural/provenance validator never rejudges meaning. Remove deterministic applicability/evaluator as authorities when replacement verified.

Implement investigate-before-ask instructions/evals; material human fact request with decision impact, server-owned actor/case/evidence revision, LangGraph interrupt and exact-thread resume only when blockers clear. Unknown answer stays OPEN; permanently unavailable fact maps to exact frozen BLOCKED reason via coordinator, not final unknown verdict.

Accept authenticated searched scopes/queries/entrypoints/index gaps/direct-source fallback as SearchCoverageEvidence; Root judges bounded absence, missing coverage never deterministic non-compliance.

Completion Gate blocks any missing/unresolved/stale/failed condition. Root synthesizes an immutable report from frozen accepted decisions, validates sections/pins/refs/hash/no unresolved language, persists artifact, then sole coordinator commits COMPLETE. DocumentRequest references artifact, not duplicate authority. Remediation recommendations are Root report content; PR/code-change approval is outside assessment completion.

Prerequisite: accepted W3 domain/runtime. Acceptance: reviewed semantic evals across all positive/negative/NA/HITL/absence cases, no second judge, every negative completion invariant rejects, and one fully closed real assessment reaches COMPLETE with no UNKNOWN/PARTIAL/open-question language. Stop/Continue/retry/crash/HITL are same-thread/idempotent; Cancel terminal.

### W5 remaining

Cut all API/BFF/runtime reads/events/controllers/action availability and web/i18n consumers to canonical Assessment/Runtime/Event/HumanResolution/artifact/portfolio. Remove old Interview/stage/readiness lifecycle projection, stream/status contract duplication and fallback; retain generic auth/outbox/accounting/resource-local scan/request states without giving them lifecycle authority. Admin legal UI offers preparation/history, not publish/discard.

Inspect `apps/api/src/platform/runtime-events/stage-lifecycle.ts`, old Interview/readiness/controllers/DTOs, web assessment-flow and old legal/admin routes, `packages/contracts` exports and all i18n copies. W1 does not prove these all absent.

Prerequisite: W2–W4 accepted response/tools/artifact path. Acceptance: real create → repository-only investigation → material question/answer → Stop/Continue → finalized report/download/terminal flow against V2 API-backed records; GET/SSE/selectors/controls agree on persisted ALS; no mutation/inference/fallback; actual Playwright plus console/network evidence and limits.

### W6 remaining

Quiesce V1 workers and drain/cancel/audit obsolete legal-recovery/Interview/targeted commands; snapshot DB, checkpoint, artifact store and exact deployed images. Build validated V2 ACTIVE portfolios before new assessments pin anything.

Implement an idempotent/restartable forward migration on production-shaped populated copy: preserve source bytes/identity/hierarchy/hash/history; archive old catalog/approval/matches and cache/bundle artifacts as non-authority; archive terminal V1 assessments/reports; preserve non-terminal ID/tenant/scope, backfill only provenance-accepted facts/evidence, pin validated repository + V2 portfolio, allocate one new V2 thread and PREPARING state, initialize coverage for fresh Root re-evaluation. Do not resume V1 checkpoints or promote old semantic decisions. Validate/migrate exact material questions, otherwise supersede and reinvestigate. Archive targeted requests/old turns/events/manual checkpoints; preserve generic outbox/idempotency/billing reconciliation and artifact/history retrieval. VerifiedAgentEpisode stays assessment-private history; shared learning starts empty.

Validate counts/hashes/FKs/pins/revisions/questions/unique threads/artifacts/replay/accounting; rerun backfill with no duplicate effects. Atomically switch all API/worker/web readers/writers, no dual writer or shadow evaluator. Verify zero old delivery/active execution/unpinned V2/shared raw memory. Pre-first-V2-write restore point must be proven; after first accepted V2 write, forward repair only.

Prerequisite: W2–W5 acceptance and explicit production permissions/snapshots/quiescence. Gate: clean install + populated V1 upgrade, idempotent second run, sampled reconciliation, eligible privacy/retention/archive retrieval, zero old traffic and verified rollback boundary. W1 expand test is not this gate.

### W7 remaining

After W2–W6 gates, hard-delete the old runtime/import/contract/job/skill/image paths from Freeze §§7/9; remove obsolete seeds/fixtures/tests only when required replacements are green. Drop old active tables/columns in a later forward migration after archive/retention/upgrade verification; historical SQL migrations remain.

Audit source + direct callers + import graph + actual built runtime image merged filesystem, not outer docker-save archive names. Update instructions/FLOW/skills/docs and required CI checks. Run production-shaped staging every §12 row, deploy only with authorization, execute sanitized synthetic canary, reconcile logs/billing/events. Verify assessment deletion/retention/revocation and unaffected other assessments.

Prerequisite: all previous gates and destructive/release authority. Exit: complete matrix in §15 with reproducible output, no deleted architecture import/path/image/flag, required CI green for exact release head, staging/canary pass. No remote action was authorized by this handoff operation.

## 10. Legacy deletion ledger

### Already removed

Confirmed by checkpoint diff and canonical absent-path/hash checks:

- `apps/web/src/features/assessment-runtime/components/molecules/workflow-status-row.tsx`.
- `apps/web/src/features/workspace/utils/assessment-runtime-control-presentation.ts` (legacy/no-op wrapper).
- `apps/web/src/features/workspace/utils/assessment-runtime-usage.ts` (redundant stale-control usage wrapper).
- Changed W1 workspace adapter/status/composer paths no longer derive their canonical ALS from old stages or missing data; dead composer fallbacks removed. This is a scoped rewrite, **not** proof that every browser lifecycle inference is removed.

No complete Scanner, Interview, per-rule, legal approval, semantic evaluator or targeted architecture family is marked removed.

### Still must be removed

Current source search/graph routing plus direct known-file checks confirms these families remain. Discovery reports are not safe deletion scripts; trace current callers and pass replacement/archive gates first.

| Legacy requirement                               | Current source/evidence                                                                                                                                                      | Removal gate                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Scanner reasoning                                | `deepagents/tools/common/capabilities/evidence/repository_analysis/{analyzer,boundary}.py`; old scan command registration                                                    | W3 deterministic source tools + Root discovery; W5/6 cutover                                    |
| Mandatory Initial Interview                      | `.../investigation/engineering_rule/interview_gated_boundary.py`, API Interview service                                                                                      | W3 Root startup/Human Resolution, W4/5/6                                                        |
| Interview lifecycle agent                        | `deepagents/subagents/interview/definition.py`, recovery Interview boundaries                                                                                                | Same-thread W3/4 HITL/restart then safe archive                                                 |
| interview-context package                        | **`deepagents/skills/interview-context/`**, not a packages/interview-context npm package                                                                                     | Reviewed human-resolution skill + caller/CI cutover                                             |
| One-rule-one-agent execution                     | `.../rule_assessment/run.py::analyze_rule`, `orchestration/dispatcher.py::RootSubagentDispatcher`, repository_analyst definition                                             | W3 native generic researcher/Root coverage                                                      |
| Python semantic orchestration                    | `engineering_assessment_boundary.py`, orchestration context/lifecycle/dispatcher                                                                                             | W3/4 Root/tool/coverage gate                                                                    |
| Targeted reanalysis state machine                | `evidence/repository_analysis/targeted_boundary.py`, API/BFF/Prisma TargetedReanalysisRequest/Checkpoint                                                                     | Same-thread invalidation/research + W6 drain/archive                                            |
| Custom continuation/readiness registries         | `orchestration/waiting_assessments.py`, `workflow/recovery/{interview_boundary,interview_pause_boundary,post_guard_continuation}.py`, old readiness APIs                     | W3/4 native checkpoint/lease/outbox proof                                                       |
| Deterministic applicability authority            | `planning/engineering_rule/{rule_applicability_gate,rule_applicability_evaluator}.py`                                                                                        | W4 Root applicability eval + zero semantic callers                                              |
| Deterministic semantic EngineeringRule evaluator | `evaluation/engineering_rule/rule_evaluator.py::EngineeringRuleEvaluator`, result/completion adapters                                                                        | W4 Root compliance + structural validator                                                       |
| Human legal approval/signoff                     | `legal-corpus.service.ts::requireApprovedReviewSignoff` (current call1087), draft/approve/publish/discard routes, approval tables/contract policies                          | W2 automatic complete portfolio gate; later historical table drop                               |
| Duplicate legal classifier                       | API `rule-catalog-version.service.ts::recoverApprovedRulesFromActiveCorpus`, `legal-corpus.service.ts::legalChunkNormativeClass`; Python compilation/chunk normative filters | W2 agent authors both layers; integrity-only validator                                          |
| Assessment-triggered legal recovery              | `rule_sources.py`, `legal_corpus_recovery_driver.py` and readiness/recovery registration                                                                                     | W2 ACTIVE DB portfolio read-only; no lazy compile                                               |
| Duplicate caches/precompiled authority           | EngineeringRuleService get_or_compile/`_retarget_cached_rules` (current69/237), Chroma cache, bundle/import/export/restore, Docker COPY                                      | W2/3 sole reader then W6/7 file/image deletion                                                  |
| WAITING_RULE                                     | Exact token search currently only documentation; **waiting-assessments registry/custom triage resume still exists**, so the architectural obligation is NOT closed           | W3 native continuation; remove registry/runtime semantics                                       |
| Final UNKNOWN/PARTIAL decision states            | Old evaluator `UNKNOWN`, old rule/result/callback/Prisma contracts                                                                                                           | W4–W7 V2 decisions/report no unresolved outcome; retain only genuine coverage/resource metadata |
| NEEDS_CONTEXT lifecycle                          | `rule_assessment/values.py:24`, `packages/contracts/src/evidence/rule-assessment.ts:33`, old Interview handoffs                                                              | W3/4 typed requests/DRS, W5 contract cutover                                                    |
| API lifecycle duplication                        | `stage-lifecycle.ts::deriveStageLifecycles` and old Interview/readiness/runtime DTOs still present                                                                           | W5 full read/event cutover, W6 history                                                          |
| Browser lifecycle inference                      | W1 primary workspace paths repaired; remaining old assessment-flow/readiness/legacy status consumers require full inventory                                                  | W5 actual browser/API gate then removal                                                         |
| V1 fallback paths/flags/imports                  | Old Root/Triage registries, invocation manifest, cached rule retarget/restore/bundle, old contracts/routes/docs                                                              | W2–W6 gated replacement; W7 exact image/import/source absence                                   |

Keep deterministic source acquisition/hash/citation/tenant/CAS/billing/auth/outbox guards and resource-local statuses. Do not remove shared model route config solely because one legacy role is removed; report lists identified surviving consumers. Preserve SQL history.

## 11. Current blockers and risks

**P0**

- W1 holistic integration gate remains FAIL. Full current web rerun and actual canonical live DB/GET/SSE/browser acceptance are outstanding, despite focused repair tests now passing. W2/W3 production cannot start until W1 passes.
- All W2–W7 production verticals/acceptance are unimplemented/unproven. Required semantic decisions must not be delegated to remaining V1 authorities or fixture scripts.

**P1**

- Isolated DB/browser prerequisites are absent; recreate only independently verified disposable targets from canonical conventions. Do not use unrelated fogewise5432/5672.
- Durable Root/checkpointer/server authorization/read-only backend and request/idempotency/restart contracts are not implemented. Current native private permissions and process-secret probes expose boundaries, not production security.
- Source identity false/mismatch rejection at the actual API intake needs direct evidence and repair in W2; Python preservation tests alone are insufficient.
- Historical whole-schema drift is unchanged baseline exit2, not conformance proof; diagnose before claiming complete clean/upgrade acceptance.

**P2**

- Large full suites require suitable memory; optional skips and long QueryClient timers must remain explicit.
- Browser fixture lacks clean old-control/repository prerequisites, DevTools headful X unavailable historically; migrate to actual V2 browser gates, do not waive failures.
- Existing user WIP touches future deletion/rewrite targets; preserve it and review overlaps before W3/W7.
- SQL/smoke graph extraction limits and outdated partial audit/prose require direct source verification.

Historical Orca IPC instability is **resolved by ending the campaign**, not an active source blocker. No known credential or production permission has been tested/assumed. Obtain genuine external/destructive/deployment authority when required.

## 12. Exact next execution order

One agent, no Orca Task creation, no new coordinator. At each failed gate, stay in that step, diagnose root cause, patch narrowly, rerun actual checks. Do not restart accepted foundation or skip hard prerequisites.

1. **Reconcile the current tree.** Read this file and Freeze, `git status -uall`, current source/diff and original WIP table. Inspect latest hook/usage/preview and API scaffold. Confirm deleted wrappers have zero real callers. Run §13 cheap checks. Exit: no lost WIP/source, final repair understood; no new architecture.
2. **Finish W1 acceptance.** Inspect gate report, coordinator/contracts/migration/projection/control/GET/SSE/browser fixtures. Run full API/web/type/policy/transition matrix, guarded migrated PostgreSQL concurrency/atomicity/replay tests and real canonical GET/SSE/browser. Repair only observed failures, preserving V1 null/unavailable and pure reads. Exit: documented fresh **W1 GATE PASS**, with later §12 unproven boundaries explicit.
3. **Freeze W1, implement W2 contract/schema/API first.** Read portfolio draft reports plus real DTO/FK/source/citation validators. Freeze submit/read contract, ordered expand migration, versioned portfolio/context/audit and one atomic activation boundary; actual identity/hash/stale/fake/orphan/idempotency/concurrency tests. Exit: validated DB/API boundary, no semantic deterministic judge or approval.
4. **Implement the single native Legal Preparation and legal cutover.** Inspect agent/triage/skills/registered source detector/rule_sources/cache/admin; reuse corpus/rubric/prompt/isolation prep. Author both rule layers, automatic complete activation, source/admin triggers and sole DB ACTIVE reader; retire replaced legal semantic writers safely. Run reviewed semantic/live W2 positive/negative/context/non-repo/supersession/rollback tests. Exit: **W2 GATE PASS**.
5. **Implement W3 domain persistence/tools.** Inspect W1 runtime schema and current evidence/provenance validators, Root packet/researcher design fixtures. Add ordered case/evidence/request/decision/history/coverage/artifact schema and authority-checked tools/CAS/idempotency/invalidation. Exit: actual real DB/tenant/ref/revision tests pass; contracts frozen before runtime consumer.
6. **Implement isolated durable Assessment Root/native researcher.** Inspect agent/dispatcher/invocation/current snapshot/sandbox/index and native probes. Bind one server thread/lease/durable checkpointer, all-portfolio Root, native bounded generic task, enforced read-only backend and private memory/usage/events; remove replaced startup Scanner/Interview/per-rule semantics after gates. Run real restart/compaction/lineage/tenant/canary/coverage/concurrency. Exit: **W3 GATE PASS**.
7. **Implement W4 decisions/HITL/absence.** Inspect decision/request schemas, legacy evaluator/applicability/ask and prepared semantic scenarios. Root owns all meaning; structural validator, native fact interrupt/unknown-answer/open-request/same-thread answer, authenticated bounded coverage, stale invalidation. Run reviewed semantic positives/NA/negative/investigate-before-ask/unknown/no-second-judge tests. Exit: decision/HITL/absence gate criteria pass.
8. **Implement completion/artifact and pass W4.** Inspect current report/DocumentRequest and canonical finalization guards. Freeze accepted decisions, reject every unresolved/stale/failed condition, Root-authored immutable report/hash/refs, persist then COMPLETE. Run negative gate matrix plus real positive closed assessment, Stop/Continue/retry/crash/cancel. Exit: **W4 GATE PASS**, no UNKNOWN/PARTIAL/question placeholder.
9. **Complete W5 API/Web/events/i18n cutover.** Inspect old stage/Interview/readiness/BFF/assessment-flow/admin/legal/export consumers, not just repaired workspace paths. Cut to canonical tools/event/requests/artifact; remove inference/fallback/copy. Run real Playwright full create/question/answer/pause/resume/report/terminal/download + console/network/SSE/API equality. Exit: **W5 GATE PASS**.
10. **Prepare and execute W6 on authorized production-shaped copy.** Inspect Freeze§8 object-by-object, actual pending outbox/workers/retention and existing data. Quiesce/snapshot, validated ACTIVE portfolios, restartable forward archive/backfill/new V2 threads without semantic promotion, counts/pins/hashes/tenant/history/billing/replay/idempotent rerun, verified prewrite rollback, atomic traffic cutover. Exit: **W6 GATE PASS**, zero old runtime authority/delivery. Destructive/production permissions must be explicit.
11. **W7 hard deletion and required CI.** Inspect §10 ledger/Freeze§9, trace every caller, registrations/images/scripts/skills/docs. Delete only replaced and archived paths; later forward schema drops; corrected merged-rootfs image absence. Run source/import/contract/image absence, clean/upgrade tests and exact-head required CI replacements. Exit: **W7 deletion/release gate PASS**, not only local grep.
12. **Full production acceptance/release proof.** Run every §15 row with real API/Pg/outbox/checkpointer/images, reviewed semantics and Playwright; authorized staging/deploy/synthetic canary/sanitized observability/accounting/deletion. Exit: all rows evidenced PASS, no residual blockers or unexplained skips. Only then declare production completion.

## 13. Commands to resume

All commands run from canonical source; shell commands use RTK per repository instructions. These command names/configs were checked in repository scripts. Conditional commands below are recipes, **not claims executed during consolidation**.

```bash
cd /home/khovan/Workplaces/LCSP
rtk proxy git branch --show-current
rtk proxy git rev-parse HEAD
rtk proxy git status --short --untracked-files=all
rtk proxy git diff --stat
rtk proxy git diff --check

# Bootstrap only if dependencies are absent; do not copy old node_modules/venv.
rtk proxy pnpm install --frozen-lockfile
rtk proxy uv sync --project deepagents --extra dev

# Rebuild local generated consumers before checking API/Web.
rtk proxy pnpm run build:runtime-packages
rtk proxy pnpm --dir apps/api run prisma:generate
rtk proxy pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit --incremental false --composite false
rtk proxy pnpm --dir apps/api exec tsc --noEmit --pretty false
rtk proxy pnpm --dir apps/web exec tsc --noEmit --pretty false
rtk proxy pnpm run check:imports
rtk proxy pnpm run check:contracts
rtk proxy pnpm run check:agentic-tools
rtk proxy pnpm exec tsx --test tests/agentic-runtime-contracts.test.ts tests/assessment-root-eval-fixtures.test.ts

rtk proxy env NODE_OPTIONS='--experimental-vm-modules --max-old-space-size=4096' pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand \
  src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts \
  src/platform/runtime-events/assessment-runtime-control.service.spec.ts \
  src/platform/runtime-events/assessment-runtime-event.service.spec.ts \
  src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts \
  src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts \
  src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts \
  src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts \
  src/modules/assessment/application/services/assessment-interview-runtime.service.spec.ts \
  src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.spec.ts

rtk proxy pnpm --dir apps/web exec tsx --tsconfig tsconfig.test.json --test --test-concurrency=1 \
  tests/assessment-composer-control.test.ts tests/assessment-composer.test.tsx \
  tests/assessment-native-stop-projection.test.ts tests/assessment-runtime-adapter.test.ts \
  tests/workspace-runtime-provider.test.ts tests/workspace-overview.test.tsx \
  tests/agent-stream-usage-footer.test.ts tests/assessment-runtime-preview.test.ts

rtk proxy env PYTHONPATH=deepagents deepagents/.venv/bin/python -m pytest -q \
  deepagents/tests/test_legal_source_context_fixture.py \
  deepagents/tests/test_legal_source_acquisition_boundary_preparation.py \
  deepagents/tests/test_legal_preparation_eval_fixtures.py \
  deepagents/tests/test_assessment_researcher_isolation_fixtures.py \
  deepagents/tests/test_repository_citation_boundary_preparation.py \
  deepagents/tests/investigation/test_direct_repository_claims.py \
  deepagents/tests/test_repository_sandbox.py deepagents/tests/test_rule_assessment_need_id.py
rtk proxy env PYTHONPATH=deepagents deepagents/.venv/bin/python -m pytest -q \
  deepagents/tests/test_native_researcher_task_preparation.py \
  deepagents/tests/test_native_researcher_capability_preparation.py \
  deepagents/tests/test_native_root_checkpoint_preparation.py \
  deepagents/tests/test_legal_preparation_native_isolation_preparation.py

# Full local W1 checks — still required, not rerun during consolidation.
rtk proxy env NODE_OPTIONS='--experimental-vm-modules --max-old-space-size=4096' pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand
rtk proxy env NODE_OPTIONS='--max-old-space-size=4096' pnpm run test:web:run
rtk proxy pnpm run typecheck
rtk proxy pnpm run lint
rtk proxy graphify update . --no-cluster
```

Isolated read-isolation reproduction: FIRST verify exact port/container absence or validated known-fixture reuse; inspect `ensure-test-postgres.mjs` and scaffold guard. Never use the generic reset helpers on existing targets.

```bash
rtk proxy env LCSP_TEST_POSTGRES_PORT=55441 LCSP_TEST_POSTGRES_DB=lcsp_w1_read_isolation LCSP_TEST_POSTGRES_USER=postgres LCSP_TEST_POSTGRES_PASSWORD=postgres node apps/api/test/scripts/ensure-test-postgres.mjs
rtk proxy env DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w1_read_isolation?schema=public' pnpm --dir apps/api run prisma:migrate:deploy
rtk proxy env DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w1_read_isolation?schema=public' NODE_OPTIONS='--experimental-vm-modules' pnpm --dir apps/api exec jest --config ./test/jest-e2e.ts --runInBand test/w1-canonical-read-isolation.e2e-spec.ts
```

Canonical migrated DB runners: `rtk proxy node tests/assessment-lifecycle-migrated-db.mjs` and `rtk proxy node tests/assessment-canonical-persistence.mjs <explicit-local-evidence-directory>`. Inspect their hardcoded targets/freshness/data mutations first; provision only exact isolated PostgreSQL where necessary. Do not substitute configured development/production DATABASE_URL, db push or reset for ordered migrations. Do not claim identical baseline drift means complete conformance.

Browser: `pnpm run test:admin:e2e` / `pnpm run test:billing:e2e` are verified existing commands, but `playwright.config.ts` starts a **billing API fixture3102 and Next3100**, not the real V2 API. They are not W5 production acceptance. For actual W1/V2 flows, use Playwright MCP against canonical real API/Next services and retain console/network evidence. Next command for a verified real upstream3311 is:

```bash
rtk proxy env LCSP_API_BASE_URL=http://127.0.0.1:3311 LCSP_MOCK_MODE=false NEXT_PUBLIC_LCSP_MOCK_MODE=false pnpm --dir apps/web exec next dev --hostname 127.0.0.1 --port 3310
```

Real API bootstrap uses `apps/api/package.json` start/start:dev/start:prod with verified explicit environment and DB; no old /tmp harness dependency. Recreate test infrastructure deliberately, do not connect to unrelated broker/provider via inherited .env.

Current CI conventions: `.github/workflows/test.yml` runs runtime-package build/type/static checks, API `test:e2e`, Python pytest and legacy Interview production vertical. `rtk proxy pnpm --filter @lcsp/api test:e2e` **includes a schema-reset step on disposable55434/lcsp_api_e2e**: inspect/verify dedicated fresh target and permissions before running it; never point it at user data. `rtk proxy uv run --project deepagents --extra dev pytest` is the repository Python suite convention. Existing legacy CI is not the new full §12 matrix; replace/require V2 checks at gates, then verify exact release head. No remote CI dispatch/push was performed here.

## Playwright MCP and browser automation

### Current setup

Playwright MCP is **machine/user-global, not a repository dependency or transferred runtime**. The effective registration is `/home/khovan/.codex/config.toml`; `codex mcp list --json` reports `playwright` enabled, STDIO, with no configured environment assignments, headers, auth token or working-directory override. Its exact current registration is:

```toml
[mcp_servers.playwright]
command = "npx"
args = ["@playwright/mcp@latest"]
```

The currently resolved server is `@playwright/mcp`0.0.83 at `/home/khovan/.npm/_npx/9833c18b2d85bc59/node_modules/@playwright/mcp`; it uses Playwright/Playwright Core1.64.0-alpha-1790635538000. That cache path is evidence, **not** an installation requirement and must not be copied. Current tool calls successfully used headless Google Chrome154.0.8037.97 at `/opt/google/chrome/chrome`. The registration itself does not explicitly request headless; use the explicit reproducible configuration below in a non-GUI session rather than relying on that environmental behavior.

Canonical project `@playwright/test` is1.63.0 (`package.json` range `^1.63.0`, lockfile resolves1.63.0). Its expected bundled Chromium executable `/home/khovan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` is **absent** in this environment. The repo config's existing `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override was used with installed system Chrome for the passing run. The MCP browser version/cache and project test-runner browser version/cache are independent.

Repository-managed capability is complete in canonical source. SHA256 comparison against integration found **zero differences across all14 baseline browser/package/CI artifacts**; they already existed identically, so no duplicate transfer or dependency change was needed:

- `package.json`, `pnpm-lock.yaml`: test dependency and `test:admin:e2e` / `test:billing:e2e` scripts, each with `build:runtime-packages` pretest.
- `playwright.config.ts`: Chromium project,1440x900/en-US, headless test-runner default, traces on first retry, fixture web servers, optional executable override; CI uses one worker and two retries, local no retries. Do not silently reuse an unrelated service just because `reuseExistingServer: !CI` allows it.
- `tests/e2e/admin/{admin-billing,admin-corpus-lifecycle,admin-rbac-security,admin-shell-navigation,admin-user-lifecycle}.spec.ts`; `tests/e2e/billing/customer-top-up.spec.ts`.
- `tests/e2e/fixtures/{billing-api-fixture.mjs,billing-auth.ts,billing-release-gate.json}` and `tests/e2e/admin/admin-billing.spec.ts-snapshots/admin-billing-node-1320-2.png`.
- `.github/workflows/test.yml`, job `admin-playwright-e2e`: frozen-lockfile install, Chromium installation, runtime-package build, billing/admin suite and failure-artifact upload.

Additional migration browser preparation was already transferred and independently hash-verified: `apps/api/test/w1-canonical-browser-support.ts`, `apps/api/test/w1-canonical-read-isolation.e2e-spec.ts`, `reports/w1-4-api-browser-preparation.md`, `reports/w1-canonical-read-isolation-preparation.md`, and W1.4 web/coordinator/R1/fixture-visibility reports. They provide fixture identities, API/SSE expectations and historical actual-rendering evidence; they are not a standalone current production browser gate. There is **no checked-in W1.4 Playwright spec or reusable real API browser-start harness**; the old `/tmp` harness is not a dependency to recover or copy.

Canonical ignored local `.mcp.json` and `.vscode/mcp.json` contain other graph/memory registrations, **no Playwright server**; no such local registration files were found in integration. They are ignored local user setup, not versioned project MCP artifacts, and were preserved untouched. No `.codex/config.toml` Playwright registration is versioned in the repo. No MCP secret, machine config, browser profile, socket, cache, generated DB or transient `.playwright-mcp` output was copied into canonical source.

Agent browser calls use the registered MCP directly: `browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_evaluate`, `browser_console_messages`, `browser_network_requests` and interaction tools. No Orca CLI wrapper is required. Optional global `playwright-cli`0.1.22 exists at `/home/khovan/.nvm/versions/node/v22.22.3/bin/playwright-cli` (package `@playwright/cli`); it is not the MCP registration or an LCSP dependency. Execution guidance is machine-local `/home/khovan/.agents/skills/playwright-cli/SKILL.md`, with `references/playwright-tests.md` and `references/session-management.md`; do not require those paths on another machine, since this section supplies the essential workflow. Repo `AGENTS.md` requires Playwright MCP for user flows and Chrome DevTools MCP for diagnostic console/network work where available.

### Required services

| Target                                  | Required service                                                                                            | Ports/prerequisites                                                                                   | Proof boundary                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Existing admin/billing Playwright suite | Actual Next/BFF plus synthetic billing API fixture                                                          | Next3100; fixture3102 with `/health`; no PostgreSQL/broker/provider                                   | UI/fixture regression only, not W1/W5 production acceptance                                |
| Canonical public-page smoke             | Actual Next/BFF, mock flags explicitly false                                                                | Next3310; sign-in page can render without upstream API                                                | Rendered public UI, no auth/assessment/SSE proof                                           |
| W1 canonical assessment browser flow    | Actual Nest API/AppModule, ordered migrated isolated PostgreSQL, seeded browser owner/assessments, Next/BFF | API3311; Next3310; DB55439/`lcsp_w14_browser`; own safe broker or explicitly disclosed test-edge stub | Actual auth/GET/SSE/UI agreement; stub cannot prove provider/broker/checkpointer execution |
| W1 read-isolation e2e                   | Real guarded Nest/auth/Prisma with existing explicit RabbitMQ test stub                                     | Fresh DB55441/`lcsp_w1_read_isolation`; Jest owns HTTP test application                               | Cross-owner/persisted-read proof, not rendered browser proof                               |

Normal development template `.env.example` uses API3001 and BFF upstream3001;3310/3311 are deliberate browser-test overrides, not defaults. Real API validation in `apps/api/src/config/config.ts` requires `DATABASE_URL`, `RABBITMQ_URL`, `WORKER_API_KEY`(at least32 characters), `MFA_SECRET_ENCRYPTION_KEY`(64 hex characters), `GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION` and a valid32-byte-base64 `GITHUB_CLI_CREDENTIAL_KEK_KEYRING` containing that version. Supply isolated values securely; do not paste production secrets or inherited user `.env` into reports. `NODE_ENV`, `PORT`, `LCSP_API_BASE_URL`, `LCSP_MOCK_MODE` and `NEXT_PUBLIC_LCSP_MOCK_MODE` must match the test. Provider credentials are required for later real provider gates, not for a static public sign-in smoke. Test-runner override `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is unrelated to MCP's `--executable-path` flag.

### How to start

From `/home/khovan/Workplaces/LCSP`, retain current user WIP and existing local configuration. On a machine needing bootstrap:

```bash
rtk proxy pnpm install --frozen-lockfile
rtk proxy pnpm run build:runtime-packages
rtk proxy pnpm exec playwright --version
rtk proxy pnpm exec playwright install chromium
```

Linux system libraries may require `pnpm exec playwright install --with-deps chromium` with appropriate permissions. Do not reinstall browsers unnecessarily here: `/opt/google/chrome/chrome` was successfully launched headless using the existing executable override. Do not copy `node_modules` or browser caches from integration.

For the existing fixture suite, let `playwright.config.ts` start and stop its servers (exact command passed here):

```bash
rtk proxy ss -ltnp '( sport = :3100 or sport = :3102 )'
rtk proxy env PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome PLAYWRIGHT_HTML_OPEN=never pnpm run test:billing:e2e --workers=1
```

If Chromium has instead been installed at the runner's expected path, omit the override. The config starts `node tests/e2e/fixtures/billing-api-fixture.mjs` (default3102, optional `BILLING_E2E_API_PORT`) and, from `apps/web`, `node node_modules/next/dist/bin/next dev --port 3100` with `LCSP_API_BASE_URL=http://127.0.0.1:3102`. Keep the fixture at3102 unless the config is deliberately updated too. The synthetic auth helper sets `lcsp_session`/`lcsp_locale` cookies for3100; these are fixture tokens, not real W1 auth. For interactive MCP against this fixture, run those two existing commands in separate owned terminals and keep them alive through the browser check. Never run simultaneous Next dev processes against the same `apps/web/.next` directory; use sequential checks.

For a real W1 flow, first verify fresh target ports/container identities. Only if those targets are safely isolated and authorized, provision/deploy/seed using the existing recipe:

```bash
rtk proxy ss -ltnp '( sport = :3310 or sport = :3311 or sport = :55439 )'
rtk proxy env LCSP_TEST_POSTGRES_PORT=55439 LCSP_TEST_POSTGRES_DB=lcsp_w14_browser LCSP_TEST_POSTGRES_USER=postgres LCSP_TEST_POSTGRES_PASSWORD=postgres node apps/api/test/scripts/ensure-test-postgres.mjs
rtk proxy env DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55439/lcsp_w14_browser?schema=public' pnpm --dir apps/api run prisma:migrate:deploy
rtk proxy env DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55439/lcsp_w14_browser?schema=public' pnpm exec tsx apps/api/test/w1-canonical-browser-support.ts
```

These are repository-verified commands, **not executed during this addendum**. Migration deployment must capture96 ordered migrations. The seeder refuses a different URL or existing fixture UUID; do not reset/reseed an existing DB to get around it. Set the API-required env names above and an independently owned broker target before either API start option:

```bash
# Required isolated DB/broker/security environment must already be supplied.
rtk proxy env PORT=3311 NODE_ENV=test pnpm --dir apps/api run start:dev
# Alternatively build first, then start:prod with the same explicit environment.
rtk proxy pnpm --dir apps/api run build
rtk proxy env PORT=3311 NODE_ENV=test pnpm --dir apps/api run start:prod
```

Those script/port conventions are source-verified; real API startup was **not executed** here because its isolated DB/broker/security prerequisites were not recreated. Never connect to unrelated `fogewise-postgres`5432 or `fogewise-rabbitmq`5672, or start a real provider/legacy outbox consumer against user data merely to obtain a browser receipt. Existing read-isolation Jest explicitly stubs the broker; production `start:dev` does **not** automatically apply that stub. Any future guarded browser harness must disclose that limitation and live in intentional project test infrastructure, not depend on a lost worker `/tmp` path.

Once API3311 is actually ready, start canonical Next/BFF (same command used for the public-page smoke):

```bash
rtk proxy env LCSP_API_BASE_URL=http://127.0.0.1:3311 LCSP_MOCK_MODE=false NEXT_PUBLIC_LCSP_MOCK_MODE=false pnpm --dir apps/web exec next dev --hostname 127.0.0.1 --port 3310
```

Before browser navigation, verify listeners and readiness:

```bash
rtk proxy ss -ltnp '( sport = :3310 or sport = :3311 )'
rtk proxy curl --silent --show-error --max-time 50 --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3310/sign-in
```

Then verify real API readiness/auth with the synthetic fixture and the exact endpoints in `reports/w1-4-api-browser-preparation.md`; a listener alone is not database/auth readiness. Stop only your own processes when finished; do not stop unrelated services or restart Orca.

### How to verify MCP

Inspect registration safely without printing other servers' credentials:

```bash
rtk proxy codex mcp get playwright --json
rtk proxy codex mcp --help
```

`get` verifies configuration, **not** a working browser session. In the next Codex session, confirm `mcp__playwright__*` tools are visible (CLI `/mcp` can show connection state). Use `browser_tabs(action="list")`, create your own `about:blank` tab with `browser_tabs(action="new", url="about:blank")`, and call `browser_evaluate` with `() => ({url: location.href, userAgent: navigator.userAgent, readyState: document.readyState})`. This exact workflow passed here with `HeadlessChrome/154.0.0.0` and `readyState:"complete"`. Close only that owned tab; do not clear another browser's profile or all tabs. A new tab is **not** a fresh cookie context: the current default MCP profile retained historical synthetic session cookies. For clean auth/isolation checks, use a deliberately isolated server/session, not the old profile.

For a **new machine/session without an existing healthy registration**, minimal reproducible STDIO setup for this environment is:

```bash
rtk proxy codex mcp add playwright -- npx -y @playwright/mcp@0.0.83 --headless --isolated --browser chrome --executable-path /opt/google/chrome/chrome
```

The pinned server version and flags were checked against installed CLI help/version; registration was **not changed here**. Verify the executable exists first. On another OS, use its installed Chrome channel/path or an explicitly installed compatible browser, not this Linux path blindly. MCP starts on demand through Codex; it does not need an LCSP TCP port. To inspect/start the same server independently through an MCP client, the launcher is `npx -y @playwright/mcp@0.0.83 --headless --isolated --browser chrome --executable-path /opt/google/chrome/chrome`; STDIO waits for MCP requests, so an idle launcher is not an availability test. Start a fresh single-agent session after registration if tools are not visible; do not reopen/restart the old Orca Run. No credentials/auth token are required for this local server; LCSP authentication is a separate application concern.

### How to run browser gates

```bash
rtk proxy pnpm exec playwright test --list
rtk proxy env PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome PLAYWRIGHT_HTML_OPEN=never pnpm run test:admin:e2e --workers=1
rtk proxy env PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome PLAYWRIGHT_HTML_OPEN=never pnpm run test:billing:e2e --workers=1
```

The second command is a subset; the third was actually run and passed13/13 (28.4s). Of those13, seven exercise real browser pages; six corpus/user/sidebar tests use local functions/constants without browser interaction. Do not treat their “release gate” names as executable new-architecture acceptance or actual destructive-action/portfolio proof. All use the synthetic billing fixture, not migrated W1 API/persistence.

For actual W1 browser acceptance, after real services/auth exist, use MCP to sign in through `/sign-in`, open `/workspace`, open both synthetic assessment IDs from §8 and inspect their Runtime activity dialogs. Assert persisted PAUSED lifecycle/execution for the canonical-present row, explicit unavailable/null state for the V1 row, and contradictory secondary RUNNING activity cannot overwrite either. Compare real authenticated GET/snapshot/SSE canonical values, inspect console/network and control acknowledgements. Historical404 evidence-graph /409 `RUNTIME_CONTROL_TARGET_STALE` are not clean Stop/Continue acceptance. The latest usage/preview repair still needs a fresh complete W1 gate and actual live browser acceptance.

The read-isolation Jest command in §13 is also available once its separate55441 DB exists; it does not execute a browser. No DB-backed W1 browser/read-isolation gate was rerun in this addendum.

### Headless environment

Headless Playwright works here without a usable X server. Project tests default headless; do not pass `--headed` or `--debug` in a non-GUI run. MCP should explicitly use `--headless --isolated` in a reproducible new setup. An independent canonical Node launch with `require("@playwright/test").chromium.launch({headless:true, executablePath:"/opt/google/chrome/chrome"})` opened `about:blank` and reported Chrome154.0.8037.97 successfully; the13-test suite also ran headless.

The separately registered Chrome DevTools MCP currently uses `npx -y chrome-devtools-mcp@latest` without a headless option. A fresh `list_pages` attempt still returned `Missing X server to start the headful browser`. That is a DevTools configuration/environment issue, **not** a Playwright failure. Reconfigure the relevant DevTools session for supported headless operation or use an authorized X environment when actually required; do not change/kill another user's browser, bypass sandbox protection unnecessarily, or require X for legitimate headless Playwright. Playwright MCP console/network tools remain available and the public smoke had zero console errors.

### Known browser blockers

Actual addendum results from the **canonical** source:

| Layer/check                             | Result                                                                                                 | Meaning / remaining                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| MCP registration/visible tools          | PASS; global enabled STDIO server0.0.83                                                                | Global dependency documented, not moved into repo                           |
| Harmless MCP tab/evaluate               | PASS; about:blank complete, headless Chrome154                                                         | Actual tool/server/browser operation, not only config inspection            |
| Project package/config discovery        | PASS; runner1.63.0,13 tests in6 files                                                                  | Config resolves from canonical source                                       |
| Browser executable                      | PASS system Chrome launch; bundled Chromium1243 absent                                                 | Use verified override or install runner-managed Chromium                    |
| Next/BFF3310 startup                    | PASS; listener then `/sign-in`HTTP200                                                                  | Started from canonical source and stopped after smoke                       |
| MCP LCSP sign-in smoke                  | PASS; title `Sign in \| LCSP`, `Welcome back`, form/password visible, no overflow, zero console errors | Public rendered UI only; no authenticated assessment gate                   |
| Workspace real upstream                 | BLOCKED; BFF auth/profile/workspace/assessments/runtime-events503                                      | API3311 absent; no claim that MCP, auth or canonical assessment flow passed |
| Existing fixture browser suite3100/3102 | TEST PASS13/13, zero skips,28.4s                                                                       | Actual Next/BFF plus synthetic API; not W1 GATE PASS                        |
| Real W1 DB/API/SSE/browser gate         | NOT RERUN;55439/55441 prerequisites absent                                                             | Recreate safely, then execute current-source gate                           |
| Chrome DevTools MCP                     | ENVIRONMENT-BLOCKED, missing X for current headed setup                                                | Separate from successful headless Playwright                                |

Historical3310/3311 `ERR_CONNECTION_REFUSED` occurred because servers were not listening.3310 was proven usable after explicit startup in this addendum;3311 remained absent. After owned smoke/test cleanup, all3100/3102/3310/3311 listeners were absent again **by design**. The next agent must start services and confirm listeners/readiness before navigation; final stopped services are not a broken Playwright installation. Fixture run emitted the existing React `unoptimized` non-boolean-attribute warning and NO_COLOR/FORCE_COLOR notices; no test failed, but this is not a universal clean-console claim.

Durable evidence is the result table and existing reports, not copied transient profiles/snapshots. Historical `.playwright-mcp/*.yml` stayed in integration, and current MCP output also remains transient session evidence. Do not commit/copy browser profiles at `~/.cache/ms-playwright-mcp`, auth storage state, `.playwright-mcp`, `test-results`, `.next`, sockets or caches as migration source.

### Single-agent requirement

Use Playwright MCP for executable browser/UI validation where appropriate. Readiness checks and static source review supplement, never replace, an actual UI flow. Prefer headless in non-GUI environments; verify application ports first; keep MCP, browser, application startup and test/gate status separate. Do not mark a browser or W1/W5 gate PASS from package resolution, a public smoke, scripted fixtures, or static source inspection alone.

## 14. Do-not-do constraints

- Do not restore V1 semantic fallback, feature flags, shadow evaluator or dual writer.
- Do not create a second lifecycle authority or Python lifecycle mirror; UI/API reads never write/reconcile state.
- Do not reintroduce mandatory Initial Interview or its lifecycle agent/context-ready gate.
- Do not rebuild Scanner/Planner/Investigator workflow, one-rule-one-agent or custom continuation/readiness/checkpoint registries.
- Do not create deterministic semantic applicability/compliance/legal/normative authority.
- Do not add human legal approval/signoff or treat a human answer as verdict approval.
- Do not infer lifecycle in browser from events, elapsed time, stages, job status, control poll or missing projection.
- Do not create assessment-shared raw memory, cross-thread lookup, child promotion or evidence from learning memory.
- Do not generate final reports with unresolved material dependencies or final UNKNOWN/PARTIAL/question placeholders.
- Do not rebase existing assessment pins on a newly active legal portfolio.
- Do not semantically promote V1 decisions, resume V1 workflow checkpoints, or erase history/FKs before archive/retention gates.
- Do not reset/discard/stash/clean/overwrite user WIP. Original nine-file hashes are the preservation boundary.
- Do not commit or push future implementation without explicit user authorization; no PR or remote action is implied.
- Do not restart Orca campaign or depend on terminal/session state. No additional migration implementation was performed after creating this handoff.

## 15. Production completion definition

**Every row below is required. None has complete new-architecture production acceptance yet.** This is the Freeze§12 matrix summarized without weakening conditions. Use production-shaped API/PostgreSQL/outbox/checkpointer/images, reviewed semantic agent evals and real Playwright, not scripted packets alone.

| Acceptance                                              | Exact required pass condition                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic legal preparation                             | Pinned corpus automatically generates/validates/persists/activates complete LegalRule + EngineeringRule portfolio; failed prep preserves prior ACTIVE                                                                                                |
| Cross-reference/definition/exception/qualifier handling | Reviewed legal eval retains context/limiting language, represents relations, never cites another version                                                                                                                                             |
| Zero human legal approval                               | No production route/worker/DB/UI approval or signoff requirement; integrity-only automatic activation                                                                                                                                                |
| Zero mandatory Initial Interview                        | Repository-only assessment starts Root without interview/context-ready/synthetic confirmation                                                                                                                                                        |
| Zero tool-answerable technical questions                | Root inspects source/document/runtime first and opens zero requests for facts those sources establish                                                                                                                                                |
| Applicable vs not applicable                            | Every pinned rule gets one evidenced APPLICABLE/NOT_APPLICABLE from Root, never deterministic applicability                                                                                                                                          |
| Compliant vs non-compliant                              | Every applicable criterion MET/NOT_MET and one COMPLIANT/NON_COMPLIANT with valid refs; validator rejects bad refs without rejudging                                                                                                                 |
| HITL same-thread resume                                 | One material request interrupts; authorized answer updates Case/Evidence and resumes identical server thread, no duplicate question/decision                                                                                                         |
| Crash/restart resume                                    | Actual worker kill/restart during investigation/HITL resumes same checkpoint/thread/domain state idempotently                                                                                                                                        |
| Stop/continue                                           | Durable PAUSED/execution pause; Continue same Root and restored waiting when blocked; no second Root; Cancel terminal                                                                                                                                |
| One assessment/one Root thread                          | Concurrent create/resume/retry/pause/HITL → one unique mapping, at most one active lease; reject per-rule/request Root threads                                                                                                                       |
| Cross-assessment memory canary                          | A raw canary cannot be retrieved/emitted/cited/authorized by B across same/different users/tenants/repo/portfolio                                                                                                                                    |
| Shared memory not evidence                              | Sanitized heuristic citation/submission rejected as evidence/provenance type                                                                                                                                                                         |
| Stale decision invalidation                             | Case or pinned repo/source/rule revision change INVALIDATES dependencies, blocks finalization and re-investigates                                                                                                                                    |
| Legal portfolio pinning                                 | Activation affects new assessments only; existing exact corpus/portfolio/report pins never cache-retarget                                                                                                                                            |
| Multi-tenant isolation                                  | Foreign case/evidence/request/event/thread/artifact/assessment rejected across every endpoint/task descendant                                                                                                                                        |
| Concurrent assessments                                  | Distinct thread/sandbox/lease/event namespaces with no data/write collision                                                                                                                                                                          |
| Bounded negative evidence                               | Root absence judgment uses authenticated bounded coverage; missing/partial/index-gap blocks inference, never deterministic noncompliance                                                                                                             |
| No final unresolved blocker                             | Any open request/input/pending or invalidated DRS/stale evidence-pin/fatal failure/invalid portfolio returns structured finalization blockers                                                                                                        |
| No final UNKNOWN/PARTIAL/open-question                  | V2 decisions omit final unresolved values; no unresolved report/placeholder; reviewed report eval rejects such output                                                                                                                                |
| Token/activity accounting                               | Stable per-model-attempt invocation; persisted usage/billing reconcile; event activity redacted, duplicate callbacks no double count                                                                                                                 |
| Legacy path absence                                     | Actual image/API/import graph has no model Scanner/mandatory Interview/per-rule dispatcher/Python semantic loop/targeted workflow/semantic judge/approval/regex normativity/lazy recovery-cache-bundle/duplicate lifecycle/V1 flag; SQL history only |
| Legal portfolio supersession                            | Mid-assessment activation preserves its existing pins/decisions; new assessment uses new portfolio; own-input changes invalidate before finalize                                                                                                     |
| Migration/rollback safety                               | Clean + populated V1 upgrade, restartable/idempotent migration, old artifact/history reconciliation, verified prewrite restore and forward-only repair after V2 writes                                                                               |
| Assessment deletion/retention                           | Authorized deletion revokes/deletes eligible checkpoint/sandbox/requests/domain; legal hold/audit comply; no attributable shared content or cross-assessment effect                                                                                  |

Completion also requires W1–W7 gates in dependency order, required CI for the exact release source, production-shaped staging and authorized post-deploy sanitized synthetic canary. A local test pass, worker_done, committed snapshot or transferred file count is never release completion.

## 16. Single-agent continuation prompt

> Work directly in `/home/khovan/Workplaces/LCSP` on the current canonical checkout. First read `docs/architecture/LCSP_AGENTIC_MIGRATION_HANDOFF.md` completely, then `reports/architecture-freeze-migration-manifest.md` completely. Inspect current git status (including untracked files), diff and actual source before editing. Preserve the nine pre-existing user-WIP files and all valid transferred migration work; do not reset, stash, clean, restore over changes or restart from HEAD. The old Orca campaign is frozen and historical: use one primary agent sequentially, no new coordinator or worker campaign.
>
> Continue from the CURRENT implemented-but-ungated W1 repair: rerun/repair the complete W1 gate, then proceed sequentially through W2–W7 exactly as handoff§12/Freeze§11 prescribe. Do not restart accepted W1.1–W1.4. Reuse the available source fixtures, structural packets/native probes and mechanical guards, but never treat preparation as production acceptance.
>
> Use managed Deep Agents/`create_deep_agent`, native `task()`, LangGraph checkpoint/interrupt/resume and governed Store where the frozen architecture requires them. Do not invent custom agent frameworks, semantic Python workflows, lifecycle mirrors, per-rule Root threads, deterministic semantic judges, human legal approval, V1 fallbacks or shared raw assessment memory. Keep exactly one legal preparation authority, one assessment reasoning authority, one lifecycle authority and one domain truth per object. Preserve tenant/provenance/revision/source-pin/billing/security guards.
>
> Actually run tests and reviewed semantic/live/browser/migration evidence at each gate. Keep going autonomously through real failures and narrow root-cause repairs; never waive/estimate/fabricate success or advance a failed gate. Escalate only genuine architecture contradictions, destructive/production authority, missing permissions/credentials or external blockers. Delete replaced legacy code/imports/skills/jobs/image assets only after replacement and archive/retention gates pass. Do not declare production completion until every handoff§15/Freeze§12 row and W1–W7 gate has reproducible evidence.
>
> Use Playwright MCP for browser/UI verification. Read the handoff's Playwright setup section, verify required application services/ports and readiness before navigating, and prefer headless execution in non-GUI environments. When a UI/browser gate exists, actually execute its flow; never mark browser acceptance PASS from static source inspection or the fixture suite alone. Distinguish application-startup/upstream failure from Playwright/MCP failure, record console/network limitations, and do not copy user browser profiles or secrets. The global MCP registration is separate from repository test dependencies; do not depend on old Orca terminals or the former /tmp API harness.
>
> Keep changes uncommitted and do not commit, push, create a PR or deploy unless the user explicitly authorizes that action.
