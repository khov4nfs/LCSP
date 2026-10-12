# W1 canonical read-isolation preparation

Status: **PREPARATION PASS**. This is a new executable API e2e scaffold, not W1 integration acceptance and not a downstream production-consumer gate.

Owned artifacts:

- `apps/api/test/w1-canonical-read-isolation.e2e-spec.ts`
- `reports/w1-canonical-read-isolation-preparation.md`

## Contract and source basis

The scaffold was checked against `reports/architecture-freeze-migration-manifest.md` §§3, 4, and 11 and the indexed/current source for `GetAssessmentHandler.execute`, `WorkspaceRuntimeEventsController.stream`, `WorkspaceRuntimeEventsController.agentStreamHistory`, and `AssessmentRuntimeEventService.buildWorkspaceSnapshot`, `readCanonicalAssessments`, `readCanonicalEvents`, and `getAgentStreamHistoryPage`.

It uses the real `AppModule`, authentication/session flow, RBAC guard, Prisma adapter, canonical projection, snapshot/SSE/history routes, and the existing `jest-e2e-rabbitmq.ts` no-op broker stub. The fixture mechanically seeds two synthetic customer owners, one canonical-present and one all-null assessment for owner A, a canonical-present assessment for owner B, canonical events, and owner-scoped agent-stream journal events; it does not call lifecycle commands or providers.

Assertions are limited to identity/ownership, canonical-present versus canonical-unavailable projection, owner-scoped snapshot/SSE/history visibility, foreign-owner 404/empty reads, and unchanged persisted assessment/runtime/event authority rows after unauthorized attempts. They do not claim full tenant, admin/Root, provider, billing, real broker, or downstream-consumer proof.

The closure correction uses the existing `ASSESSMENT_RUNTIME_RUN_STATUSES.completed` contract value for the synthetic stream payload. The SSE reader now preserves the HTTP status and rejects non-success HTTP or stream errors, so a foreign owner is proven as a successful HTTP 200 stream with no matching frame rather than an ambiguous `null` that could mask transport failure.

## Target and migration evidence

Only this exact loopback target was used:

- Database: `postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w1_read_isolation?schema=public`
- Container: `lcsp-api-test-postgres-55441-lcsp_w1_read_isolation`
- Initial preflight before first provisioning: exact container absent and `127.0.0.1:55441` unbound — PASS.
- Closure preflight: retained exact container was present, listening only on `127.0.0.1:55441`, and matched the required database identity — PASS; no reseed or recreation was run.
- Provision command: `LCSP_TEST_POSTGRES_PORT=55441 LCSP_TEST_POSTGRES_DB=lcsp_w1_read_isolation LCSP_TEST_POSTGRES_USER=postgres LCSP_TEST_POSTGRES_PASSWORD=postgres node apps/api/test/scripts/ensure-test-postgres.mjs` — PASS.
- Identity check: container name, `127.0.0.1:55441->5432/tcp`, and `POSTGRES_DB=lcsp_w1_read_isolation` matched — PASS.
- Empty-target check before the first fixture seed: public table/view count `0` — PASS.
- Migration command: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w1_read_isolation?schema=public" pnpm --dir apps/api run prisma:migrate:deploy` — PASS; Prisma found and applied all 96 ordered migrations through `20261005140000_assessment_canonical_persistence`.

The first live attempt exposed a fixture-only UUID contract error (`ASSESSMENT_REPOSITORY_SETUP_STATE_INVALID`): several UUID-shaped synthetic values did not satisfy the contract's RFC version/variant validation. The fixture was corrected to valid UUIDs; the retained task-owned database was repaired only by moving the malformed first-attempt rows out of the tested customer-owner scope and inserting the valid synthetic fixture rows—no `DELETE`, `DROP`, reset, db-push, or migration replacement was used.

## Verification outcomes

- `pnpm --dir apps/api exec prettier --check test/w1-canonical-read-isolation.e2e-spec.ts` — PASS.
- `pnpm --dir apps/api exec eslint test/w1-canonical-read-isolation.e2e-spec.ts` — PASS.
- `pnpm --dir apps/api exec tsc --noEmit --pretty false` — PASS.
- Focused live snapshot/SSE/history case against the exact target — PASS.
- Final live command: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w1_read_isolation?schema=public" NODE_OPTIONS="--experimental-vm-modules" pnpm --dir apps/api exec jest --config ./test/jest-e2e.ts --runInBand test/w1-canonical-read-isolation.e2e-spec.ts` — PASS; 1 suite, 3 tests passed, 0 failed.
- Retained-target post-run read-only check — PASS; the exact container still has 3 fixture assessments, 2 runtimes, 2 canonical assessment events, 2 runtime events, and 96 applied migrations.

## Cleanup and retention

The exact database and container remain running for evidence. No stop/remove/drop/reset/cleanup operation was run because deletion authority was not provided. The final customer-owner fixture rows are retained for the known-fixture reuse guard; the original malformed synthetic attempt's rows remain retained outside the tested customer-owner scope under the seeded admin fixture owner. No other database, browser target, service port, broker, provider, credential, source, contract, migration, web, i18n, Python, or unrelated test file was touched.
