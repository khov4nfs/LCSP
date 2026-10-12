# W1.4 R1 canonical-control closure

Date: 2026-10-06
Scope: focused repair of the current unaccepted W1.4 worktree under task `task_3130e2f80a70` / dispatch `ctx_c6cf9c23b0ec`.
Authority: `reports/w1-4-coordinator-acceptance.md`; this repair does not accept W1 or any W2 gate.

## Root cause

`selectAssessmentComposerRuntimeControl` returned a same-target polling response before evaluating canonical ALS/AES, so a stale `RUNNING` response could reopen a canonical `SUCCEEDED`/`COMPLETE` or `PAUSED` assessment. The runtime view-model also called a compatibility wrapper that had become a no-op, and the recovered fixture/component additions retained a handwritten lifecycle union and inline prop types contrary to repository policy.

## Fix

- Require a complete canonical lifecycle/runtime pair before projecting a composer control.
- Require the complete ALS/AES pair, then project terminal AES to `COMPLETED`, paused AES to `STOPPED`, running AES to `RUNNING`, and queued/unknown AES to unavailable; canonical state wins over same-ID stale polling without inferring control from lifecycle text.
- Allow only a same-target `STOP_REQUESTED` over canonical `RUNNING` or `RESUME_REQUESTED` over canonical `STOPPED`; mismatched or stale steady/terminal controls are ignored.
- Delete `assessment-runtime-control-presentation.ts` and return the normalized model directly after the existing usage calculation, preserving token/billing inputs and dependencies.
- Remove the unused `turnRunning`/`turnPaused` composer aliases after tracing both production callers (`AssessmentOverview` and `AssessmentInterviewFlow`); neither production caller supplies those aliases, and the active path passes canonical `runtimeControlState`.
- Move canonical status/activity/row props to `apps/web/src/features/assessment-runtime/types/canonical-assessment-status.types.ts` and replace new fixture lifecycle/discriminator literals with shared contract constants/types.

## Verification

PASS — bounded focused Node/tsx tests, all with `--test-concurrency=1`:

- `apps/web/tests/assessment-composer-control.test.ts`: 7/7, including same-ID terminal/paused stale-running regressions, absent/partial pair, and pending-command consistency.
- `apps/web/tests/assessment-composer.test.tsx`: 8/8 (full composer suite).
- `apps/web/tests/assessment-native-stop-projection.test.ts`: 3/3.
- `apps/web/tests/assessment-runtime-adapter.test.ts`: 63/63.
- `apps/web/tests/workspace-runtime-provider.test.ts`: 20/20.
- `apps/web/tests/workspace-overview.test.tsx`: 1/1.

PASS — `pnpm --dir apps/web exec tsc --noEmit --pretty false`.
PASS — `pnpm run check:imports`, `pnpm run check:contracts`, and `pnpm run check:agentic-tools`.
PASS — `pnpm --dir apps/web lint`; ESLint reported 0 errors and 39 pre-existing warnings.
PASS — Prettier check over every changed owned source/test file and `git diff --check`.
PASS — `graphify update .`; only the repository's existing SQL dependency and smoke-test parse warnings were reported, with no topology change.

## Browser limits

PARTIAL / NOT_PROVEN — Playwright MCP used an own tab and attempted `http://127.0.0.1:3310` and guarded API `http://127.0.0.1:3311/auth/sign-in`; both returned `ERR_CONNECTION_REFUSED`. Root-owned services were not stopped, rebound, or restarted. Chrome DevTools MCP was attempted and returned `Missing X server to start the headful browser`; no DevTools console/network PASS is claimed. Existing API/Playwright/browser evidence in `reports/w1-4-web-canonical-projection.md` remains preserved and is not re-claimed as new R1 evidence.

### Fresh Playwright receipt — 2026-10-06

After the root-owned Next3310 and guarded API3311 processes were restored by the coordinator, the existing Playwright MCP session completed the synthetic sign-in flow and opened both seeded assessments. The canonical-present assessment rendered `Runtime activity` with `Lifecycle: Paused` and `Execution: Paused`; the all-null assessment rendered `Assessment state is unavailable.` and `Token usage unavailable`, so both canonical-present and canonical-unavailable customer projections were observed. The page emitted the existing evidence-graph `404` and runtime-control `409` responses during the present-assessment flow; those are recorded as browser observations, not hidden or treated as a clean console pass. Chrome DevTools MCP remained unavailable because the environment lacks X, so no DevTools-specific console/network PASS is claimed.

## Source state

Changes remain uncommitted in the current worktree. No API/contracts/Prisma/Python/i18n source, service, provider, database, migration, reset, reseed, commit, push, or unrelated worker-owned file was changed by this repair.
