# W1.4 web canonical projection

Status: source and focused web checks complete; live API-backed browser transport verified; real rendered UI acceptance is not proven in this sandbox.

## Root cause

The web projection still allowed legacy activity/payloads to act as lifecycle authority. `postFinding` and coverage could select an assessment screen, workflow rows could fall back to old inferred steps, and the composer treated a generic `resumeAvailable` flag as sufficient even when the canonical ALS/AES control pair was explicitly null.

## Fix

The workspace parser/provider now carries the finalized `canonical_assessments` and `canonical_events` response fields. Selectors, workflow/status controls, summaries, directory/dashboard surfaces, and the runtime sidebar consume the canonical ALS/AES pair; missing or partial state renders unavailable/loading, and canonical events are retained only as activity. The old workflow-row fallback and local lifecycle/control inference were removed. The composer suppresses generic Continue when `runtimeControlState === null`, so an explicit canonical-null response cannot be overridden by `resumeAvailable`; the regression uses scalar DOM attributes rather than an unbounded DOM-object assertion.

## Owned changes

- Workspace runtime types, parser/provider, selectors, adapter, formatter, composer controls, usage scoping, and no-op event/control projection.
- Workspace overview, list, directory, dashboard, summary, composer, runtime sidebar, canonical status/activity, and workflow status list.
- Deleted the obsolete `WorkflowStatusRow` fallback and removed fabricated preview workflow state.
- Added only the required English/Vietnamese canonical projection i18n keys.
- Added adversarial canonical-authority, canonical-null/partial, event-only, control-target, parser, sidebar, native-stop, and composer scalar tests.

No API, contracts, Prisma, or Python files were changed by this W1.4 work.

## Verification

PASS:

- `pnpm run build:runtime-packages`
- `pnpm --dir apps/web exec tsc --noEmit --pretty false`
- Targeted Prettier check for all changed composer/overview/adapter/selector/status files.
- Focused web run: 130 tests passed, 0 failed, 0 cancelled across runtime parser/provider, canonical adapter/selectors, composer controls, native stop projection, sidebar/app shell, post-finding components, and workspace stream tests.
- Bounded composer scalar repro: `timeout 30s node --import tsx /tmp/lcsp-w1-4-composer-scalar-check.ts` exited 0 with `{"actionLabel":null,"actionType":null}` for `resumeAvailable=true` plus explicit `runtimeControlState=null`.
- `git diff --check`.
- `graphify update .` completed successfully after the source changes.

NOT RUN BY DESIGN:

- The full `assessment-composer.test.tsx` file was not rerun. Its prior unbounded DOM-object assertion stalled; the proven stalled child was terminated by the coordinator. The bounded scalar assertion above is the replacement regression check.

## Live API/browser evidence

The coordinator-owned guarded API3311 harness was exercised through Playwright against the isolated PG55439 database. Authenticated GET returned the canonical PAUSED lifecycle/runtime pair for the seeded present assessment and an explicit null lifecycle/runtime pair for the unavailable assessment; unauthenticated GET returned 401. Authenticated SSE returned 200 `text/event-stream`, included both canonical rows, and matched the GET canonical data; its first frame contained `stage_lifecycles=[]`, `recent_activity=[]`, and `canonical_events=[]`, so the first frame did not provide an event-only contradiction to render in the UI. Credentials, database identifiers, and harness details remain in the preserved API browser-preparation report and coordinator ledger; none are copied here.

PARTIAL / environment-limited:

- Playwright could reach and verify the live API endpoint, but no web UI server could bind in this sandbox (`listen EPERM` on the owned web port), so a real rendered workspace flow could not be opened.
- Chrome DevTools MCP could not start its headful browser because the sandbox has no X server. No DevTools console/network pass is claimed.

The live API evidence therefore proves the response shape and canonical present/null cases, while rendered UI acceptance remains coordinator follow-up once a browser-capable web runtime is available.

### Follow-up capacity check

After the source/test completion, the owned web port remained unbound: a single Playwright navigation to `http://127.0.0.1:3310/` returned `ERR_CONNECTION_REFUSED`. Chrome DevTools MCP still could not start because no X server is available. No service restart/rebind, database reseed/reset, stalled-test rerun, or additional lifecycle dispatch was attempted.

## Closure points

- `selectAssessmentScreenProjection` requires the canonical ALS/AES pair and remains screen authority even when post-finding or coverage payloads suggest another branch; adversarial tests cover this.
- `WorkflowStatusList` no longer renders old inferred step rows. Without stage-level canonical authority, the fixed rows are unavailable; the sidebar consumes canonical status/activity only.
- Lifecycle events and control acknowledgements cannot mutate canonical projection. Activity rendering accepts `ACTIVITY_RECORDED` only, keeping lifecycle events out of the customer activity feed.

## Focused R1 canonical-control closure receipts — 2026-10-06

The current unaccepted W1.4 worktree received the focused repair recorded in `reports/w1-4-r1-canonical-control-closure.md`. Canonical ALS/AES now dominates same-ID stale control polling, with only matching `STOP_REQUESTED` over canonical `RUNNING` and `RESUME_REQUESTED` over canonical `STOPPED` permitted as pending-command overlays; absent or partial canonical pairs remain unavailable. The no-op runtime-control presentation wrapper was deleted and the view-model returns the normalized value after the existing usage calculation; the dead composer boolean aliases were removed after tracing both production callers; canonical fixture typing now uses shared constants/derived types and canonical status/activity props use a sibling type file.

R1 focused receipts: control 7/7, full composer 8/8, native-stop 3/3, adapter 63/63, workspace-runtime-provider 20/20, workspace-overview 1/1; web no-emit TypeScript PASS; import, contract-literal, agentic-tool, web ESLint, Prettier, diff, and graphify checks PASS. Web ESLint emitted 39 existing warnings and 0 errors. A fresh Playwright MCP attempt against root-owned Next3310 and guarded API3311 returned `ERR_CONNECTION_REFUSED`; no service restart/rebind was attempted, so fresh rendered-browser acceptance is NOT_PROVEN. Chrome DevTools MCP returned the known missing-X-server limitation; no DevTools-specific PASS is claimed. This receipt appends facts only and does not revise the historical acceptance limits above.

### R1 fresh rendered projection receipt — 2026-10-06

After the coordinator restored the root-owned Next3310 and guarded API3311 processes, the existing Playwright MCP session signed in with the synthetic fixture account, opened the workspace, and opened both seeded assessments. The canonical-present assessment's Runtime activity dialog showed `Lifecycle: Paused` and `Execution: Paused`; the all-null assessment's dialog showed `Assessment state is unavailable.` and `Token usage unavailable`. The present-assessment page emitted an evidence-graph `404` and repeated runtime-control `409` responses; these are recorded observations rather than a clean browser-console PASS. Chrome DevTools MCP still returned the missing-X-server limitation, so no DevTools-specific console/network PASS is claimed; these facts append to, and do not rewrite, the earlier environment-limited acceptance record.
