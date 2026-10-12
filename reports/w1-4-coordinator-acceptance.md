# W1.4 Coordinator Level 2 acceptance

Authority: frozen manifest §§3/4/11 and the existing throughput policy. Existing implementation Task `task_a12c998de321` completed its recovered current-runtime Dispatch `ctx_c2f764b8571a` normally. Completion is not source acceptance.

## Verdict — 2026-10-06 08:18 UTC

**REQUEST_CHANGES.** Preserve all valid in-progress implementation and the accepted dashboard metric correction. W1.4 acceptance barrier `task_b745931857c7` is BLOCKED; W1 integration gate is not authorized yet. Focused repair is `task_3130e2f80a70` / `ctx_c6cf9c23b0ec`, current worktree, fresh created terminal/current endpoint, effective Codex gpt-5.6-luna max. This is not a recreation/restart of completed W1.4 or a duplicate review.

## Root cause

1. `selectAssessmentComposerRuntimeControl` in `apps/web/src/features/workspace/utils/assessment-composer-control.ts` returns any matching-execution control poll before evaluating canonical AES. A stale RUNNING poll therefore overrides both COMPLETE/SUCCEEDED and PAUSED/PAUSED. Coordinator ran bounded `node --import tsx --input-type=module --eval ...` in apps/web against actual current source: exit0, receipts `{als:COMPLETE,aes:SUCCEEDED,polled:RUNNING,projected:RUNNING}` and `{als:PAUSED,aes:PAUSED,polled:RUNNING,projected:RUNNING}`. These are positive reproductions, not hypothetical findings.
2. `applyAssessmentRuntimeControlPresentation` was converted into a no-op retaining the old events/control signature. MCP inbound trace and actual `useAssessmentRuntimeViewModel` source identify the direct production caller in `hooks/use-assessment-runtime-view-model.ts`; it can return its already-canonical normalized value after existing usage calculation. Keeping this wrapper is unnecessary compatibility code, contrary to the Freeze.
3. New `canonicalFor` in `tests/assessment-runtime-adapter.test.ts` has a handwritten lifecycle literal union; new canonical status component prop types are inline rather than sibling types. Required repo typing/Atomic Design policies remain unclosed.

The recovered worker checked one mailbox batch through filtered/clipped RTK output and settled without resolving these already-routed findings. Valid settlement `msg_6262e0f2a63f` is preserved; exact release returned retained/user_takeover/processAction none before Delivery `delivery_4f9291bc78e8` was acknowledged. No stale terminal reuse or source recreation.

## Fix

The focused owner must make canonical terminal, paused and absent state dominate stale polling; retain only consistent matching pending-command overlays. Remove the no-op wrapper at its real consumer without altering token/usage behavior. Trace both production composer callers before removing dead undefined-mode boolean fallbacks, use canonical constant-derived test typing, and move only newly introduced component prop types to sibling types. Add bounded scalar regressions and rerun full composer/control plus affected checks. No API/contracts/Prisma/Python/i18n redesign is authorized.

## Verified and preserved

- Full current status/stat/diff checkpoint is `reports/w1-4-recovery-20261006-075925.patch`, SHA256 `c6cc612c0c0dda17195a6aea8b630fdd51ee28405ea473656f0c676746b79148`. No reset/restore/stash/clean/overwrite occurred. Valid original W1.4 source, tests, canonical component and durable report remain in the current worktree.
- Coordinator directly passed full bounded composer8/8 and web no-emit typecheck before recovery. Historical worker report records130 focused passes; fresh recovery independently verified web typecheck, metric1/1, format/diff and browser. Historical unbounded terminated suites are unverified, never PASS.
- Coordinator independently used Playwright MCP: actual UI sign-in through the real Next BFF, dashboard total2/follow-up1/ready0, paused summary and explicit unavailable summary. Actual paused detail runtime drawer renders Lifecycle Paused and Execution Paused; absent evidence/usage remain unavailable. No static API/BFF response mocking or auth guard bypass.
- Actual root-owned API3311/PostgreSQL55439 GET/SSE canonical deep equality and contradictory secondary RUNNING activity were independently verified. All96 ordered migrations applied. Only the existing RabbitMQ e2e stub is used at the external broker edge; this is not production outbox/provider/checkpointer or semantic proof.
- Browser present fixture causes evidence-graph404 and repeated runtime-control409 (`RUNTIME_CONTROL_TARGET_STALE`) because no control acknowledgement row exists. These synthetic prerequisites do not prove Stop/Continue execution; no production-boundary or fixture-reset workaround is authorized.
- Chrome DevTools MCP attempted independently: `Missing X server to start the headful browser`. NOT_PROVEN for DevTools-specific diagnosis; Playwright real-rendered projection proof remains distinct. Production acceptance matrix rows are still NOT_PROVEN.

## Remaining acceptance

Inspect the actual focused diff against the preserved patch, directly rerun relevant tests/types/policy, review durable repair report and final real-browser rendering. Only then accept W1.4 at Level2, integrate exactly accepted owned source, complete its existing barrier and immediately launch the existing fresh W1 integration gate. Unrelated preparation must not delay that gate.

## Re-acceptance — 2026-10-06 after R1

**PASS — Coordinator Level2 W1.4 foundation acceptance.** Original REQUEST_CHANGES remains historical evidence above. Valid R1 completion `msg_d70d3532a1bf` identifies the exact active Task/Dispatch and durable report; actual owned diff, new sibling type file, existing canonical component and report were inspected. Both actual Node reproductions now pass: COMPLETE/SUCCEEDED plus stale RUNNING -> COMPLETED; PAUSED/PAUSED plus stale RUNNING -> STOPPED. The no-op helper and its only production call/import are gone; usage calculation remains intact; both actual composer callers use canonical control and dead boolean aliases are removed. New lifecycle test typing is constant-derived.

Coordinator directly ran six affected suites together under55s/512MB:102 passed, zero failed/cancelled/skipped, exit0; full web no-emit typecheck exit0, diff and direct literal-union/enum policy scans pass. Worker independently reports the same102 checks, import/contract/tool policies, format, web lint0errors/39baselinewarnings and graph update. Changed Tailwind arbitrary classes have no identified built-in-equivalent replacement (11px text,18px radius,min() measure and existing exact transition-property list); no gratuitous CSS change.

Fresh R1 Playwright MCP followed synthetic sign-in against restored real Next3310/guarded API3311, opened both actual assessment records and their runtime drawers: PAUSED lifecycle/execution and explicit all-null unavailable render correctly. Earlier Coordinator MCP dashboard2/1/0, real API GET/SSE equality, and contradictory RUNNING-secondary-activity proof remain valid and preserved. The database was not reset/reseeded. Exact resource release returned retained/user_takeover/no process action after the valid R1 report; its user/operator-closed terminal is not recreated or resumed. Delivery `delivery_1cd9163d2b41` processed/ACKed.

This accepts W1.4 foundation source/targeted browser projection only. Synthetic control409/evidence404, absent Root/provider/checkpointer execution, missing DevTools X-server and all §12 production verticals remain explicitly NOT_PROVEN. W1 integration must independently inspect the integrated complete W1 source and execute its own gate; no downstream production consumer is authorized by this Level2 result alone.
