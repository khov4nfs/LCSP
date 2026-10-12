# W1.3 R2 persistence repair

## Root cause

`AssessmentLifecycleCoordinator.transitionWithGuards` used `Prisma.JsonNull`
when a non-`BLOCKED` transition had no `blockerReference`. Prisma therefore
sent JSON `null` to the nullable JSONB column instead of SQL `NULL`, violating
the accepted `Assessment_blocker_check` branch that requires both blocker
columns to be SQL `NULL` outside `BLOCKED`.

Baseline reproduction (the prior schema-push-only database, exit 1):

```text
rtk run 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55437/lcsp_w13_repair?schema=public NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec tsx --test ../../tests/assessment-lifecycle-protocol.test.ts'
DriverAdapterError: new row for relation "Assessment" violates check constraint "Assessment_blocker_check"
```

## Fix

- Changed only the absent-blocker persistence boundary to `Prisma.DbNull`.
- Added a focused spec asserting the update payload uses `Prisma.DbNull`.
- Added a real PostgreSQL regression asserting persisted `blockerReason` and
  `blockerReference` are both `null` after a non-blocked transition.
- Added `tests/assessment-lifecycle-migrated-db.mjs`, which creates only the
  task-owned `lcsp_api_w13_r2_repair` database on the existing loopback
  container, runs ordered `prisma migrate deploy`, verifies migration history,
  and checks deployed constraint definitions before running application tests.

The old `lcsp_w13_repair` schema-push database was not used for acceptance.
No migration, Prisma schema, contract, compatibility path, or existing
database was changed.

## Verification

Focused coordinator spec (exit 0):

```text
rtk run 'NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts'
Test Suites: 1 passed, Tests: 8 passed
```

Seven focused API suites (exit 0):

```text
rtk run 'NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts src/platform/runtime-events/assessment-runtime-control.service.spec.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts'
Test Suites: 7 passed, Tests: 88 passed
```

Migration-backed protocol/control runner (exit 0):

```text
rtk node tests/assessment-lifecycle-migrated-db.mjs
prisma-generate: exit 0
migrate-deploy: exit 0
assessment-lifecycle-protocol: exit 0
assessment-runtime-control: exit 0
PASS: 16 migration constraint assertions; ordered migrate deploy, lifecycle protocol, and five runtime-control tests passed on postgresql://postgres:postgres@127.0.0.1:55437/lcsp_api_w13_r2_repair?schema=public
```

Repository checks (all exit 0):

```text
rtk run 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55437/lcsp_api_w13_r2_repair?schema=public pnpm run typecheck'
rtk pnpm --dir apps/api exec eslint src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts
rtk pnpm exec prettier --check tests/assessment-lifecycle-protocol.test.ts tests/assessment-lifecycle-migrated-db.mjs reports/w1-3-r2-persistence-repair.md
rtk git diff --check
```

Existing ordered-migration persistence proof (exit 0) also passed 152
assertions covering malformed blocker, sequence, lease, lineage, FK, replay,
rollback, and upgrade preservation cases. Its expected whole-schema drift
comparison returned exit 2 on both clean and upgrade databases, identical to
the V1 baseline; that is a known drift result, not a whole-schema PASS.

```text
rtk node tests/assessment-canonical-persistence.mjs
PASS: 152 assertions; clean install and populated upgrade. Whole-schema drift exit 2, identical to V1 baseline (not a whole-schema PASS).
```

The runner verified all 96 ordered migrations were finished, then compared
the deployed `pg_get_constraintdef` output for these immutable checks:

```text
Assessment_lifecycle_pair_check
Assessment_lifecycle_revision_check
Assessment_blocker_check
AssessmentRuntime_event_sequence_check
AssessmentRuntime_lease_pair_check
AssessmentRuntime_lease_execution_check
AssessmentEvent_sequence_check
AssessmentEvent_payload_check
AssessmentEvent_token_usage_check
AssessmentEvent_child_lineage_check
AssessmentEvent_parent_execution_check
```

It also verified the deployed lifecycle/provenance foreign keys:

```text
AssessmentRuntime_assessmentId_fkey
AssessmentEvent_assessmentId_fkey
AssessmentEvent_assessmentId_threadId_fkey
AssessmentEvent_outboxMessageId_assessmentId_fkey
```

No `db push` or user-configured `DATABASE_URL` was used by the acceptance
runner. The separate initial migration probe database was task-created,
verified, and removed; it is not part of the acceptance database.

## Scope and limits

This closes the SQL-null persistence defect and removes schema-push-only proof
from the protocol acceptance path. It does not claim a full CI run or whole-
schema drift resolution; the known WizardProfile/V1 drift remains out of
scope. A fresh independent W1.3 review is still required by the migration
gate.
