# W1.4 fixture activity-visibility correction

Status: CORRECTED / fixture verification only. This is not production
acceptance and does not claim W1, W2, W3, API, SSE, or browser proof.

## Root cause

The synthetic `AssessmentRuntimeEvent` in
`apps/api/test/w1-canonical-browser-support.ts` omitted `toolName`, so the
database row had SQL `NULL`. The production reader's existing
`nonAgentStreamJournalWhere` predicate in
`apps/api/src/platform/runtime-events/assessment-runtime-event.service.ts`
uses `NOT { toolName: "agent_stream_semantic" }`; PostgreSQL does not match a
`NULL` value for that negated equality, so the intended secondary activity was
absent from `recent_activity` and runtime SSE results.

## Minimal fixture correction

- Added `CONFLICTING_ACTIVITY_TOOL_NAME` with the clearly synthetic value
  `w1-4-conflicting-browser-activity`.
- Set that value on the conflicting `RUN_STARTED` fixture event.
- Selected and asserted the persisted tool name, and emitted it in the
  fixture's expected metadata.
- Preserved the exact loopback `DATABASE_URL` guard, once-only UUID guard,
  transaction, `Prisma.DbNull`, canonical `PAUSED`/revision `7`/runtime
  `PAUSED` values, and all production/shared files.

## Verification

- `rtk pnpm exec prettier --check apps/api/test/w1-canonical-browser-support.ts
reports/w1-4-fixture-activity-visibility.md` — PASS (exit 0).
- `rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit` — PASS (exit 0).
- Wrong-target invocation with
  `DATABASE_URL=postgresql://caller.example/forbidden rtk pnpm exec tsx
apps/api/test/w1-canonical-browser-support.ts` — PASS (rejected before a
  Prisma connection; exit 1 with the exact-target refusal).
- Untracked-file whitespace checks via
  `rtk proxy git diff --no-index --check /dev/null` against each owned file —
  PASS (no whitespace diagnostics; the normal exit `1` for a non-empty diff
  was normalized to success by the check wrapper).
- The requested incremental graph refresh was not completed: it reported 1,602
  uncached files and was stopped to honor the no-full-index boundary; graph
  output is not acceptance evidence here.

No database was connected, seeded, reset, migrated, dropped, or changed by
this correction. No API, web, broker, or provider service was started, and no
live GET/SSE/browser proof was run; Root owns the existing isolated synthetic
record and subsequent live rerun.
