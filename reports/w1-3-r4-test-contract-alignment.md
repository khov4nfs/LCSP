# W1.3 R4 test contract alignment

Date: 2026-10-06

## Root cause

Two API specs retained pre-W1.3 expectations. The Interview pause test expected
`AssessmentRuntimeControlService.request` to receive only `actorId`, but the
current caller passes the authenticated `RbacRequestContext` unchanged so the
runtime-control boundary retains role, scope, session, and user provenance. The
reconciliation test expected the legacy `Assessment.status` filter, while the
current service reads persisted canonical `Assessment.lifecycleState` and
excludes the terminal `COMPLETE` and `CANCELLED` contract states.

## Fix

The Interview assertion now requires the complete `actor` object. The
reconciliation assertion now requires the exact canonical `lifecycleState`
`notIn` query using `ASSESSMENT_LIFECYCLE_STATES.COMPLETE` and
`ASSESSMENT_LIFECYCLE_STATES.CANCELLED`; the existing evidence, quiet-period,
runtime-event, scan, and attempt guards remain in place.

## Null V1 behavior

The null behavior is intentional for this W1.3 query and was not redefined in
the test. W1.2 migration SQL is explicitly expand-only and says it preserves V1
state/history without semantic backfill (`apps/api/prisma/migrations/20261005140000_assessment_canonical_persistence/migration.sql:1`);
`Assessment.lifecycleState` is nullable there (`:20-23`). Under PostgreSQL
comparison semantics, a nullable row does not satisfy `NOT IN (COMPLETE,
CANCELLED)`, so an unbackfilled V1 row is not selected by canonical
reconciliation. This preserves the freeze rule that V1 status is historical and
must not become a lifecycle fallback (`reports/architecture-freeze-migration-manifest.md:291,298`);
later cutover/backfill ownership must establish canonical state explicitly.

## Changed files

- `apps/api/src/modules/assessment/application/services/assessment-interview-runtime.service.spec.ts:1827-1832` — assert the full authenticated actor object.
- `apps/api/src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.spec.ts:2,78-86` — import and assert canonical lifecycle constants/query.

## Verification

| Command | Result |
|---|---|
| `rtk env NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/modules/assessment/application/services/assessment-interview-runtime.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.spec.ts` | PASS; 2 suites, 105 tests |
| `rtk pnpm --dir apps/api exec eslint src/modules/assessment/application/services/assessment-interview-runtime.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.spec.ts` | PASS; exit 0 |
| `rtk pnpm --dir apps/api exec tsc -p tsconfig.json --noEmit --pretty false` | PASS; exit 0 |
| `rtk pnpm run check:imports` | PASS |
| `rtk pnpm run check:contracts` | PASS |
| `rtk git diff --check` | PASS |

## Scope limits

Only the two owned specs and this report changed. No production code, shared
contracts, Prisma schema/migrations, web/Python/i18n code, or existing worktree
changes were touched. This is test-contract alignment evidence only; no broad
full-suite, semantic, or production acceptance claim is made.
