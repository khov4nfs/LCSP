# Fresh Codex W1 integration gate

Date: 2026-10-06 (Asia/Ho_Chi_Minh)

## Verdict

**FAIL — W2/W3 are blocked.** The accepted W1 source is integrated at `1e2107956`, and the contract, API, persistence, matrix, and focused web evidence passed, but the required full web suite has two failures. No implementation source was changed by this gate; this file is the only repository artifact owned by this review.

The gate was run against the complete accepted W1 sequence:

- `988e51f4d` — W1.1 canonical agentic runtime contracts
- `0b6788178` — W1.2 canonical persistence expand migration
- `df4ae5eb9` — W1.3 canonical lifecycle coordinator and persisted reads
- `1e2107956` — W1.4 web projection and R1 repair

`reports/architecture-freeze-migration-manifest.md` was read completely. Freeze §11 requires the shared/API/web checks, exhaustive transitions, stale concurrency, atomic lifecycle/event persistence, sequence/idempotency, GET/SSE agreement, browser non-authority, and canonical vocabulary checks before W2/W3; §12 production acceptance is not inferred from this local gate.

## Evidence matrix

| Requirement | Evidence | Result |
|---|---|---|
| Shared contracts/API/web typecheck | `pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit --incremental false --composite false`; `pnpm --dir apps/api exec tsc -p tsconfig.json --noEmit --pretty false`; `pnpm --dir apps/web exec tsc --noEmit --pretty false` | **PASS** — `/tmp/w1-gate-contracts-typecheck.log`, `/tmp/w1-gate-api-typecheck.log`, `/tmp/w1-gate-web-typecheck.log` |
| Contract/import/tool policy | `pnpm run check:contracts`; `pnpm run check:imports`; `pnpm run check:agentic-tools` | **PASS** — all three policy logs report passed/OK |
| Contract runtime tests | `pnpm exec tsx --test tests/agentic-runtime-contracts.test.ts` | **PASS** — 5/5 |
| Exact transition topology and illegal edges | Fresh inline TypeScript checker over ALS/AES/DRS/ALCS/request tables; every state pair exercised, legal edges require all guards and reject a missing first guard, illegal edges fail closed | **PASS** — 227 pairs, 69 legal edges; exact manifest topology also matched in the fresh gate check |
| API focused W1 suites | Nine coordinator, runtime control/event, continuation, create/get, scan workspace, interview runtime, and reconciliation specs | **PASS** — 9 suites, 200 tests; `/tmp/w1-gate-api-focused-tests-corrected.log` |
| API full suite | `NODE_OPTIONS='--experimental-vm-modules --max-old-space-size=4096' pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand` | **PASS with declared optional skips** — 187 passed suites, 1,222 passed tests; 7 suites/22 tests are environment-gated or optional; `/tmp/w1-gate-api-full-tests-4g.log` |
| API default resource check | Same full API command at the default heap | **UNAVAILABLE at default heap** — Node OOM; the 4 GiB rerun completed without test failures; `/tmp/w1-gate-api-full-tests.log` |
| Migration integrity and historical preservation | `node tests/assessment-lifecycle-migrated-db.mjs`; `node tests/assessment-canonical-persistence.mjs /tmp/w1-gate-persistence-expand` | **PASS for scoped W1 evidence** — 16 PostgreSQL protocol/constraint assertions; 152 expand/replay assertions; clean install and populated upgrade preserved 55 V1 tables/21 seeded rows, null canonical V1 lifecycle fields, 12 concurrent sequence allocations, 8 idempotent replays, stale CAS, rollback, sequence isolation and linked event/outbox checks. Whole-schema drift still exits 2 and is identical to the V1 baseline, so it is not claimed as a whole-schema pass. Logs: `/tmp/w1-gate-migration-protocol.log`, `/tmp/w1-gate-persistence-expand.log` |
| Atomic lifecycle/event, stale concurrency, monotonic sequence/idempotency | Real PostgreSQL protocol runner plus focused API protocol tests | **PASS** — CAS, lock ordering, same-transaction event/outbox, stale rejection, replay identity, sequence monotonicity/isolation and rollback were exercised |
| GET/SSE/snapshot canonical agreement | `projectCanonicalAssessment` is the shared persisted ALS/AES projection for GET/workspace snapshots (`canonical-assessment-projection.ts:39-58`); SSE reads persisted `AssessmentEvent` in sequence order (`assessment-runtime-event.service.ts:966-1017`); GET, snapshot, replay, malformed/null canonical, ownership and failure cases are covered by the corrected focused API run | **PASS for local focused evidence**; live production/browser equality remains **NOT PROVEN** under §12 |
| Sole persisted ALS writer and guard preservation | `AssessmentLifecycleCoordinator.transitionWithGuards` locks canonical rows, checks owner, replays committed event IDs, performs expected-revision CAS, increments `eventSequence`, and persists lifecycle event/outbox in one transaction (`assessment-lifecycle-coordinator.service.ts:198-415`). Runtime acknowledgements use the service-owned path and explicit safe-pause guard (`:418-471`). | **PASS by direct source inspection and focused protocol tests** |
| Authorization, tenant/provenance/HMAC/citation, revision, billing and completion boundaries | W1 contract comments retain these as API/server-authority obligations (`agentic-runtime.ts:3-7`); coordinator owner/revision/lineage and completion guard paths remain present. The W1 diff does not remove or replace the existing authorization, provenance, billing, or completion authorities. | **PASS for preservation/static boundary; not a semantic production acceptance claim** |
| Browser/UI lifecycle authority | `rg 'lifecycleState\\s*:' apps/web/src` and `rg 'deriveStageLifecycles|stage_lifecycles' apps/web/src` returned no matches. Web selectors and customer-action normalization only read canonical ALS/AES and return unavailable when canonical data is absent (`assessment-runtime-selectors.ts:420-472`, `assessment-runtime-adapter.ts:861-949`). | **PASS for static non-writer/non-derivation check** |
| Canonical legacy vocabulary | Exact-word scan of `packages/contracts/src/assessment/agentic-runtime.ts` found no `UNKNOWN`, `PARTIAL`, `WAITING_FOR_CUSTOMER`, `CONTEXT_READY`, `AI_NOT_DETECTED`, `BLOCKED_UNKNOWN_FACT`, `FINAL`, `APPROVED`, or `REJECTED`. The assessment barrel still exports pre-W1 resource modules for the explicitly staged migration; those are not part of the new canonical `agentic-runtime.ts` value sets. | **PASS for canonical exports; staged legacy/resource exports retained by freeze design** |
| Focused web W1 projection suites | Six W1.4 projection/composer/provider/overview files | **PASS** — 102/102; `/tmp/w1-gate-web-focused-tests.log` |
| Full web suite | `NODE_OPTIONS='--max-old-space-size=4096' pnpm run test:web:run` | **FAIL** — 592 passed, 2 failed of 594; `/tmp/w1-gate-web-full-tests.log` |

## Full-web blockers

### 1. Stale native control target wins over the current generation

**Root cause.** `apps/web/src/features/workspace/utils/assessment-runtime-usage.ts:18-32` computes `latestNative`, but then prefers any `control.targetRunId` that merely appears in the current event history. In `apps/web/tests/agent-stream-usage-footer.test.ts:572-590`, an old Interview generation (`native-old`, 10,000 tokens) and a newer Scanner generation (`native-new`, 12,000 tokens) share `run-1`; the stale completed control targets `native-old`, so the projection returns 10,000 instead of the required current Scanner total 12,000. The test failed independently in the focused reproduction: 24 passed, 2 failed, exit 1.

**Repair scope for the web owner.** Reconcile control overlays with the canonical current/native generation before passing a target to `projectCurrentRunUsage`; a stale historical target must not override the newest server/native generation. Preserve exact model-step attribution and no-estimation behavior, then rerun the full web suite and the usage footer tests. Do not broaden this into UI lifecycle inference.

### 2. Preview test asserts removed fabricated workflow labels

**Root cause.** `apps/web/src/features/assessment-runtime/dev/assessment-runtime-sidebar-preview.ts:15-87` now builds a development-only fixture from real runtime normalization and no longer contains the deleted `label: "Repository"`, `"Scanner"`, `"Interview"`, `"Rules"`, `"Rule analysis"`, and `"Gate"` workflow-step fixture. `apps/web/tests/assessment-runtime-preview.test.ts:22-24` still requires those strings, so its first test fails even though the second canonical-normalization guard passes.

**Repair scope for the web owner.** Update the stale preview test to assert the current development-only fixture and canonical/unavailable projection contract, or remove only the obsolete fabricated-label assertions. Do not restore legacy workflow steps, compatibility aliases, fallback lifecycle derivation, or a browser lifecycle writer.

## Browser and production boundary

The static browser-authority requirement passes, but this review does not claim §12 production acceptance. Existing coordinator-owned browser preparation was not treated as a clean gate: the reported live flow had 404/409 responses and unavailable DevTools evidence, and this worker did not touch, rebind, reset, or reseed the shared services. A clean browser/live API/provider/persistence/SSE run remains required after the two web repairs; a hung, unavailable, or partial run must remain unverified.

## Worktree and ownership

No implementation source, tests, migrations, generated packages, browser fixtures, commits, pushes, or PRs were changed by this review. The worktree had no tracked diff before this report; existing untracked coordinator/user artifacts were preserved. Repair ownership is limited to the two web scopes above; W2/W3 must wait for a fresh independent rerun of this same gate with both full-web failures closed.

